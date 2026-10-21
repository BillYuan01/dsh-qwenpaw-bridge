# dsh-qwenpaw-bridge — test evidence

This file keeps two kinds of evidence separate:

1. **Historical evidence** from the `qwenpaw-dsh` monorepo (2026-10-18) — kept
   for context, **not re-run** after the split;
2. **Current evidence** for this standalone repository (2026-10-21) — the
   commands and outputs measured during the migration.

The bridge's acceptance surface is the ACP wire, not the QwenPaw plugin. The
historical s01–s06 contract suite is therefore cited as integration context, not
as proof of the bridge's `_meta`/streaming behavior.

## Environment

| Item | Historical (monorepo) | Current (this repo) |
|---|---|---|
| DSH | `0.2.0-rc.2` | `0.2.0-rc.2` |
| Node | `v22.23.2` | `v22.23.2` |
| Python | `3.12.14` (`~/.qwenpaw/venv`) | `3.12.14` (`~/.qwenpaw/venv`) |
| Route | `opencode-go/deepseek-v4.1-flash` | `opencode-go/deepseek-v4.1-flash` + `deepseek-official` models |
| Profile | `dsh-base` + `dsh-acp-app` + old scoped package | `dsh-base` + `dsh-acp-app` + `dsh-qwenpaw-bridge` |
| pnpm | not available | **not available** (`dsh plugin add` not executed) |

## Historical evidence (monorepo, 2026-10-18)

All numbers below came from a single Linux workstation with an isolated
`DSH_HOME`, a real model route, and the pre-split scoped package. They are
retained as a baseline; the standalone repo did not re-run the full suite.

### Live streaming

Long prompt: *"Write a single plain-prose paragraph of about 300 words
describing the ocean. No headings, no lists, no tools."*

| Measurement | Stock `acp` | Bridge v0.1 (historical) |
|---|---:|---:|
| answer chars | 1672 / 1826 | 1573–1655 |
| `agent_message_chunk` count | 1 | 93–172 |
| live chunks (`messageId` = `qwenpaw-live-…`) | 0 | all text chunks |
| committed text chunks | 1 | 0 |
| first chunk at | end of step | ~2–11 s |

The bridge also projected reasoning: `agent_thought_chunk` follows the same
`reasoning-delta` path.

### Committed fallback

| Committed-mode run | Historical value |
|---|---:|
| `agent_message_chunk` count | 1 |
| committed text chunks | 1 |
| answer chars | 1682 |
| meta `streaming` | `false` |

### `_meta['qwenpaw']` catalog

`initialize` and `session/new` both returned the complete catalog in one shot.
The historical route exposed **4 models**:

| provider | model | reasoning efforts | default |
|---|---|---:|---|
| `opencode-go` | `deepseek-v4.1-flash` | `low, high, max` | ✅ |
| `opencode-go` | `glm-5.3-flash` | `low, high, max` | |
| `deepseek-official` | `deepseek-flash` | `off, low, high, max` | |
| `deepseek-official` | `deepseek-v4-pro` | `off, low, high, max` | |

A later route in the same environment also exposed `mimo-v2.6-flash`, making
**5** models. The count is route-dependent; the invariant is non-empty catalog +
per-model efforts + exactly one default.

### Permission presets

`_meta['qwenpaw'].permission_presets` advertised `read-only`,
`workspace-write`, `danger-full-access`; `configOptions` gained a
`permission_mode` select. `session/set_config_option` switched to `read-only`,
`qwenpaw/permission/set` switched back, and the process PID stayed `11` / `11`.
A new session with `_meta.qwenpaw.permission_preset = "read-only"` honoured the
request.

### Historical contract suite

| Run | Result |
|---|---|
| `acp` profile (stock DSH) | 6 passed, 80.57 s |
| `qwenpaw` profile (bridge) | 6 passed, 66.04 s |

These runs exercise the generic ACP integration (s01–s06). They are **not** a
substitute for the bridge probe. s01's incremental-streaming check is optional,
so a 6-pass run can still contain only one chunk.

