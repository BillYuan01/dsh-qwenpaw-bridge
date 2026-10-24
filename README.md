# dsh-qwenpaw-bridge

为 QwenPaw 增强 DeepSeek Harness（DSH）ACP profile 的 **DSH bundle 插件**。不修改 DSH 核心，继续复用官方 `@deepseek-ai/dsh-acp`，在标准 ACP 消息之上增加流式输出、权限预设切换和模型目录元数据。

**English overview:** A DSH-side bundle that reuses the stock ACP transport and adds live assistant chunks, hot-switchable permission presets, and an additive `_meta.qwenpaw` catalog. Linux has recorded verification; macOS and Windows bridge support remain unverified. Optional source-only helpers are separate from the bridge runtime.

- 当前根包版本：**0.2.1**；`_meta.qwenpaw` 协议版本：**1**。两者不是同一个版本号。
- 本仓库是 DSH 端；QwenPaw 端插件在 [qwenpaw-dsh](https://github.com/BillYuan01/qwenpaw-dsh)。本桥接器可独立安装和测试。
- 快速入口：[安装](#安装与启动)、[协议](#wire-contract协议版本-1)、[测试与验证边界](#测试与验证边界)、[贡献指南](AGENTS.md)。

## 做什么，不做什么

| 能力 | 实现与边界 |
| --- | --- |
| 实时回答与推理片段 | 将 `agent/assistant-stream` 的 `text-delta` / `reasoning-delta` 转为标准 `session/update` 的 `agent_message_chunk` / `agent_thought_chunk`，抑制同一次尝试已投递 live 片段对应的 committed 文本重复 |
| 权限预设热切换 | 将 DSH `permissionPresets` 服务投影为 `_meta.qwenpaw.permission_presets` 和 `permission_mode` 配置选项；桥接器直接切换会话预设，无须重启进程 |
| 模型目录 | 在握手及会话创建/恢复时附加 provider、model、选择值与推理强度列表；目录按连接缓存，`llm/adapters-updated` 时失效 |
| 工具类别显示 | 为已知工具名补充 `read` / `edit` / `execute` / `search` / `fetch`；未知名称保留原分类 |

其他 ACP 内容继续交给官方实现；图像、用量、MCP、取消、恢复等不另建私有传输。配置更新和工具类别会做上述增量装饰。桥接器不是权限沙箱、凭据管理器或自动安装器；QwenPaw 端修改审批等级是否重启 worker，也不由此仓库保证。

## 依赖与平台

| 项目 | 要求 |
| --- | --- |
| Node.js | `>=22` |
| DSH | `>=0.2.0-rc.2 <0.3.0-0`，见 `engines.dsh` |
| `@deepseek-ai/dsh-acp` | 同一版本范围，由 `dsh-acp-app` bundle 提供 |
| `@agentclientprotocol/sdk` | `^1.4.0`，由 `dsh-acp` 提供 |
| pnpm | `dsh plugin add` 会调用，必须在 `PATH` 中 |
| 客户端 | ACP 客户端；QwenPaw 为参考消费者 |

DSH 优先检查 `engines.dsh`；该字段缺失时才回退到 `@deepseek-ai/dsh*` peer 范围。相关 DSH 版本采用包含预发布版本的 semver 判断，因此范围覆盖所针对的 0.2 prerelease，但 `<0.3.0-0` 排除 0.3 prerelease。不满足范围时，profile 启动可能静默跳过插件。升级后要核对实际组合，不能仅凭安装成功判断已启用；不要为真实部署随意使用 `allow-version` 绕过限制。

| 组件 | 已知平台边界 |
| --- | --- |
| 根包 ACP bridge | 已记录 Linux 验证；macOS、Windows 未验证。这不是“Windows 不可能运行”的结论，需分别验证 DSH、Node、依赖及启动方式 |
| `tools/dsh-env-sync.py` | Linux 已验证；macOS 未测试；原生 Windows 不受支持，其 POSIX 权限假设未验证。WSL 也不等于原生 Windows 验证 |
| helper shell 测试 | 依赖 Bash 和 GNU 工具，不能假定 macOS 默认工具直接兼容 |

下方 shell 示例按 POSIX/Linux 编写，不构成跨平台认证。历史证据及限制见 [TESTING.md](TESTING.md) 和 [CHANGELOG.md](CHANGELOG.md)；本次文档检查不等于重新运行其中的 live 测试。

## 安装与启动

以下是**用户手动部署步骤**，会安装依赖、写 profile，启动后可能访问模型服务；不是离线测试命令。请先确认目标 DSH home、现有配置备份和依赖下载许可。`DSH_HOME` 决定目标 home；不要把示例路径原样用于真实环境。

### 1. 从官方 `acp` 模板创建 profile

`qwenpaw` 不是随 DSH 提供的模板名。不要直接对一个新名字执行 `plugin add`：那样可能只有 `dsh-base`，缺少 ACP app 和 `acp-app-startup`。

```sh
# 创建/读取配置后退出，不进入等待 stdin 的 ACP 会话
dsh --profile qwenpaw --from-default-profile acp --dump-config >/dev/null
```

若已有同名 profile，先检查而不是覆盖。省略 `--dump-config` 会进入 app 启动流程，不能用作无交互初始化。

### 2. 将 bridge 加入该 profile

```sh
# 已发布包的安装路径
dsh plugin --profile qwenpaw add dsh-qwenpaw-bridge

# 或从源码目录安装；二选一
dsh plugin --profile qwenpaw add /absolute/path/to/dsh-qwenpaw-bridge
```

CLI 在 `$DSH_HOME/profiles/qwenpaw` 中调用 pnpm，维护 profile 的依赖和 `dsh.profile.bundles`。缺少 pnpm 时会以 127 退出，不能当作安装成功。预期 bundle 顺序：

```text
@deepseek-ai/dsh-base
@deepseek-ai/dsh-acp-app
dsh-qwenpaw-bridge
```

[根 bundle patch](cordis.patch.yml) 禁用 stock `acp` 行，插入 `qwenpaw-bridge`，但保留管理 stdin EOF 和 `--help` 的 `acp-app-startup`。仓库不提供 `profile/install.sh` 或静态 profile `package.json` 来替代 DSH CLI。

### 3. 配置模型路由

默认使用 `ctx.agentDefaultModel`。如需明确指定 provider/model，参考 [示例 profile patch](examples/profile/cordis.patch.yml)，将所需内容**合并**至 `$DSH_HOME/profiles/qwenpaw/cordis.patch.yml`，按部署修改 provider、model 与 API-key 环境变量名。

- 示例只配置 `llm-pi-ai` 和 `agent-default-model`，不保证示例服务或模型对你的账户可用。
- 不覆盖已有路由，不再插入第二个 `qwenpaw-bridge` 行。
- 不将真实密钥写入仓库、命令输出或公开报告。凭据如何供给由部署单独决定，后文 helper 不是必装步骤。
- 无法解析完整 provider/model 时，桥接器不会凭空创建可用路由；会话可能不显示模型配置选项。

### 4. 检查组合，再启动

下面的 dump 操作也会进入 DSH 配置流程，不属于默认离线检查。只在确认目标 profile 后执行，输出保留在私有位置并审查，勿上传原始配置。

```sh
dsh --profile qwenpaw --dump-config > /path/to/private-output/qwenpaw.dump
```

人工核对：`qwenpaw-bridge` 恰好一行且 `name: dsh-qwenpaw-bridge`；stock `acp` 为 `disabled: true`；`acp-app-startup` 仍存在。随后启动：

```sh
dsh --profile qwenpaw
```

## Wire contract（协议版本 1）

传输仍为 stdio 上的 NDJSON / JSON-RPC ACP；增强字段放在响应的 `result._meta.qwenpaw` 中。普通客户端可以忽略扩展，继续使用标准 ACP。

### 握手与会话元数据

以下为 `initialize` 的**示意片段**，provider/model 是占位值，不表示真实目录或可用路由：

```json
{
  "_meta": {
    "qwenpaw": {
      "protocol": 1,
      "bridge": "dsh-qwenpaw-bridge",
      "version": "0.2.1",
      "streaming": true,
      "models": [
        {
          "id": "example-model",
          "name": "Example model",
          "provider": "example-provider",
          "provider_name": "Example provider",
          "selection_value": "[\"example-provider\",\"example-model\"]",
          "reasoning_efforts": [{"id": "high", "name": "High"}],
          "default_reasoning_effort": "high",
          "default": true
        }
      ],
      "current_model": {"provider": "example-provider", "model": "example-model"},
      "permission_presets": [{"id": "read-only", "name": "read-only"}],
      "default_permission_preset": "read-only",
      "permission_preset": "read-only",
      "initialized": true
    }
  }
}
```

- `version` 跟随根 `package.json`，协议破坏性变化才需要修改 `protocol`。
- `session/new` / `session/resume` 重复提供同类元数据，当前模型和权限以该会话为准；`initialized` 仅在 initialize 响应标记。
- 模型的可选字段包括 `description`、`context_window`、`max_tokens`、`input_modalities`、`default_reasoning_effort`。`current_model` 也可含 `reasoning_effort`。
- 模型数取决于部署，**不要硬编码数量**。每项有 `reasoning_efforts` 数组，但无法解析详情时可以为空；目录可为空，`models: false` 时字段省略。
- `default` 标记与当前选择匹配的 provider/model；只有当前路由存在于目录且身份唯一时，才应预期恰好一个 `default: true`。live probe 针对已配置的验收路由提出更严格要求，不是所有部署的通用保证。
- `streaming: true` 表示连接启用 live 路径，不证明运行时一定发出了 live 事件。

### 权限切换与确认

服务可用时，`configOptions` 增加：

```json
{
  "id": "permission_mode",
  "name": "Permission mode",
  "category": "permission",
  "type": "select",
  "currentValue": "read-only",
  "options": [{"value": "read-only", "name": "read-only"}]
}
```

优先使用标准 ACP 配置切换；以下均为请求的 method/params 片段，`example-session` 只是占位：

```json
{"method":"session/set_config_option","params":{"sessionId":"example-session","configId":"permission_mode","value":"read-only"}}
```

可选扩展方法为 `qwenpaw/permission/set`（参数 `sessionId`、`preset`）、`qwenpaw/permission/get`（`sessionId`）和 `qwenpaw/streaming/set`（`enabled`）。ACP SDK 会为扩展名自动加前导 `_`；bridge 接受带或不带 `_` 的拼写。未知 `qwenpaw/*` 方法返回 `-32601`。

初始权限可在 `session/new` 的 `params._meta.qwenpaw.permission_preset` 请求，也会在 resume 路径处理。注意区别：

- 显式热切换缺少服务、预设非法或会话不可用时，返回 `-32602`；不能把失败当作已切换，更不能自动提升权限。
- **初始预设请求不是强制前置条件**。无法应用时，会话仍可能创建，元数据包含 `requested_permission_preset` 和 `permission_preset_fallback: true`。安全敏感客户端必须检查实际 `permission_preset` / `configOptions`，不符合要求就停止发送 prompt。
- 实际默认预设来自 DSH profile，不保证为 `read-only`。桥接器不额外放宽 DSH 的授权机制。

### 流式与降级策略

在 initialize 请求的 `params._meta.qwenpaw.streaming` 传 `false` 可对连接关闭 live；响应报告 `streaming: false`。也可通过上述 streaming 扩展切换；配置 `streaming: false` 时，不安装 live 订阅。

缺少 live 事件、订阅失败或客户端关闭 live 时，使用 stock committed 投影。live 路径只处理本连接拥有的会话；按模型尝试分别记录文本/推理标志，避免已流式发送的内容再附加一次。该降级不承诺对传输写入失败做可靠重放。

目录查询失败采用 **fail-soft**：跳过失败 provider、保留缺少可选详情的模型或返回空目录；元数据装饰失败时原帧继续转发。**权限控制不能套用“失败就继续执行”的策略**：客户端应 fail-closed，遇到权限错误或初始预设回退时先确认实际权限，不得绕过或默认为更宽松级别。

## 可选组件：与根 bridge 分开

### Web 状态卡

[status-plugin/](status-plugin/README.md) 是独立包 `dsh-qwenpaw-bridge-status`，安装到 DSH **web** profile，不能用它替代 `qwenpaw` profile 中的 bridge：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-qwenpaw-bridge/status-plugin
```

安装后由用户重启 web profile。它在启动时查询 QwenPaw `/api/harnesses`，通过 `QWENPAW_API_BASE` 可覆盖目标地址；依据 `dsh` 后端的 available/installed 状态显示成功或失败。它不是模型调用验收，也不是持续健康监控；后续断连需重启 web profile 才刷新。此仓库不会自动安装状态卡、重启服务或设置 cron。

### 手动环境 helper（仅源码）

[tools/README.md](tools/README.md) 介绍 `tools/dsh-env-sync.py`：针对需要在启动环境提供 `DEEPSEEK_API_KEY` 的部署，手动从 `$DSH_HOME/.credentials.yaml` 派生 `$DSH_HOME/.env`。它会产生**第二份明文密钥副本**，不是消除凭据存储，也不是 bridge 必需依赖。

- 需要 Python `>=3.10`、PyYAML、Node `>=22.9`（`node:util.parseEnv`）。Linux 已验证，macOS 未测试，原生 Windows 不受支持。
- 使用同目录临时文件、`0600`、解析验证和原子替换；拒绝文件级符号链接及部分危险值，但不提供父目录路径加固或并发写锁。已同步文件不会自动修复权限。
- `--check`、`--print` 虽不写目标文件，仍会读取选中 home 的凭据；不能当作“无凭据访问”。实际读取/写入必须单独授权。
- 没有安装脚本、自动启动钩子、定时任务或运行时集成。

[diagnostics/README.md](diagnostics/README.md) 提供 fake-only 的目录采样和 credential-service 采样说明。**credential-service 与模型发现之间的关系仍未解决**；不同时间的结果不证明因果，helper 也不是已经证明的修复。即使 probe 不发 prompt，DSH 启动仍可能加载插件、读凭据、写状态或联网。

`tools/`、`diagnostics/`、`test/`、`status-plugin/` 均不在根 npm 包的 `files` 列表。npm 根包包含 `lib/`、`cordis.patch.yml`、README、LICENSE、CHANGELOG 以及 npm 自动包含的 `package.json`；需要源码工具时保留 checkout。

## 测试与验证边界

不要把离线检查、fake-only 测试和真实服务验收混成一个命令链。修改文档不要求启动 DSH 或调用模型。

### A. 默认离线检查：无 DSH、无真实凭据

在 checkout 根目录运行：

```sh
for f in lib/*.js; do node --check "$f"; done
node --test test/protocol.test.js
git diff --check
```

Node 测试仅覆盖包名、版本及协议常量的一致性，**不能证明**权限、流式或模型目录集成正常。打包清单可单独用 `npm pack --dry-run` 检查；这不等于执行安装、发布或模型验收。

### B. Fake-only helper 测试：临时文件，不启动 DSH

依赖已经具备时，按 [tools 测试说明](tools/README.md#fake-only-tests) 运行：

```sh
bash tools/tests/test-env-sync.sh
python3 tools/tests/test-atomic.py
```

两套测试生成假值和临时 home。不要将测试目标覆盖为用户正在运行的脚本或真实 home；保留默认 checkout 目标。依赖安装仍需单独决定。

### C. 隔离诊断：仍会启动 DSH，需另行确认

严格遵循 [diagnostics 隔离说明](diagnostics/README.md#prerequisites-and-isolation)：预先配置一次性 fake profile、fake HOME/DSH_HOME、清理继承的 key/token 和启动选项、限制 PATH，尽可能隔离网络。不得链接真实 `.env` 或凭据。不要调用 `test/spike_lib.py` 的 `prepare_home`，它可能链接真实 credential store。该类诊断不属于 A/B 的无运行时检查。

### D. Live 验收：仅在单独明确授权后

`test/probe.py` 会启动 DSH、发送真实 prompt、切换权限并产生输出/潜在费用。它调用 `prepare_home`：即使 `DSH_HOME` 指向临时目录，也可能将调用者 home 下的真实凭据链接进去；`ProbeClient` 默认许可决策还可能选择 allow 选项。**不能直接用于默认 CI 或 fake-only 验证。**

获得对目标 home/profile、凭据来源、网络、费用、权限与输出位置的单独授权后，才按 [验收证据](TESTING.md) 准备环境并运行。例如以下仅为已授权环境的手动入口：

```sh
/path/to/authorized-python test/probe.py --dsh-home /path/to/authorized-dsh-home --profile qwenpaw
/path/to/authorized-python test/probe.py --dsh-home /path/to/authorized-dsh-home --profile qwenpaw --committed
```

需要所选 Python 环境中的官方 ACP SDK（import `acp`）、已安装 profile 和有效模型路由。probe 不安装/重写 profile，但会准备工作目录及可能的凭据链接；profile 缺失时返回 `not-verified`、退出 2，不能记作通过。

验收关注 live 片段、committed 无重复、关闭 live 后的 committed 输出、元数据与实际权限一致、直接权限切换不重启进程。目录非空、每项推理强度非空、恰好一个默认模型，是该验收路由的要求，不要推广为固定模型数或跨环境认证。原始输出可能含路径、会话标识和服务错误；公开前须审查脱敏。

## 源码导航

| 路径 | 职责 |
| --- | --- |
| [lib/index.js](lib/index.js) | 插件入口、依赖注入、stdio、连接状态、初始路由 |
| [lib/inbound.js](lib/inbound.js) | 请求跟踪、权限配置拦截与扩展方法 |
| [lib/outbound.js](lib/outbound.js) | 元数据/配置装饰、通知转发与去重入口 |
| [lib/stream.js](lib/stream.js) | live 事件投影与 committed 去重标志 |
| [lib/catalog.js](lib/catalog.js) | provider/model/effort 目录及缓存 |
| [lib/presets.js](lib/presets.js) | 预设投影与 DSH 权限服务写入 |
| [lib/toolkind.js](lib/toolkind.js) | 工具分类 |
| [lib/protocol.js](lib/protocol.js) | 协议常量、版本及 JSON-RPC 帧 helper |

贡献时先读 [AGENTS.md](AGENTS.md)，历史验证看 [TESTING.md](TESTING.md)，变更记录看 [CHANGELOG.md](CHANGELOG.md)。仅文档改写无需版本升级；发布、推送、安装或运行时改动均为另行授权的工作。

## License

MIT，见 [LICENSE](LICENSE)。
