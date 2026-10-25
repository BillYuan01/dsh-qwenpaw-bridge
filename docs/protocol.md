# ACP 扩展协议

本说明对应 bridge 1.1.0、`_meta.qwenpaw.protocol = 1`。
传输仍是 stdio 上的 NDJSON / JSON-RPC ACP，底层复用官方 dsh-acp。
不识别扩展的客户端可以忽略附加元数据，继续使用标准 ACP。

## 元数据与模型目录

initialize、session/new、session/resume 响应在 `result._meta.qwenpaw` 中附加信息。
下面只是 initialize 的示意片段，不是完整 ACP 响应；模型和 provider 均为占位值：

```json
{
  "_meta": {
    "qwenpaw": {
      "protocol": 1,
      "bridge": "dsh-qwenpaw-bridge",
      "version": "1.1.0",
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
      "permission_preset_known": false,
      "permission_preset_reason": "session-unavailable",
      "initialized": true
    }
  }
}
```

**initialize 没有会话，不含 `permission_preset` actual。**
这里的 read-only 仅为示例 profile 默认值，不能证明后续会话权限。
`initialized` 只在 initialize 响应中标记；new/resume 的当前模型和权限按会话读取。

模型字段约定：

- 身份由 provider/model 联合确定，不能只按 model ID 跨 provider 匹配。
- `selection_value` 为 `[provider, model]` 的 JSON 字符串。
- `reasoning_efforts` 始终为数组，详情不可用时可为空。
- 可选字段包括 description、context_window、max_tokens、input_modalities、default_reasoning_effort。
- `current_model` 可附带 reasoning_effort；`default` 标记匹配当前选择的目录项。
- 仅当当前路由在目录中且身份唯一时，才应预期恰好一个 default。
- 模型数取决于部署，目录可以为空；`models: false` 时省略 models 字段。
- 目录按连接缓存，收到 `llm/adapters-updated` 后失效。
- 查询失败可跳过失败 provider、保留缺少可选详情的模型或返回空目录；不保证模型可调用。

## 权限状态

| 字段 | 含义 |
| --- | --- |
| `default_permission_preset` | profile 的进程级默认，不是会话事实 |
| `permission_preset` | 从该会话回读到的实际预设，仅已知时提供 |
| `permission_preset_known` | actual 是否已知 |
| `permission_preset_reason` | actual 未知的原因，例如 service-unavailable、session-unavailable、read-failed |
| `requested_permission_preset` | 客户端为 new/resume 请求的初始预设 |
| `permission_preset_confirmed` | 初始请求是否与回读一致；没有请求时省略 |
| `permission_preset_fallback` | 初始请求未确认应用时为 true |
| `permission_preset_disabled` | bridge 权限预设功能关闭时为 true |

服务不可用、current 方法缺失、会话不可用、回读为空或抛错时，不用默认值补 actual。
只有 actual 已知且在预设目录中，才增加标准配置项：

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

实际值不在目录中时，元数据保留实际值，但省略该 select。
read-only 是 DSH 权限预设，不是路径白名单；bridge 不定义文件可读范围。

## 权限切换

优先使用标准 ACP 配置方法。以下为 method/params 片段，session ID 是合成值：

```json
{"method":"session/set_config_option","params":{"sessionId":"example-session","configId":"permission_mode","value":"read-only"}}
```

标准配置入口也接受 `permission_preset`、`permissionPreset` 两个 configId 别名。
扩展方法如下；ACP SDK 自动添加前导 `_`，bridge 接受带或不带 `_` 的拼写。

| 方法 | 参数 | 结果要点 |
| --- | --- | --- |
| `qwenpaw/permission/set` | sessionId、preset | 确认后的 actual、目录及 configOptions |
| `qwenpaw/permission/get` | sessionId | actual/known、目录及 configOptions；未知不填默认值 |
| `qwenpaw/streaming/set` | enabled | 当前连接的 streaming 状态 |

permission/set 也接受 permission_preset、permissionPreset 作为 preset 参数别名。
未知 `qwenpaw/*` 方法返回 `-32601`。

显式切换必须满足服务、会话和预设有效，标准入口还会验证预设在目录中。
`service.set()` 不抛异常只代表写入调用完成；**回读与请求一致才算成功**。
不可回读或值不一致均返回 `-32602`，error.data 包含：

- `permission_preset_written: true`、`permission_preset_confirmed: false`；
- 不可回读时包含 `permission_preset_reason`，不一致时包含 `permission_preset_actual`。

客户端应停止执行并重新读取权限，不得将错误当作已切换或自动提升权限。
bridge 内的直接切换不重启进程；QwenPaw 自己切换审批等级是否重启 worker 属于另一端行为。

### 初始请求与关闭功能

new/resume 可在 `params._meta.qwenpaw.permission_preset` 请求初始预设。
也接受 permissionPreset、permission_mode 及 bare `_meta` 下的对应别名。
请求不构成强制前置条件：无法应用时仍可能创建会话，返回 requested、confirmed=false 和 fallback=true。
安全敏感客户端必须核验 actual/known/confirmed，不符合要求就不发 prompt。

`permissionPresets: false` 不是只隐藏配置项：

- 不广告目录，actual 未知，返回 disabled=true。
- 标准 permission_mode 及别名返回 `-32602`；扩展 permission/set、permission/get 返回 `-32601`。
- 本地拒绝这些请求，不转交 stock ACP，预设服务写入次数为零。
- 初始请求仍可能 fallback；关闭的是 bridge 自有热切换面，不是 DSH/stock 的所有权限能力。
- profile 默认权限保持由 DSH 管理，不能由此推断会话是 read-only。

## 流式与其他通知

`agent/assistant-stream` 的 text-delta / reasoning-delta 分别投影为标准
`agent_message_chunk` / `agent_thought_chunk`。只处理本连接拥有的会话。
按模型 attempt 分别记录文本和推理标志，抑制对应的 committed 文本副本；
end 后保留标志至下次 start，避免排队到达的 committed 消息重复追加。
图像、工具、用量等其他更新不因此丢弃。

initialize 的 `params._meta.qwenpaw.streaming: false` 可关闭当前连接 live。
扩展 streaming/set 可改变连接状态；profile 配置 `streaming: false` 则根本不安装 live 订阅，
之后切换连接状态也不会创建该订阅。缺少 live 事件、订阅失败或关闭 live 时保留 committed 路径。
`streaming: true` 表示启用状态，不是收到增量的证明，也不承诺写入失败后的可靠重放。

工具分类只为已知工具名补充 read/edit/execute/search/fetch，保留已有非 other 分类；不是授权判断。
元数据装饰异常会转发原帧，这是可用性降级，不是权限已满足的证据。
权限请求失败和初始 fallback 必须由客户端按 fail-closed 处理。
