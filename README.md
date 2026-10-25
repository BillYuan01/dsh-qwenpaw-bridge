# dsh-qwenpaw-bridge

English | [简体中文](README.zh-CN.md)

A DSH-side bundle for using DeepSeek Harness (DSH) with QwenPaw. It reuses the
official `@deepseek-ai/dsh-acp` implementation without changing DSH core.

The bridge adds:

- Live answer and reasoning deltas as standard ACP chunks, with duplicate
  committed text suppressed.
- Per-session DSH permission-preset switching without restarting the bridge.
- A model catalog, reasoning efforts, and permission state in `_meta.qwenpaw`.

It also adds display categories such as read/edit/execute for known tool names.
Other ACP messages remain handled by the official implementation. This project
is **not a permission sandbox or a model-credential manager**.

## Versions and requirements

| Component | Requirement or current version |
| --- | --- |
| Bridge | **1.1.0**, metadata protocol **1** |
| QwenPaw side | Use with [qwenpaw-dsh **1.1.1**](https://github.com/BillYuan01/qwenpaw-dsh) |
| Node.js / pnpm | Node.js **>=22**; pnpm must be on `PATH` |
| DSH / dsh-acp | **>=0.2.0-rc.2 <0.3.0-0** |
| ACP SDK | `^1.4.0`, supplied by dsh-acp |
| Optional web status card | Independent `status-plugin` **0.1.0** |

The two repositories do not need matching versions. Recorded integration checks
used Linux, QwenPaw 2.2.2.post1, and DSH 0.2.1-rc.2. macOS and Windows have not
been verified; the commands below use a POSIX shell. See the
[verification record](docs/verification.md) for dated test scopes: the supported
version range is not evidence that every version has been tested.

## Install and run

These are manual user commands. They write a DSH profile and download
dependencies; starting the profile may call model services. Select `DSH_HOME`
and the target profile first, and back up existing configuration. If a profile
with the same name already exists, inspect it rather than overwriting it.

### 1. Create a profile from the official ACP template

```sh
dsh --profile qwenpaw --from-default-profile acp --dump-config >/dev/null
```

`qwenpaw` is the chosen profile name, not a DSH template name. Starting from
`acp` preserves the ACP app and `acp-app-startup`, which handles stdin EOF.
`--dump-config` generates/reads the configuration and exits instead of waiting
for ACP input.

### 2. Check out a fixed tag and install from the local directory

```sh
git clone --branch v1.1.0 https://github.com/BillYuan01/dsh-qwenpaw-bridge.git
dsh plugin --profile qwenpaw add /absolute/path/to/dsh-qwenpaw-bridge
```

Replace the path with your checkout location. **This package is not published
to the npm registry; do not install it by bare package name.** `dsh plugin add`
requires pnpm. A failure caused by missing pnpm is not a completed installation.

The expected bundle order is `dsh-base` → `dsh-acp-app` → `dsh-qwenpaw-bridge`.
The [root bundle patch](cordis.patch.yml) disables the stock `acp` row, inserts
one `qwenpaw-bridge` row, and preserves `acp-app-startup`. Do not add a second
bridge row by hand.

### 3. Configure a model route

The bridge uses DSH's `agentDefaultModel` by default. Adapt the
[profile patch example](examples/profile/cordis.patch.yml) with your provider,
model, and API-key environment variable name, then merge it into
`$DSH_HOME/profiles/qwenpaw/cordis.patch.yml`.

- The example configures `llm-pi-ai` and `agent-default-model`; it is not a
  ready-to-use account configuration.
- Preserve existing routes and profile settings; do not replace the whole file
  with the example.
- A route needs both provider and model. The bridge cannot invent a usable
  model when route resolution fails.
- Never put real keys in the repository or public command output. The optional
  environment helper is not required for installation.

### 4. Inspect the configuration, then start

With the intended home/profile selected, inspect the composed configuration:

```sh
dsh --profile qwenpaw --dump-config
```

Confirm exactly one `qwenpaw-bridge` row, a disabled stock `acp` row, and an
intact `acp-app-startup`. Raw configuration may contain sensitive data; do not
paste it directly into an issue. Then start:

```sh
dsh --profile qwenpaw
```

For QwenPaw-side installation and backend settings, see
[qwenpaw-dsh](https://github.com/BillYuan01/qwenpaw-dsh).

## Permissions and safe use

`read-only` is a DSH permission preset, **not a file-read path allowlist**.
Readable paths depend on the deployment and DSH tool/permission policies; this
bridge adds no path isolation. The profile controls the default preset, which
is not necessarily `read-only`.

Clients must check the session's actual permission state, not treat the profile
default as confirmation. An explicit switch succeeds only when read-back
matches the write. A failed initial-preset request may still create a session
with fallback marked. **Do not send prompts when permissions are unknown or do
not meet the requirement.** See the [protocol](docs/protocol.md) for fields and
error semantics.

## FAQ

**Installed, but nothing changed?**
Check Node, pnpm, the supported DSH range, and bundle order. DSH may skip an
incompatible plugin; bypassing version checks is not proof of installation.

**No model options, or an empty catalog?**
Check the provider/model route and DSH adapters. Catalog size depends on the
deployment. Optional catalog queries may degrade gracefully; that does not
verify model calls or credentials.

**Why is output not incremental?**
If live events are unavailable or disabled, stock committed output remains.
`streaming: true` means the live path is enabled, not that this call received
deltas.

**Does a healthy status card mean the model works?**
No. The card samples QwenPaw backend status at web-profile startup. It is not
continuous monitoring or a model acceptance test.

## Optional components and documentation

- [tools/README.md](tools/README.md): manual environment helper; reads
  credentials and creates an additional plaintext copy. Use only if needed.
- [diagnostics/README.md](diagnostics/README.md): isolated diagnostics;
  starting DSH can have side effects even without a prompt.
- [status-plugin/README.md](status-plugin/README.md): independent status card
  for the web profile, not a replacement for the bridge.
- [Protocol](docs/protocol.md), [development and testing](docs/development.md),
  and [verification record](docs/verification.md).
- [AGENTS.md](AGENTS.md): contributor rules;
  [TESTING.md](TESTING.md): unchanged historical evidence;
  [CHANGELOG.md](CHANGELOG.md): release history.

Source tools and optional components are excluded from the root package's file
list; keep a checkout if you need them. Documentation on the main branch may
be newer than the fixed release tag. The Chinese README and deeper references
are available in the repository, not the root package's declared file list.

## License

[MIT](LICENSE).
