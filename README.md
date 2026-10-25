# dsh-qwenpaw-bridge

为 QwenPaw 使用 DeepSeek Harness（DSH）提供的 DSH 端 bundle。
复用官方 `@deepseek-ai/dsh-acp`，不修改 DSH 核心。

主要增加三项能力：

- 将回答和推理增量转成标准 ACP 流式消息，避免重复追加 committed 文本。
- 在会话内切换 DSH 权限预设，不必重启 bridge 进程。
- 在 `_meta.qwenpaw` 中提供模型目录、推理强度和权限状态。

已知工具名还会补充 read/edit/execute 等显示分类；其他 ACP 消息继续由官方实现处理。
本项目不是权限沙箱，也不负责管理模型凭据。

## 版本与要求

| 组件 | 当前说明 |
| --- | --- |
| bridge | **1.1.0**，元数据协议 **1** |
| QwenPaw 端 | 配合 [qwenpaw-dsh **1.1.1**](https://github.com/BillYuan01/qwenpaw-dsh) 使用 |
| Node.js / pnpm | Node.js **>=22**；pnpm 必须在 `PATH` 中 |
| DSH / dsh-acp | **>=0.2.0-rc.2 <0.3.0-0** |
| ACP SDK | `^1.4.0`，由 dsh-acp 提供 |
| 可选 web 状态卡 | 独立的 `status-plugin` **0.1.0** |

两个仓库的版号不必相同。已记录的集成环境为 Linux、QwenPaw 2.2.2.post1、
DSH 0.2.1-rc.2；macOS 和 Windows 尚未验证，下面的命令按 POSIX shell 编写。
验证范围见 [验证记录](docs/verification.md)，不能将兼容范围当作所有版本都已实测。

## 安装与启动

以下命令由用户手动执行，会写入 DSH profile、下载依赖；启动后可能调用模型服务。
先确定 `DSH_HOME` 和目标 profile，已有配置请先备份。已有同名 profile 时先检查，不要覆盖。

### 1. 从官方 ACP 模板创建 profile

```sh
dsh --profile qwenpaw --from-default-profile acp --dump-config >/dev/null
```

`qwenpaw` 是这里选用的 profile 名，不是 DSH 模板名。
先从 `acp` 模板创建，才能保留 ACP app 和处理 stdin EOF 的 `acp-app-startup`。
`--dump-config` 让命令生成/读取配置后退出，而不是进入等待输入的 ACP 会话。

### 2. 从固定 tag 获取源码，再用本地目录安装

```sh
git clone --branch v1.1.0 https://github.com/BillYuan01/dsh-qwenpaw-bridge.git
dsh plugin --profile qwenpaw add /absolute/path/to/dsh-qwenpaw-bridge
```

将路径换成刚获取的仓库路径。**本包未发布到 npm registry，不要用裸包名安装。**
`dsh plugin add` 需要 pnpm；缺少 pnpm 导致失败时，不算安装完成。

预期 bundle 顺序为 `dsh-base` → `dsh-acp-app` → `dsh-qwenpaw-bridge`。
[根 bundle patch](cordis.patch.yml) 禁用 stock `acp` 行，插入一行 `qwenpaw-bridge`，
同时保留 `acp-app-startup`；无需再手写第二行 bridge。

### 3. 设置模型路由

bridge 默认使用 DSH 的 `agentDefaultModel`。
参考 [profile patch 示例](examples/profile/cordis.patch.yml)，把 provider、model 和
API-key 环境变量名改成自己的配置，再合并到 `$DSH_HOME/profiles/qwenpaw/cordis.patch.yml`。

- 示例配置的是 `llm-pi-ai` 和 `agent-default-model`，不是可直接复用的账户配置。
- 保留已有路由和其他 profile 设置，不要用示例整份覆盖。
- provider/model 必须是完整组合；无法解析路由时，bridge 不会凭空创建可用模型。
- 不要把真实密钥写进仓库或公开命令输出。环境 helper 不是安装的必需步骤。

### 4. 检查后启动

在目标 home/profile 已确认的环境中，检查配置：

```sh
dsh --profile qwenpaw --dump-config
```

确认 `qwenpaw-bridge` 恰好一行、stock `acp` 已禁用、`acp-app-startup` 仍在。
原始配置可能包含敏感信息，不要直接贴到 issue。然后启动：

```sh
dsh --profile qwenpaw
```

QwenPaw 端的安装与后端设置见 [qwenpaw-dsh](https://github.com/BillYuan01/qwenpaw-dsh)。

## 权限与使用提示

`read-only` 是 DSH 权限预设，**不是文件读取路径白名单**；
可读哪些路径由部署和 DSH 工具/权限策略决定，本 bridge 不新增路径隔离。
默认预设来自 profile，也不保证一定是 `read-only`。

客户端应检查会话实际权限，不能把 profile 默认值当作确认结果。
显式切换只有写入后回读一致才成功；初始预设请求失败时，会话仍可能创建并标记 fallback。
权限未知或不符合要求时应停止发送 prompt。字段和错误语义见 [协议说明](docs/protocol.md)。

## FAQ

**为什么装上了却没生效？**
先检查 Node、pnpm、DSH 版本范围及 bundle 顺序。
不兼容的插件可能被 DSH 跳过；不要靠绕过版本检查来判断安装成功。

**为什么没有模型选项，或目录为空？**
检查 provider/model 路由及 DSH adapter。目录依部署生成，不固定模型数量；
可选目录查询失败可以降级，不代表模型调用或凭据已验证。

**为什么输出不是逐字流式？**
live 事件不可用或关闭时，会保留 stock committed 输出。
元数据 `streaming: true` 只表示启用了 live 路径，不证明本次调用收到了增量。

**状态卡正常是否表示模型可用？**
不是。状态卡只在 web profile 启动时采样 QwenPaw 后端状态，不是持续监控或模型验收。

## 可选组件与文档

- [tools/README.md](tools/README.md)：手动环境 helper；会读取凭据并产生额外明文副本，按需使用。
- [diagnostics/README.md](diagnostics/README.md)：隔离诊断；即使不发 prompt，启动 DSH 仍可能有副作用。
- [status-plugin/README.md](status-plugin/README.md)：独立安装到 web profile 的状态卡，不替代 bridge。
- [协议说明](docs/protocol.md)、[开发与测试](docs/development.md)、[验证记录](docs/verification.md)。
- [AGENTS.md](AGENTS.md)：贡献约定；[TESTING.md](TESTING.md)：未改写的历史证据；[CHANGELOG.md](CHANGELOG.md)：版本记录。

源码工具和可选组件不在根包发布清单内，需要它们时请保留 checkout。

## License

[MIT](LICENSE)。
