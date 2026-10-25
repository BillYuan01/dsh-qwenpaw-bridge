# 贡献指南

本仓库只维护 DSH 端 bridge。先确认任务范围、阅读相关源码，再做最小修改。
不要顺手修改 QwenPaw 端仓库、用户 profile、独立状态卡或他人的未提交文件。

## 入口与版本

- 用户入口：[README.md](README.md)；wire contract：[docs/protocol.md](docs/protocol.md)。
- 开发与测试：[docs/development.md](docs/development.md)；近期集成范围：[docs/verification.md](docs/verification.md)。
- [TESTING.md](TESTING.md) 是历史证据，不能用旧结果证明当前代码全部通过。
- 根包 `1.1.0`，协议 `1`；兼容 QwenPaw 端 `qwenpaw-dsh 1.1.1`，版号无需同步。
- Node >=22，DSH/dsh-acp `>=0.2.0-rc.2 <0.3.0-0`；状态卡独立为 `0.1.0`。
- 版本事实以 [package.json](package.json) 和 [lib/protocol.js](lib/protocol.js) 为准。

## 代码地图

| 文件 | 职责 |
| --- | --- |
| [lib/index.js](lib/index.js) | 插件入口、单一 stdio writer、连接状态、初始路由 |
| [lib/inbound.js](lib/inbound.js) | 请求跟踪、权限拦截、扩展方法 |
| [lib/outbound.js](lib/outbound.js) | 响应元数据、configOptions、通知装饰 |
| [lib/stream.js](lib/stream.js) | live 增量投影与 committed 去重 |
| [lib/catalog.js](lib/catalog.js) | provider/model/effort 目录及缓存 |
| [lib/presets.js](lib/presets.js) | 权限目录、会话回读、预设写入与确认 |
| [lib/toolkind.js](lib/toolkind.js) | 已知工具名的显示分类 |
| [lib/protocol.js](lib/protocol.js) | 版本、协议常量、JSON-RPC helper |
| [cordis.patch.yml](cordis.patch.yml) | 替换 stock ACP 行，保留 ACP app startup |

## 协议不变量

- 复用官方 dsh-acp，不修改 DSH core，不引入第二个 transport。
- stdout 只能写 ACP NDJSON 帧；日志使用现有 logger，且不得包含秘密。
- 扩展放在 `result._meta.qwenpaw`，保留其他 namespace 和原消息字段。
- initialize 没有会话，不能报告会话实际权限；new/resume 按对应会话解析。
- 模型身份为 provider/model 组合，`selection_value` 是该二元数组的 JSON 字符串。
- 目录和 reasoning_efforts 可以为空；不硬编码数量，也不无条件要求恰好一个 default。
- 目录按连接缓存，adapter 更新时失效；不要跨连接缓存部署凭据或会话事实。
- live 只处理本连接拥有的会话，按 attempt 分别记录 text/reasoning 去重标志。
- 不吞图像、工具、用量等更新；关闭 live 保留 committed 路径，不承诺传输失败重放。
- 未知 `qwenpaw/*` 返回 `-32601`；扩展接受有/无前导 `_`，无关 ACP 帧继续透传。

## 权限不变量

- **默认值不等于实际值**：`default_permission_preset` 是 profile 默认，不能补作会话事实。
- `permission_preset` 和 select 的 `currentValue` 必须来自实际回读。
- 未知时省略 actual，置 `permission_preset_known: false`，不展示无真实 currentValue 的 select。
- 实际值不在目录中时保留 actual，但不展示该 select。
- **写入不等于确认**：显式切换须回读一致才成功；不可读或不一致返回 `-32602`。
- 初始预设是请求，不是强制前置条件；失败仍可能创建会话，须标记 fallback/未确认。
- 安全客户端必须核验 actual/known/confirmed，不满足要求就不发送 prompt。
- `permissionPresets: false` 必须在本地拒绝写入，不是只隐藏 UI，更不能透传 stock。
- 关闭后标准 permission_mode 及两个别名返回 `-32602`；扩展 permission set/get 返回 `-32601`，服务零写入。
- `models: false` 省略目录；`streaming: false` 不安装 live 订阅，保留 committed 输出。
- 目录、流式可降级，不得据此将权限失败描述为“继续执行即可”。
- 默认权限由 profile 决定；read-only 不是文件读取白名单，工具分类也不是授权机制。
- 不以自动 allow、full-access 或默认值回填来掩盖权限故障。

## 检查与安全

- 开工、交付前查看 `git status --short` 和 diff，发现范围外修改先确认来源。
- 文档任务只需核对源码、Markdown 本地路径和 `git diff --check`；protocol 单测可选。
- 默认离线入口：`tools/run-safe-checks.sh`；不启动 DSH、不安装依赖、不读取真实凭据。
- 权限单测用 fake ctx/service；通过不等于真实 DSH 权限服务已验收。
- helper 测试须显式选择 `--with-helpers`，缺依赖应报告阻塞，不自动安装。
- DSH 诊断与 fake-only helper 测试分开；不发 prompt 也可能读凭据、写状态或联网。
- **禁止默认运行 live probe**：`test/probe.py` 调用 `test/spike_lib.py` 的 `prepare_home`。
- `prepare_home` 可能链接调用者的真实 credential store；临时 DSH_HOME 不等于隔离。
- `dsh_env` 继承环境，并非秘密 allowlist；ProbeClient 可能自动 allow，且实现文件读写回调。
- Live 测试须单独确认 home/profile、凭据、网络、费用、权限和输出位置。
- 隔离诊断用 fake HOME/DSH_HOME、清理 key/token/NODE_OPTIONS、限制 PATH，不调用 prepare_home。
- 不读取或公开真实 `.env`、credential store、密钥、token 或私有配置，除非明确授权该动作。
- dump、probe、日志和错误文本可能含秘密；公开前独立脱敏，不直接上传原始输出。
- 公开示例用合成值，不写私有路径、IP、用户名、会话标识或内部验收产物。
- helper 的 check/print 也读凭据；它不是秘密管理器，credential-service 与模型发现的因果仍未解决。
- 状态卡只做启动采样；不自动安装、重启或添加 cron。

## 文档、发布与交付

- 完整重写前先读原文；局部修改用精准编辑。纯文档不改代码、测试、依赖或包版本。
- main 文档可以晚于已发布 tag；不要为补文档重打已发布 TGZ/ZIP，详见开发说明。
- 发布必须另行授权；不存在常设的 commit、push、tag、pack、npm publish 或 GitHub Release 许可。
- 安装依赖、修改 profile、访问真实凭据、重启和模型调用也需要各自对应的授权。
- 获准发布后，先定稿 README/CHANGELOG，再同步 package 与 BRIDGE_VERSION；破坏性 wire 变更才考虑改协议号。
- 从最终源码按 package.files 打包，禁用 lifecycle scripts，核对成员、版本、tag、SHA256 并跑离线检查。
- status-plugin 独立发版，不跟随根包自动升版；根包不夹带源码工具、测试或诊断产物。
- 交付列出精确修改路径、实际执行的检查、失败/未运行项；区分历史证据、本轮通过和未验证能力。
- 不把语法检查、fake 测试或其他仓库的集成结果写成全部 bridge 功能已实测。
