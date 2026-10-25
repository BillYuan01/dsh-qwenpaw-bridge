# 开发与测试

先读 [贡献指南](../AGENTS.md)；协议细节见 [protocol.md](protocol.md)，
已记录的集成结果见 [verification.md](verification.md)。本页的命令是按任务选择的入口，不是要全部执行的清单。

## 架构与配置

```text
ACP client -> stdin NDJSON -> inbound gate -> stock dsh-acp
ACP client <- stdout NDJSON <- outbound relay <- stock dsh-acp
                                      ^
                         agent/assistant-stream
```

[根 patch](../cordis.patch.yml) 在 dsh-base、dsh-acp-app 之后应用，替换 stock acp 行，
保留 acp-app-startup。profile patch 最后合并，不应再插入第二行 bridge。
源码职责表见 [AGENTS.md](../AGENTS.md)。

bridge 配置项：

| 配置 | 默认/用途 |
| --- | --- |
| streaming | true；false 时不订阅 live 事件 |
| permissionPresets / permission_presets | true；false 时拒绝 bridge 自有权限热切换 |
| models | true；false 时省略模型目录 |
| provider、model | 显式完整路由，否则尝试 agentDefaultModel |
| reasoningEffort / reasoning_effort | 可选推理强度；相同默认路由可继承默认强度 |
| sessionListPageSize | 如提供，透传 stock ACP |

部分 provider/model 不构成路由；没有完整默认路由时不伪造选择。
目录读取失败可降级；权限默认值、actual、confirmed 和 fallback 不可混用。
`DSH_QWENPAW_BRIDGE_DEBUG=1` 提升现有 logger 的诊断级别，不向 stdout 另加日志。
日志及异常文本同样需要隐私审查。

## 默认离线检查

无需 DSH、真实凭据或网络，使用已安装的 Node：

```sh
tools/run-safe-checks.sh
tools/run-safe-checks.sh --list
bash tools/tests/test-runner.sh
```

runner 使用一次性 fake HOME/DSH_HOME/TMPDIR 和 `env -i` allowlist，默认选择
protocol 与 permission_boundaries 两套 Node 测试及 JS 语法检查。
当前入口预期 39 个 Node 测试；runner 自测为 5 项。预期数量不是本轮通过证据。
runner 不启动 DSH、不安装依赖、不执行 pack lifecycle scripts、不读真实凭据。

只改文档时，检查本地 Markdown 路径及 diff 即可；protocol 单测可选：

```sh
node --test test/protocol.test.js
git diff --check
```

protocol 的 4 项测试仅覆盖包名、版本和协议词汇一致性。
权限相关修改可选择 `node --test test/permission_boundaries.test.js`，使用 fake ctx/service，
覆盖默认值与 actual 分离、写后确认、初始 fallback、关闭功能后的别名/扩展拒绝等边界。
这些测试不证明真实 DSH 权限服务、模型目录或 live 流式行为。

## Helper 与隔离诊断

已有 Python >=3.10、PyYAML、Node >=22.9 时，可显式添加 helper 测试：

```sh
tools/run-safe-checks.sh --with-helpers --python /path/to/venv/bin/python
```

32 项 env-helper 与 6 项原子写入检查生成临时 home 和假值，不启动 DSH。
缺依赖时应明确失败，不自动安装，也不把 skip 当通过。
具体入口和限制见 [tools/README.md](../tools/README.md)。
真实 helper 从凭据派生 `.env`，会多一份明文副本；check/print 也会读凭据。
保留整文件拒绝多行 quoted 赋值/孤儿行、比较全部非托管键摘要的保守行为。
原子替换不代表父路径加固或并发锁，已同步文件也不会自动修复权限。

[diagnostics/README.md](../diagnostics/README.md) 描述的是另一类检查：它会启动 DSH。
即使不发 prompt，也可能运行插件、读凭据、写状态或联网，须单独确认。
使用一次性 fake HOME/DSH_HOME、清理继承 key/token 与 NODE_OPTIONS、限制 PATH，
尽可能限制网络；不链接真实凭据或 `.env`，不调用 prepare_home。
credential-service 与模型发现的因果仍未解决，不能把 helper 写成已证明的修复。
helper 的 Linux/macOS/原生 Windows 限制见工具文档，不能套用成 bridge 的平台结论。

## Live 验收不是默认测试

[test/probe.py](../test/probe.py) 会启动 DSH、发送真实 prompt、切换权限，可能产生费用。
它调用 [test/spike_lib.py](../test/spike_lib.py) 的 prepare_home：
即使 DSH_HOME 是临时目录，也可能链接调用者 home 下的真实 credential store。
dsh_env 会继承当前环境；ProbeClient 默认可能选择 allow，且实现读写文件回调。
不能直接拿来做安全 CI 或 fake-only 检查。

只有明确授权目标 home/profile、凭据来源、网络、费用、权限及私有输出位置后，才准备 live 环境。
probe 还需要所选 Python 环境中的官方 ACP SDK、已安装 profile 和有效模型路由。
缺少 profile 的 `not-verified` / exit 2 不是通过；不能为补齐检查自动安装或改 profile。
历史手动入口与测量保留在 [TESTING.md](../TESTING.md)，不作为当前操作指令自动执行。

逐项记录所验收能力：live 文本/推理、committed 无重复、关闭 live 的输出、目录和实际权限、
权限切换、取消与恢复等不能互相替代。某次路由要求非空目录/effort 或唯一 default，
不代表所有部署的固定条件。Linux 结果不构成 macOS 或 Windows 认证。
原始 dump、probe、日志、错误信息可能含路径、会话或秘密；公开前独立脱敏，只摘录必要事实。

## 文档与发布

根包版本仍是 **1.1.0**；main 上的文档可以晚于 `v1.1.0` tag 和已发布包。
本次文档整理不回写 tag，也不修改或重打已发布 TGZ/ZIP；从 tag 安装看到旧文档是预期差异。
当前组合说明是 qwenpaw-dsh 1.1.1 + bridge 1.1.0，状态卡仍独立为 0.1.0。

根 [package.json](../package.json) 的 files 仅含 lib、cordis.patch.yml、README、LICENSE、CHANGELOG，
npm 自动包含 package.json。docs、AGENTS、test、tools、diagnostics、status-plugin 不在根包清单中。
README 的深入文档链接面向仓库 checkout/网页；本次不扩大打包清单。
本包未发布到 npm registry，用户安装路径是官方 ACP 模板 + 固定 tag 的本地目录，不是裸包名安装。

普通文档修改无需 bump 版本，也不自动触发 commit、push、tag、pack、安装或 release。
获得单独的发布授权后：

1. 先定稿 README/CHANGELOG，再同步 package.json 与 BRIDGE_VERSION；破坏性 wire 变更才考虑改协议号。
2. 从最终源码按 files 清单构建，禁用 lifecycle scripts；不打入源码工具、测试、私有报告或凭据。
3. 核对成员、产物名、tag、包版本和 SHA256，跑相应离线检查，分别报告未跑的 live 项。
4. status-plugin 是否发版单独决定；公开发布仍以本次明确批准的目标和版本为限。