## Current evidence (standalone repo, 2026-10-21)

Because pnpm is absent on this machine, the `dsh plugin add` path was **not**
executed. To exercise the code, a temporary `DSH_HOME` was constructed manually:

```sh
export DSH_HOME=$(mktemp -d)
dsh --profile qwenpaw --from-default-profile acp --dump-config >/dev/null

# manual stand-in for `dsh plugin add`: dependency + bundle selection + symlink
# (a real install uses pnpm and writes the same manifest shape)
# node_modules/dsh-qwenpaw-bridge -> <this repository>
```

The sample route from `examples/profile/cordis.patch.yml` was used. Evidence
files: `/tmp/bridge-probe.json`, `/tmp/bridge-committed.json`,
`/tmp/npm-pack.json`.

### Syntax and version test

```sh
for f in lib/*.js; do node --check "$f"; done
node --test test/protocol.test.js
```

Result: `node --check` passed for all eight `lib/*.js` files; the Node test
reported `tests 4`, `pass 4`, `fail 0`. It asserts
`BRIDGE_VERSION === package.json.version`, `BRIDGE_NAME === package.json.name`,
an unscoped package name, and `META_PROTOCOL === 1`.

### Package contents

```sh
npm pack --dry-run
```

Result: 13 files, exactly:

```text
CHANGELOG.md
LICENSE
README.md
cordis.patch.yml
lib/catalog.js
lib/inbound.js
lib/index.js
lib/outbound.js
lib/presets.js
lib/protocol.js
lib/stream.js
lib/toolkind.js
package.json
```

No `profile/install.sh`, no static profile `package.json`, no old scoped-package string,
and no test files. `package.json` is always included by npm.

### Profile composition

```sh
dsh --profile qwenpaw --dump-config > /tmp/qwenpaw.dump
```

Result: exit 0, 412 lines. In the composed tree:

| Row | Result |
|---|---|
| `qwenpaw-bridge` | exactly 1 row, `name: dsh-qwenpaw-bridge`, config `streaming/permissionPresets/models: true` |
| `acp` | exactly 1 row, `disabled: true` |
| `acp-app-startup` | present, `name: '@deepseek-ai/dsh-acp-app'` |

This confirms the bundle patch disables the stock transport without removing
`acp-app-startup`.

### Live probe

```sh
~/.qwenpaw/venv/bin/python test/probe.py \
    --dsh-home "$DSH_HOME" --profile qwenpaw
```

Result: `status: pass`, all 19 checks true.

| Measurement | Current value |
|---|---:|
| text chunks | 334 |
| live chunks (`qwenpaw-live-…`) | 334 |
| committed text chunks | **0** |
| answer chars | 1650 |
| elapsed | 8.93 s |
| models | 4 (route-dependent) |
| models with efforts | 4 / 4 |
| exactly one `default: true` | yes (`opencode-go/deepseek-v4.1-flash`) |
| permission switch | `workspace-write` → `read-only` |
| PID before / after | `43161` / `43161` |
| switch back via `qwenpaw/permission/set` | yes |
| requested initial preset on `session/new` | `read-only` applied |

Checks: `initialize_meta_present`, `models_nonempty`,
`every_model_has_efforts`, `exactly_one_default_model`,
`every_model_has_provider_and_selection`, `presets_advertised`,
`streaming_advertised`, `session_meta_present`, `session_meta_repeats_models`,
`permission_config_option_present`, `permission_current_matches_meta`,
`answer_nonempty`, `live_chunks_gt_20`, `no_committed_text_duplicate`,
`live_message_ids`, `permission_switch_result`,
`permission_switch_no_restart`, `permission_switch_back`,
`requested_initial_preset_applied`.

### Committed fallback

```sh
~/.qwenpaw/venv/bin/python test/probe.py \
    --dsh-home "$DSH_HOME" --profile qwenpaw --committed
```

