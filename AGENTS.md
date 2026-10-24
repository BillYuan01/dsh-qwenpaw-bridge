# AGENTS.md — dsh-qwenpaw-bridge 协作指南

面向在本仓库工作的维护者、贡献者与 AI coding agent。目标是：先理解边界，再用最小改动交付有证据的结果；不能把“做过静态检查”写成“真实服务已验收”。用户的本轮授权与文件所有权范围优先，遇到目标或风险不清楚时先确认。

**English summary:** Preserve the stock ACP transport and additive protocol-1 contract. Default to offline checks and fail-closed permission handling. Keep fake-only tests separate from DSH startup and live acceptance; never access real credentials or publish without explicit authorization.

## 1. 仓库边界与事实来源

- 根 npm 包是 `dsh-qwenpaw-bridge`，当前版本 `0.2.1`；元数据协议为 `1`。以 [package.json](package.json)、[lib/protocol.js](lib/protocol.js) 为准，不复制旧版本示例。
- 这是 **DSH 端 bundle**，不是 QwenPaw 端 Python 插件。另一端在 [qwenpaw-dsh](https://github.com/BillYuan01/qwenpaw-dsh)，不要越界修改另一个 checkout，也不要用另一端的测试冒充这里的验收。
- [README.md](README.md) 是用户入口；[TESTING.md](TESTING.md) 是有日期和环境限制的历史证据；[CHANGELOG.md](CHANGELOG.md) 是版本记录。旧测量不能证明当前机器、当前版本或所有平台都通过。
- 根包的 npm `files` 仅含 `lib/`、`cordis.patch.yml`、README、LICENSE、CHANGELOG；npm 还自动包含根 `package.json`。`tools/`、`diagnostics/`、`test/`、`status-plugin/` 和本指南不在根包清单中。
- 使用现有本地 checkout。只修改被分配的文件；不顺便整理其他目录、生成报告或修改用户 profile。

## 2. 架构与数据流

```text
ACP client (QwenPaw or another client)
  -> stdin NDJSON -> inbound gate -> stock dsh-acp
  <- stdout NDJSON <- outbound relay <- stock dsh-acp
                            ^
                 agent/assistant-stream live deltas
```

[cordis.patch.yml](cordis.patch.yml) 在 `dsh-base` / `dsh-acp-app` 后禁用 stock `acp` 行并插入 `qwenpaw-bridge`，保留 `acp-app-startup`。不修改 DSH core、不复制 ACP 实现、不加第二个 transport 行。

| 模块 | 维护职责 |
| --- | --- |
| [lib/index.js](lib/index.js) | 注入 stock ACP 服务与 `acpAppStartup`，创建单一 stdio writer、连接状态和路由，调用 `acp.apply`，监听 adapters 更新使目录缓存失效 |
| [lib/inbound.js](lib/inbound.js) | 跟踪响应装饰所需的请求；消费权限配置与 `qwenpaw/*` 扩展；其余转发 |
| [lib/outbound.js](lib/outbound.js) | 装饰 initialize/new/resume、configOptions，处理工具分类和 committed 去重；装饰失败转发原帧 |
| [lib/stream.js](lib/stream.js) | 仅为本连接拥有的会话投影 text/reasoning deltas；按 attempt 保存去重标志，到下一次 start 才重置 |
| [lib/catalog.js](lib/catalog.js) | 从可选 `ctx.llm` 构建目录并缓存，按会话选择标记 default |
| [lib/presets.js](lib/presets.js) | 从 `permissionPresets` 服务读实际预设，通过 canonical `set` 写入，不凭缓存猜成功 |
| [lib/toolkind.js](lib/toolkind.js) | 仅补充已知工具名的分类，不覆盖已有非 other 分类 |
| [lib/protocol.js](lib/protocol.js) | `_meta` 命名、协议/包版本、方法名、配置 ID、JSON-RPC helper |

stdout 只能承载协议帧，不得加入日志、调试输出或秘密；使用现有 logger，日志本身也必须审查。路由以完整 provider/model 为单位，缺失时尝试 `agentDefaultModel`；无可用路由时不得假装会话模型已配置。

## 3. 必须守住的协议与安全边界

### 增量兼容

- 继续用标准 ACP `session/update`；附加信息置于 `result._meta.qwenpaw`，保留其他 namespace 和原消息字段。
- `initialize`、`session/new`、`session/resume` 的元数据语义保持一致，当前模型与权限按会话解析。
- `selection_value` 是 provider/model 数组的 JSON 字符串；不要只用 model ID 匹配跨 provider 的模型。
- `reasoning_efforts` 是数组，详情不可用时可为空；目录可为空或被配置关闭。模型数依赖路由，不硬编码固定数。恰好一个 default 需要当前路由确实在目录中且身份唯一。
- 未知 `qwenpaw/*` 返回 `-32601`；扩展接受有/无前导 `_`，官方 SDK 添加该前缀。无关 ACP 消息继续交给 stock 实现。
- live 去重只针对已投影的文本/推理，不吞掉图像、工具、用量或其他更新；关闭 live 后保留 committed 路径。传输失败不等于有可靠重放保证。

### 权限 fail-closed，目录/流式 fail-soft

**不能用“所有可选能力失败都降级”概括安全行为。**

- 权限切换要求服务和目标会话有效，标准 `permission_mode` 还验证目录中的预设值。显式切换失败返回 `-32602`，不得伪造成功、自动放宽或静默切到更强预设。
- 初始 `_meta.qwenpaw.permission_preset` 是请求而非强制约束：应用失败时，现有实现仍可能创建会话，并标记 `requested_permission_preset` / `permission_preset_fallback: true`。不要把它描述为服务端严格拒绝会话。安全客户端应核验实际预设，不满足要求就不发 prompt。
- 默认权限由 DSH profile 决定，不承诺自动是 read-only。新增测试/示例优先使用最小权限；不得用 full-access 或自动 allow 掩盖权限故障。
- 模型目录查询失败可跳过 provider/可选字段或返回空数组；关闭目录时省略字段。无 live 事件、订阅失败或关闭 live 时，回退 stock committed 投影。
- 装饰异常时原帧转发是可用性策略，不是权限已满足的证据；不得在权限写入失败后继续执行受保护动作。

## 4. 按任务选择验证，不默认跑全部

| 任务 | 适用检查 | 明确不能证明什么 |
| --- | --- | --- |
| README/指南/本地链接 | 阅读涉及的源文件与 package，校验 Markdown 本地路径，`git diff --check`；可跑 protocol 单测 | 不证明真实安装、流式、权限或跨平台通过 |
| 协议常量、包名/版本 | `node --test test/protocol.test.js` | 现有四项测试只检查名称、版本与协议词汇 |
| JS 改动 | `for f in lib/*.js; do node --check "$f"; done`，再选相关单测/隔离测试 | 语法通过不等于 runtime 集成通过 |
| 发布内容清单审查 | 经任务允许后 `npm pack --dry-run`，对照 `package.json.files` | 不安装，不等于发布；不能声称 source helpers 已进入 npm |
| env helper 行为 | 依赖齐备时 `bash tools/tests/test-env-sync.sh`、`python3 tools/tests/test-atomic.py` | fake-only，临时文件；不证明真实 credential-service 或模型发现正常 |
| 模型目录/凭据服务采样 | 先读 [diagnostics/README.md](diagnostics/README.md)，仅已配置的隔离 fake profile；启动前单独确认 | 不发 prompt 仍可能有 DSH 启动副作用；时间差不证明因果 |
| live / committed / 权限集成 | 单独授权后使用 [test/probe.py](test/probe.py) 与 [TESTING.md](TESTING.md) | 不能默认运行，不能替代另一个仓库的 QwenPaw 端测试 |
| status card | 先静态检查 [status-plugin/](status-plugin/README.md)；启动 web/访问 API 另行确认 | 卡片只表示启动采样，不是持续监控或真实模型验收 |

默认文档检查命令不需要 DSH、联网、安装依赖或读取真实凭据：

```sh
node --test test/protocol.test.js
git diff --check
```

**Fake-only env 测试与 DSH 诊断必须分开：**前者生成临时 home 和假值，不启动 DSH；后者会运行 profile/plugin 代码，必须预先检查。不得为了跑文档测试自动下载依赖、安装 profile 或创建服务。

### 高风险测试入口

- [test/spike_lib.py](test/spike_lib.py) 的 `prepare_home` 会在目标缺少 credential store 时尝试链接调用者 home 下的真实 store；[test/probe.py](test/probe.py) 会调用它。临时 `DSH_HOME` **不等于隔离**。
- `dsh_env` 从当前环境复制变量，再清理部分 DSH 标志；不是密钥 allowlist。`ProbeClient` 默认许可决策可能选择 allow，且实现了读写文件回调。不得作为默认安全 CI 客户端。
- Live probe 会发真实 prompt、创建工作目录、切换预设，可能有网络、费用和凭据访问。必须针对 home/profile、凭据来源、权限、费用和输出位置获得单独明确授权；不读真实凭据来“确认环境”。
- Fake-only 诊断使用一次性 fake HOME 与显式 fake DSH_HOME，清理继承 key/token、`NODE_OPTIONS` 等配置，限制 PATH，尽可能使用隔离网络与非网络 adapter。只可按需链接已审查的代码/依赖，不链接真实凭据或 `.env`，不调用 `prepare_home`。
- 缺少 profile 返回 `not-verified` / 退出 2 不是通过。失败、未运行、历史通过和本轮通过要分别报告。

## 5. 可选组件与未解决问题

- [tools/](tools/README.md)：源码限定、手动 opt-in 的 env helper，不是 bridge runtime。读取 `.credentials.yaml` 后派生 `.env`，会多一份明文副本；`--check` / `--print` 也读凭据，真实 home 必须另行授权。
- helper 采用 `0600` 临时文件、验证和原子替换，拒绝文件级符号链接；它不是并发锁、秘密管理器或父目录安全方案。已同步目标不自动修复权限。保持文档的这些限制，不用“原子写入”宣称整体绝对安全。
- helper 要求 Python >=3.10 + PyYAML、Node >=22.9。Linux 已验证，macOS 未测试，原生 Windows 不受支持；不能把该限制套用到根 bridge。bridge 的 macOS/Windows 状态是未验证，而非已判定不能运行。
- [diagnostics/](diagnostics/README.md)：只是假值采样样例，不是安装器、live credential test 或已证明的修复。**credential-service 与模型发现问题仍未解决**，不声称是注册时机、缓存或凭据加载顺序导致，也不声称 helper 已修复根因。
- [status-plugin/](status-plugin/README.md)：独立 `dsh-qwenpaw-bridge-status` 包，仅 web profile 启动时请求 QwenPaw `/api/harnesses`。不是根 ACP 包，不自动安装、不自动重启、不新增 cron。

## 6. 隐私与输出纪律

- 不读取、复制、链接或输出真实 credential store、`.env`、API key、token、私有配置，除非用户明确授权对应目标与动作。文档任务不需要任何此类访问。
- 公开文档只用占位路径和合成示例；不写私有主机路径、IP、用户名、会话标识或部署状态。公共 GitHub 链接可以保留。
- 原始 dump/probe/log 可能带路径、模型路由、会话信息或服务错误；错误文本不保证无秘密。不要直接上传或贴进 issue/README；独立审查、脱敏后只记录必要事实。
- 不把生成报告、cloud 验证产物、incident 笔记或凭据清单放进仓库；不得让诊断样例默认接触真实服务。
- 不改他人的未提交文件，不执行破坏性清理命令。发现意外 diff 先确认来源，再决定如何处理。

## 7. 文档改动、发布与交付

1. 开工先看 `git status --short`、现有文档和涉及源码，确定归属范围；不要覆盖未读过、需保留的文件。
2. 只改获授权内容。全篇重写可以完整替换；局部调整使用精准编辑。
3. 纯文档或 source-only helper 说明更新**不要求版本 bump**。不要为文档改写修改 `package.json`、`BRIDGE_VERSION`、代码或依赖。示例应符合当前 package version / protocol。
4. 仅在另行授权的版本发布任务中同步包版本与 `BRIDGE_VERSION`；只有破坏性 wire shape 改动才考虑 bump `META_PROTOCOL`，并审查客户端兼容性。
5. `git commit`、push、tag、npm publish、依赖安装、profile 修改、凭据访问、进程/服务重启及模型调用分别需要相应授权；“更新 README”不包含这些动作。
6. 完成前核对精确 diff 和本地链接，跑任务所需的最低风险检查。交付用通俗语言说明“改了什么、结果如何”，列出修改文件、实际检查及未运行的高风险测试，不虚构验证。
