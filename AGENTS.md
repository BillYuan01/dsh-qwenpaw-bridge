# Contributor guide

This repository maintains only the DSH-side bridge. Confirm the task scope,
read the relevant source, and make the smallest necessary change. Do not also
modify the QwenPaw-side repository, user profiles, the independent status card,
or someone else's uncommitted files unless explicitly in scope.

## Entry points and versions

- User entry: [README.md](README.md), with [Chinese README](README.zh-CN.md);
  wire contract: [docs/protocol.md](docs/protocol.md).
- Development and testing: [docs/development.md](docs/development.md);
  recent integration scope: [docs/verification.md](docs/verification.md).
- [TESTING.md](TESTING.md) is historical evidence, not proof that all current
  code passes.
- Root package: `1.1.0`; protocol: `1`; paired QwenPaw-side plugin:
  `qwenpaw-dsh 1.1.1`. Their version numbers need not match.
- Node >=22; DSH/dsh-acp `>=0.2.0-rc.2 <0.3.0-0`; independent status card `0.1.0`.
- [package.json](package.json) and [lib/protocol.js](lib/protocol.js) are the
  source of truth for versions.

## Source map

| File | Responsibility |
| --- | --- |
| [lib/index.js](lib/index.js) | Plugin entry, single stdio writer, connection state, initial route |
| [lib/inbound.js](lib/inbound.js) | Request tracking, permission gate, extension methods |
| [lib/outbound.js](lib/outbound.js) | Response metadata, configOptions, notification decoration |
| [lib/stream.js](lib/stream.js) | Live delta projection and committed-text deduplication |
| [lib/catalog.js](lib/catalog.js) | Provider/model/effort catalog and cache |
| [lib/presets.js](lib/presets.js) | Permission catalog, session read-back, preset writes and confirmation |
| [lib/toolkind.js](lib/toolkind.js) | Display categories for known tool names |
| [lib/protocol.js](lib/protocol.js) | Versions, protocol constants, JSON-RPC helpers |
| [cordis.patch.yml](cordis.patch.yml) | Replace the stock ACP row while preserving ACP app startup |

## Protocol invariants

- Reuse official dsh-acp; do not modify DSH core or add a second transport.
- stdout contains only ACP NDJSON frames. Use the existing logger and never
  include secrets.
- Put extensions in `result._meta.qwenpaw`; preserve other namespaces and
  original message fields.
- initialize has no session and cannot report actual session permissions.
  Resolve new/resume state against the corresponding session.
- Model identity is the provider/model pair; `selection_value` is its
  two-element array encoded as a JSON string.
- Catalogs and reasoning_efforts may be empty. Do not hard-code counts or
  unconditionally require exactly one default.
- Cache the catalog per connection and invalidate it on adapter updates. Do
  not cache deployment credentials or session facts across connections.
- Process live events only for sessions owned by this connection. Track text
  and reasoning deduplication flags separately for each attempt.
- Preserve image, tool, usage, and other updates. Disabling live preserves the
  committed path; do not promise replay after transport failure.
- Unknown `qwenpaw/*` methods return `-32601`. Accept extension names with or
  without the leading `_`; pass unrelated ACP frames through.

## Permission invariants

- **Default is not actual:** `default_permission_preset` is the profile default,
  never a substitute for session facts.
- `permission_preset` and the select's `currentValue` must come from actual
  read-back.
- When unknown, omit the actual value, set `permission_preset_known: false`,
  and omit any select without a truthful currentValue.
- If the actual value is outside the catalog, retain it in metadata but omit
  the select.
- **A write is not confirmation:** an explicit switch succeeds only after
  matching read-back. Unreadable or mismatching state returns `-32602`.
- An initial preset is a request, not an enforced precondition. Failure may
  still create a session; mark fallback/unconfirmed state.
- Safety-sensitive clients must check actual/known/confirmed and withhold
  prompts if requirements are not met: permissions must be handled fail-closed.
- `permissionPresets: false` must reject writes locally, not merely hide UI or
  forward requests to stock ACP.
- When disabled, standard permission_mode and both aliases return `-32602`;
  extension permission set/get return `-32601`, with zero service writes.
- `models: false` omits the catalog. `streaming: false` installs no live
  subscription and preserves committed output.
- Catalog and streaming failures may degrade gracefully (fail-soft). That is
  not a reason to describe permission failure as safe to continue.
- The profile controls default permissions. read-only is not a file-read path
  allowlist, and tool categorization is not authorization.
- Do not mask permission failures with automatic allow, full-access, or
  substitution of a default value.

## Checks and safety

- Inspect `git status --short` and the diff before starting and before delivery.
  Establish the source of out-of-scope changes before proceeding.
- Documentation-only work requires source cross-checks, local Markdown-path
  checks, and `git diff --check`; protocol unit tests are optional.
- Default offline entry: `tools/run-safe-checks.sh`. It does not start DSH,
  install dependencies, or read real credentials.
- Permission unit tests use fake ctx/service objects. Passing them is not
  acceptance of the real DSH permission service.
- Helper tests require explicit `--with-helpers`. Report missing dependencies
  as a blocker; do not install them automatically.
- Keep DSH diagnostics separate from fake-only helper tests. Even without a
  prompt, DSH may read credentials, write state, or access the network.
- **Never run the live probe by default:** `test/probe.py` calls `prepare_home`
  in `test/spike_lib.py`.
- `prepare_home` may link the caller's real credential store. A temporary
  DSH_HOME is not isolation.
- `dsh_env` inherits the environment; it is not a secret allowlist.
  ProbeClient may automatically allow requests and implements file-read/write
  callbacks.
- Live tests require separate confirmation of home/profile, credentials,
  network access, cost, permissions, and output location.
- For isolated diagnostics, use fake HOME/DSH_HOME, clear keys/tokens and
  NODE_OPTIONS, restrict PATH, and do not call prepare_home.
- Do not read or disclose real `.env` files, credential stores, keys, tokens,
  or private configuration without explicit authorization for that action.
- Dumps, probes, logs, and error text may contain secrets. Redact separately
  before publication; never upload raw output directly.
- Use synthetic public examples, with no private paths, IP addresses,
  usernames, session identifiers, or internal acceptance artifacts.
- Even helper check/print modes read credentials. The helper is not a secret
  manager; the causal link between credential-service and model discovery
  remains unresolved.
- The status card samples at startup only. Do not automatically install,
  restart, or add cron jobs.

## Documentation, releases, and delivery

- Read the original before a full rewrite; use precise edits for partial
  changes. Documentation-only work must not change code, tests, dependencies,
  or package versions.
- Main-branch documentation may be newer than a published tag. Do not rebuild
  released TGZ/ZIP artifacts just to add documentation; see the development guide.
- Releases require separate authorization. There is no standing permission to
  commit, push, tag, pack, publish to npm, or create a GitHub Release.
- Dependency installation, profile changes, access to real credentials,
  restarts, and model calls each require the corresponding authorization.
- Once a release is authorized, finalize README/CHANGELOG before synchronizing
  package and BRIDGE_VERSION. Consider a protocol bump only for breaking wire
  changes.
- Package final source according to package.files, with lifecycle scripts
  disabled. Check members, versions, tag, SHA256, and offline checks.
- Release status-plugin independently; do not bump it automatically with the
  root package. Keep source tools, tests, and diagnostic artifacts out of the
  root package.
- Deliver exact changed paths, checks actually run, failures, and checks not
  run. Distinguish historical evidence, current passes, and unverified abilities.
- Do not claim all bridge features were exercised based on syntax checks,
  fake tests, or integration results from another repository.
