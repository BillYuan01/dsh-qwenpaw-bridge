# Development and testing

Read the [contributor guide](../AGENTS.md) first. See [protocol.md](protocol.md)
for the wire contract and [verification.md](verification.md) for recorded
integration results. Commands here are task-specific entry points, not a
checklist to run in full.

## Architecture and configuration

```text
ACP client -> stdin NDJSON -> inbound gate -> stock dsh-acp
ACP client <- stdout NDJSON <- outbound relay <- stock dsh-acp
                                      ^
                         agent/assistant-stream
```

The [root patch](../cordis.patch.yml) applies after dsh-base and dsh-acp-app,
replaces the stock acp row, and preserves acp-app-startup. The profile patch
merges last; it should not insert a second bridge row. See
[AGENTS.md](../AGENTS.md) for the source map.

Bridge configuration:

| Setting | Default / purpose |
| --- | --- |
| streaming | true; false prevents subscribing to live events |
| permissionPresets / permission_presets | true; false rejects the bridge's own permission hot-switch requests |
| models | true; false omits the model catalog |
| provider, model | Explicit complete route, otherwise try agentDefaultModel |
| reasoningEffort / reasoning_effort | Optional effort; a matching default route may supply its default effort |
| sessionListPageSize | Passed through to stock ACP when supplied |

A partial provider/model pair is not a route. Do not fabricate a selection
without a complete default route. Catalog failures may degrade gracefully;
permission default, actual, confirmed, and fallback must remain distinct.
`DSH_QWENPAW_BRIDGE_DEBUG=1` raises diagnostic verbosity through the existing
logger, without adding stdout logs. Logs and exception text also require
privacy review.

## Default offline checks

Use the installed Node runtime; no DSH, real credentials, or network required:

```sh
tools/run-safe-checks.sh
tools/run-safe-checks.sh --list
bash tools/tests/test-runner.sh
```

The runner uses throwaway fake HOME/DSH_HOME/TMPDIR and an `env -i` allowlist.
By default it selects the protocol and permission_boundaries Node suites plus
JS syntax checks. The current entry expects 39 Node tests; the runner has 5
self-tests. Expected counts are not evidence of a pass in the current task.
It does not start DSH, install dependencies, run pack lifecycle scripts, or
read real credentials.

For documentation-only edits, check local Markdown paths and the diff; the
protocol unit suite is optional:

```sh
node --test test/protocol.test.js
git diff --check
```

The 4 protocol tests cover only package name, version, and protocol vocabulary
consistency. Permission changes may use
`node --test test/permission_boundaries.test.js`, with fake ctx/service objects
to cover default/actual separation, write confirmation, initial fallback, and
alias/extension rejection when disabled. These tests do not establish real
DSH permission-service, model-catalog, or live-streaming behavior.

## Helpers and isolated diagnostics

With an existing Python >=3.10, PyYAML, and Node >=22.9, explicitly opt into
helper tests:

```sh
tools/run-safe-checks.sh --with-helpers --python /path/to/venv/bin/python
```

The 32 env-helper checks and 6 atomic-write checks create temporary homes and
fake values without starting DSH. Report missing dependencies as failures;
do not install automatically or count a skip as a pass. See
[tools/README.md](../tools/README.md) for entry points and limits.
In real use, the helper derives `.env` from credentials, creating another
plaintext copy; check/print modes also read credentials. Preserve conservative
whole-file refusal for multiline quoted assignments/orphan lines and digest
comparison for every non-managed key. Atomic replacement is not ancestor-path
hardening or a concurrency lock. Already-synchronized files do not receive
automatic permission repair.

[diagnostics/README.md](../diagnostics/README.md) describes a different kind
of check: it starts DSH. Even without a prompt, this may run plugins, read
credentials, write state, or access the network, and requires separate
confirmation. Use throwaway fake HOME/DSH_HOME, clear inherited keys/tokens and
NODE_OPTIONS, restrict PATH, and limit network access where possible. Do not
link real credentials or `.env`, or call prepare_home.
The causal link between credential-service and model discovery remains
unresolved; do not describe the helper as a proven fix. The helper's
Linux/macOS/native Windows limits are documented in the tools guide and do
not establish bridge platform support.

## Live acceptance is not a default test

[test/probe.py](../test/probe.py) starts DSH, sends real prompts, switches
permissions, and may incur charges. It calls prepare_home in
[test/spike_lib.py](../test/spike_lib.py): even a temporary DSH_HOME may link
the caller's real credential store. dsh_env inherits the current environment.
ProbeClient may allow permission requests automatically and implements file
read/write callbacks. This is not safe CI or a fake-only check.

Prepare a live environment only after explicit authorization of the target
home/profile, credential source, network, cost, permissions, and private output
location. The probe also requires the official ACP SDK in the selected Python
environment, an installed profile, and a valid model route. A missing-profile
`not-verified` / exit 2 is not a pass; do not automatically install or change a
profile to complete checks. Historical manual entry points and measurements
remain in [TESTING.md](../TESTING.md); do not execute them as current
instructions automatically.

Record each capability separately: live text/reasoning, no duplicate committed
text, output with live disabled, catalog and actual permissions, switching,
cancellation, and resume are not interchangeable evidence. A route-specific
requirement for a nonempty catalog/effort or one default is not a universal
deployment invariant. Linux results do not certify macOS or Windows.
Raw dumps, probes, logs, and errors may contain paths, sessions, or secrets.
Redact independently before publication and extract only necessary facts.

## Documentation and releases

The root package remains **1.1.0**. Main-branch documentation may be newer than
the `v1.1.0` tag and released packages. This documentation update does not
rewrite the tag or modify/rebuild released TGZ/ZIP artifacts; older documents
in a fixed-tag checkout are expected. The current documented pairing is
qwenpaw-dsh 1.1.1 + bridge 1.1.0; the independent status card remains 0.1.0.

The root [package.json](../package.json) files list includes only lib,
cordis.patch.yml, README.md, LICENSE, and CHANGELOG.md; npm automatically adds
package.json. README.zh-CN.md, docs, AGENTS, test, tools, diagnostics, and
status-plugin are outside that list. README links to the Chinese version and
deeper documentation target a repository checkout or website. This change does
not expand package contents. The package is not published to the npm registry;
the installation path uses the official ACP template and a local directory
from a fixed tag, not a bare package name.

Ordinary documentation edits need no version bump and do not authorize commit,
push, tag, pack, installation, or release. After separate release authorization:

1. Finalize README/CHANGELOG, then synchronize package.json and BRIDGE_VERSION.
   Consider a protocol bump only for breaking wire changes.
2. Build from final source using the files list, with lifecycle scripts
   disabled. Exclude source tools, tests, private reports, and credentials.
3. Check members, artifact names, tag, package version, and SHA256. Run relevant
   offline checks and report unrun live checks separately.
4. Decide independently whether to release status-plugin. Public release
   remains limited to the explicitly approved target and version.