Result: `status: pass`. `text_chunk_count = 1`,
`committed_text_chunk_count = 1`, `live_chunk_count = 0`, answer 1768 chars,
`_meta.streaming = false`, and the permission switch kept PID `43202` / `43202`.

## Not verified

| Item | Why |
|---|---|
| `dsh plugin --profile qwenpaw add dsh-qwenpaw-bridge` | pnpm is not installed on this machine; the command exits 127 before installing. The profile was constructed manually to test the code path. |
| npm publish | No npm authentication was used; this migration deliberately did not publish. |
| DSH 0.3 compatibility | DSH 0.3 is not installed; the peer range intentionally excludes it until retested. |
| Historical s01–s06 suite against this repo | The suite lives in the QwenPaw-side repository and was not re-run here. The historical 6/6 result is context, not current evidence. |
| QwenPaw console permission switching | The probe proves the **ACP bridge** hot switch keeps the dsh PID. The QwenPaw plugin's own `approval_level` → `DSH_PERMISSION_MODE` mapping can still restart its worker; that is outside this repository. |
| A fixed model count (5) | Model count follows the configured provider route. Current route exposed 4. |

## Acceptance commands

Run these against an installed profile:

```sh
# 1. static checks
for f in lib/*.js; do node --check "$f"; done
node --test test/protocol.test.js
npm pack --dry-run

# 2. profile composition
dsh --profile qwenpaw --dump-config > /tmp/qwenpaw.dump
grep -c -- "- id: qwenpaw-bridge" /tmp/qwenpaw.dump          # 1
grep -A12 -- "- id: acp$" /tmp/qwenpaw.dump | grep "disabled: true"
grep -A2 -- "- id: acp-app-startup" /tmp/qwenpaw.dump

# 3. live probe
~/.qwenpaw/venv/bin/python test/probe.py \
    --dsh-home "$DSH_HOME" --profile qwenpaw \
    | tee /tmp/bridge-probe.json
jq -e '.status == "pass"' /tmp/bridge-probe.json
jq -e '.observations.long_prompt.live_chunk_count > 20' /tmp/bridge-probe.json
jq -e '.observations.long_prompt.committed_text_chunk_count == 0' /tmp/bridge-probe.json
jq -e '[.observations.initialize_meta.models[] | select(.default == true)] | length == 1' /tmp/bridge-probe.json

# 4. committed fallback
~/.qwenpaw/venv/bin/python test/probe.py \
    --dsh-home "$DSH_HOME" --profile qwenpaw --committed \
    | tee /tmp/bridge-committed.json
jq -e '.status == "pass"' /tmp/bridge-committed.json
jq -e '.observations.long_prompt.committed_text_chunk_count == 1' /tmp/bridge-committed.json
jq -e '.observations.initialize_meta.streaming == false' /tmp/bridge-committed.json

# 5. permission switch kept the process
jq -r '.observations.permission_switch |
  "pid \(.pid_before) -> \(.pid_after)"' /tmp/bridge-probe.json
```

`probe.py` does not create a profile. If `$DSH_HOME/profiles/qwenpaw/package.json`
is missing it prints `"status": "not-verified"` and exits 2.

## Known limitations

- Live deltas are not buffered/replayed: if a client disconnects mid-attempt,
  the partial live text is what it received (standard ACP has no retraction).
- A failed model attempt's deltas are not retracted before a retry; the
  transcript may show the abandoned prefix followed by the retry.
- `messageId` for live chunks is `qwenpaw-live-<attemptId>`; committed
  `messageId` values are DSH's own UUIDs. Clients that key on `messageId`
  should treat the two namespaces separately.
- The model catalog is a snapshot per connection, invalidated by
  `llm/adapters-updated`; it is not a live subscription.
- `@agentclientprotocol/sdk` remains a peer because it is also a dependency of
  `@deepseek-ai/dsh-acp`; declaring it as a direct dependency could produce a
  second SDK copy.
