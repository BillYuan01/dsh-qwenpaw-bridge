# dsh-qwenpaw-bridge

A **DSH bundle plugin** that upgrades the stock `acp` profile for QwenPaw
without touching DSH core. It keeps the wire **standard ACP**: QwenPaw still
talks to `@deepseek-ai/dsh-acp`, so the adapter needs no private protocol.

This is the standalone repository for the bridge. The QwenPaw-side plugin lives
in [`BillYuan01/qwenpaw-dsh`](https://github.com/BillYuan01/qwenpaw-dsh); the
bridge can be installed and tested without it.

> The upstream half of this idea (opt-in streaming inside `dsh-acp` itself)
> remains open; this package is the plugin half and needs no DSH core changes.

## What it adds

| # | Capability | Wire surface | Fail-soft behavior |
|---|---|---|---|
| 1 | **Live streaming** | standard `session/update` with `agent_message_chunk` / `agent_thought_chunk` from `agent/assistant-stream` `text-delta` / `reasoning-delta`; duplicate committed text/thought suppressed | event missing / subscription fails / client opts out → stock committed projection, unchanged |
| 2 | **Permission presets, hot-switchable** | `_meta['qwenpaw'].permission_presets` + a `permission_mode` select in `configOptions`; switch through `session/set_config_option` or `qwenpaw/permission/set` | `ctx.permissionPresets` missing → no option advertised, and `permission_mode` switches are rejected with `-32602` (no silent fallback) |
| 3 | **Model catalog** | `_meta['qwenpaw'].models` on `initialize` and `session/new`; every model carries its `reasoning_efforts` | `ctx.llm` lookup failure → field omitted, no crash |
| 4 | Tool kind polish (optional) | `tool_call.kind` mapped from the tool name (`read`/`edit`/`execute`/`search`/`fetch`) | unknown names stay `other` |

Everything else (images, tool updates, usage, config updates, MCP, resume,
cancel) is forwarded verbatim.

## Requirements

| Requirement | Value |
|---|---|
| Node | `>= 22` |
| DSH | `>= 0.2.0-rc.2 < 0.3.0-0`, declared as `engines.dsh` (the `<0.3.0-0` upper bound excludes 0.3 prereleases) |
| `@deepseek-ai/dsh-acp` | same range, supplied by the `dsh-acp-app` bundle |
| `@agentclientprotocol/sdk` | `^1.4.0`, supplied by `@deepseek-ai/dsh-acp` |
| pnpm | required by `dsh plugin add` (the CLI shells out to pnpm) |
| Client | any ACP client; QwenPaw is the reference consumer |

DSH checks `engines.dsh` before it loads a plugin, and falls back to the
`@deepseek-ai/dsh*` peer ranges only when that field is absent. Both are
evaluated with prerelease-inclusive semver (`includePrerelease: true` in
`dsh-app-boot`), which is why the prerelease versions this project targets —
`0.2.0-rc.2`, `0.2.1-rc.2` — satisfy the range. An incompatible DSH needs an
explicit `dsh plugin --profile <name> allow-version ...` exemption; do not
bypass it for a real deployment. An unsatisfied range drops the plugin silently
at profile boot, so verify after upgrading DSH.

## Install

### 1. Create the profile from the shipped `acp` template

`qwenpaw` is not a shipped profile, so create it first. This is important:
`dsh plugin add` on a brand-new name initializes only `dsh-base`, which has no
ACP app and therefore no `acp-app-startup` row.

```sh
# initialize the profile and exit immediately (do not boot ACP here)
dsh --profile qwenpaw --from-default-profile acp --dump-config >/dev/null
```

Without `--dump-config` the profile boots its app, which for `acp` waits on
stdin; use the command above for setup.

### 2. Install the bridge into that profile

```sh
# published package
dsh plugin --profile qwenpaw add dsh-qwenpaw-bridge

# local checkout (works before the first npm release)
dsh plugin --profile qwenpaw add /absolute/path/to/dsh-qwenpaw-bridge
```

`dsh plugin add` runs pnpm in `$DSH_HOME/profiles/qwenpaw`, writes the
`package.json` dependency and appends the bundle to `dsh.profile.bundles`. It
needs pnpm on `PATH`; without pnpm the command exits 127 and installs nothing.

After the install the profile is:

```text
@deepseek-ai/dsh-base
@deepseek-ai/dsh-acp-app
dsh-qwenpaw-bridge
```

The bundle patch disables the stock `acp` row and inserts `qwenpaw-bridge`.
`acp-app-startup` is left in place: it owns stdin EOF and `--help`.

### 3. Supply the model route

The bundle defaults to `ctx.agentDefaultModel`. To pin a route, merge
`examples/profile/cordis.patch.yml` into
`$DSH_HOME/profiles/qwenpaw/cordis.patch.yml` and edit the provider, models and
API-key variable. Do **not** overwrite a patch that already has a route, and do
**not** add a second `qwenpaw-bridge` row — the bundle already inserts one.

The sample contains only `llm-pi-ai` + `agent-default-model`; the bridge row is
intentionally absent.

### 4. Boot

```sh
dsh --profile qwenpaw
```

## Verify the composition

```sh
dsh --profile qwenpaw --dump-config > /tmp/qwenpaw.dump

grep -A8 -- "- id: qwenpaw-bridge" /tmp/qwenpaw.dump
grep -A12 -- "- id: acp$" /tmp/qwenpaw.dump | grep "disabled: true"
grep -A2 -- "- id: acp-app-startup" /tmp/qwenpaw.dump
grep -c -- "- id: qwenpaw-bridge" /tmp/qwenpaw.dump   # must print 1
```

Expected: `qwenpaw-bridge` exists exactly once, its `name` is
`dsh-qwenpaw-bridge`, the `acp` row has `disabled: true`, and
`acp-app-startup` is present.

## `_meta['qwenpaw']` contract (protocol = 1)

`initialize` result:

```jsonc
{
  "_meta": {
    "qwenpaw": {
      "protocol": 1,
      "bridge": "dsh-qwenpaw-bridge",
      "version": "0.1.0",              // always package.json.version
      "streaming": true,
      "models": [
        {
          "id": "deepseek-v4.1-flash",
          "name": "DeepSeek V4.1 Flash",
          "provider": "opencode-go",
          "provider_name": "opencode-go",
          "selection_value": "[\"opencode-go\",\"deepseek-v4.1-flash\"]",
          "description": "…",              // optional
          "context_window": 1000000,       // optional
          "max_tokens": 384000,            // optional
          "input_modalities": ["text", "image"], // optional
          "reasoning_efforts": [{"id": "low", "name": "Low"}, …],
          "default_reasoning_effort": "high",    // optional
          "default": true                  // current route
        }
      ],
      "current_model": {"provider": "opencode-go", "model": "deepseek-v4.1-flash"},
      "permission_presets": [{"id": "workspace-write", "name": "workspace-write"}, …],
      "default_permission_preset": "workspace-write",
      "permission_preset": "workspace-write"
    }
  }
}
```

`session/new` / `session/resume` results repeat the same object (with
`current_model`/`permission_preset` resolved for that session), and
`configOptions` gains:

```jsonc
{
  "id": "permission_mode",
  "name": "Permission mode",
  "category": "permission",
  "type": "select",
  "currentValue": "workspace-write",
  "options": [{"value": "read-only", "name": "read-only"}, …]
}
```

The model count is **route-dependent**. Do not hard-code a number in a client;
assert non-empty, per-model efforts, and exactly one `default: true`.

### Client-side switches

```jsonc
// standard ACP: hot switch, no process restart
{"method": "session/set_config_option",
 "params": {"sessionId": "…", "configId": "permission_mode", "value": "read-only"}}

// optional private helpers (ACP extension methods; the SDK sends the leading
// underscore automatically: `_qwenpaw/permission/set`)
{"method": "qwenpaw/permission/set", "params": {"sessionId": "…", "preset": "read-only"}}
{"method": "qwenpaw/permission/get", "params": {"sessionId": "…"}}
{"method": "qwenpaw/streaming/set", "params": {"enabled": false}}
```

An initial preset can be requested in `session/new`:
`params._meta.qwenpaw.permission_preset = "read-only"`.

To opt out of live deltas for a connection, send
`initialize._meta.qwenpaw.streaming = false`; the response then advertises
`"streaming": false` and the stock committed projection is used.

## Package layout

```text
lib/index.js      plugin entry: inject acp services + acpAppStartup, build the ACP stream, call acp.apply
lib/inbound.js    bridge-owned requests; permission_mode interception
lib/outbound.js   _meta decoration, committed-duplicate suppression, config options
lib/stream.js     agent/assistant-stream -> session/update; duplicate flags
lib/catalog.js    provider/model/efforts discovery for _meta
lib/presets.js    ctx.permissionPresets projection + switch
lib/toolkind.js   tool name -> ACP kind
lib/protocol.js   _meta key, bridge name/version, config ids, response helpers
cordis.patch.yml  disables `acp`, inserts `qwenpaw-bridge`
examples/profile/cordis.patch.yml
                  sample model route (no bridge row)
test/probe.py     live acceptance probe (streaming / meta / presets / committed fallback)
test/spike_lib.py self-contained ACP client helpers used by the probe
test/protocol.test.js
                  asserts BRIDGE_VERSION == package.json.version
status-plugin/    host-only web-profile plugin: QwenPaw connection card
CHANGELOG.md
```

There is no `profile/install.sh` and no static profile `package.json` in this
repository: profile creation and package installation are owned by `dsh`.

## Web UI status card (`status-plugin/`)

`status-plugin/` is a separate, host-only DSH **web** plugin. It adds a
**QwenPaw 桥接状态** card under **插件 → 已安装** and probes QwenPaw's
`/api/harnesses` when the web profile boots:

- **Green + 运行中** — QwenPaw is reachable and its `dsh` backend is available.
- **Red + 失败** — QwenPaw is down, or the `dsh` backend is unavailable; open
  the card for the error.

Install it into the **web** profile (not `qwenpaw`):

```sh
dsh plugin --profile web add /path/to/dsh-qwenpaw-bridge/status-plugin
# restart dsh web / dsh-web.service
```

The bridge itself remains the `qwenpaw`-profile package at this repository's
root; the status card only reports whether QwenPaw is connected. It samples at
web-profile boot, so a later disconnect needs a web restart to turn red.

## Development checks

```sh
for f in lib/*.js; do node --check "$f"; done
node --test test/protocol.test.js
npm pack --dry-run
```

The tarball must contain `lib/`, `cordis.patch.yml`, `README.md`, `LICENSE` and
`CHANGELOG.md`, and must not contain `profile/install.sh`, a static profile
manifest, or any reference to the old scoped package name.

The live probe requires an installed `qwenpaw` profile and real model
credentials:

```sh
~/.qwenpaw/venv/bin/python test/probe.py \
    --dsh-home "$DSH_HOME" --profile qwenpaw

# committed-mode fallback
~/.qwenpaw/venv/bin/python test/probe.py \
    --dsh-home "$DSH_HOME" --profile qwenpaw --committed
```

The probe never creates or rewrites a profile. If the profile is missing it
reports `not-verified` and exits 2.

## Compatibility / failure policy

- **No DSH core changes**; the stock `@deepseek-ai/dsh-acp` `apply()` is reused
  directly with a custom `config.stream` (the same runtime-only field the
  community `dsh-acp-door` uses).
- **Non-public dependencies are optional**: `agent/assistant-stream`,
  `ctx.permissionPresets`, `ctx.llm` catalog calls, and `ctx.agentDefaultModel`
  are all read defensively. Missing anything degrades to plain committed ACP.
- **Version range**: `engines.dsh` (and, for older DSH versions that only read
  peers, the `@deepseek-ai/dsh*` peer ranges) is `>=0.2.0-rc.2 <0.3.0-0`. The
  upper bound deliberately excludes `0.3.0-rc.1`; a 0.3 runtime must be
  retested before widening the range.

See `TESTING.md` for historical monorepo evidence and the evidence measured for
this standalone repository.

## License

MIT. See `LICENSE`.
