# dsh-qwenpaw-bridge-status

A **host-only plugin for the DeepSeek Harness (`dsh`) web UI**. It adds a
**QwenPaw 桥接状态** card under **插件 → 已安装** and checks whether QwenPaw's
`dsh` backend is reachable when the web profile boots.

| Indicator | Meaning |
|---|---|
| Green dot + 运行中 | QwenPaw is reachable and the `dsh` backend is available |
| Red + 失败 | QwenPaw is down, or the `dsh` backend is unavailable; open the card for the error |

## Why this exists

The bridge itself ([`dsh-qwenpaw-bridge`](https://github.com/BillYuan01/dsh-qwenpaw-bridge))
is an ACP transport installed in the **`qwenpaw`** DSH profile. It cannot run
inside the **`web`** profile, so it does not appear in the web UI's plugin list.
This plugin lives in the web profile and reports whether that bridge's QwenPaw
side is connected.

## Install

```sh
# local checkout
dsh plugin --profile web add /absolute/path/to/dsh-qwenpaw-bridge/status-plugin
# or, after publishing to npm
dsh plugin --profile web add dsh-qwenpaw-bridge-status
```

Restart `dsh web` (or the `dsh-web.service` unit) after installing; the `web`
profile has no HMR by default. Then open **插件**, scroll to **已安装**, and open
**QwenPaw 桥接状态**.

## Behavior

- Probes `http://127.0.0.1:8088/api/harnesses` (override with
  `QWENPAW_API_BASE`) for a provider with `id: "dsh"`, `available: true`,
  `installed: true`.
- Retries for up to 12 seconds, then fails the row with a readable reason.
- **Startup-only**: the status is sampled when the web profile boots. If QwenPaw
  goes away later, restart the web service to refresh the card.

## License

MIT
