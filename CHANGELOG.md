# Changelog

## 1.1.0 — 2026-10-25

**Paired release with `qwenpaw-dsh` v1.1.0.** Both repositories use the same
release number for this coordinated drop; `_meta.qwenpaw` protocol stays `1`,
`META_PROTOCOL` is unchanged, and the independent `status-plugin`
(`dsh-qwenpaw-bridge-status`) remains `0.1.0`. The same number does not mean DSH
itself is 1.1.0 — the supported range is still `>=0.2.0-rc.2 <0.3.0-0`.

In plain terms, this release collects the already-landed safety and test-entry
changes into one traceable version. Permission switching is confirmed by
read-back instead of trusting a write; `permissionPresets: false` disables the
bridge surface locally; the env helper refuses whole files it cannot parse
(multiline quoted values or orphan lines), so it never silently rewrites
unrelated variables; and the default local entry is an offline runner with a
throwaway fake home. No new runtime features, no wire change, no dependency
upgrade.

Verification boundary: offline checks only (39 Node tests, 32 env-helper
checks, 6 atomic-write checks, 5 runner self-tests, syntax checks, reproducible
TGZ). Real DSH, real credentials, live prompts, macOS and native Windows were
**not** re-run for this version. The historical measurements below remain
records of their own date.

- **Safe local checks:** add `tools/run-safe-checks.sh` (39 offline Node tests
  plus `node --check`; optional `--with-helpers` for 32 env-helper + 6 atomic
  checks) and `tools/tests/test-runner.sh` (whitelist and live-sentinel proof).
  The runner uses a throwaway `HOME`/`DSH_HOME`/`TMPDIR`, an `env -i`
  allowlist, never starts DSH, never runs `npm install` or pack lifecycle
  scripts, and treats missing Python/PyYAML or Node <22.9 as a hard error.
  No runtime, protocol or npm file-list change; only this release's version bump is new.

- **Security (R10): the env helper no longer rewrites a dotenv file it cannot
  parse as logical entries.** A finite-state scan now recognises single-line
  assignments (optional `export`, single/double/backtick single-line quotes,
  trailing comments, CRLF) and treats a multiline quoted value — even in an
  unrelated variable — or an orphan non-comment line without `=` as
  `unusable-structure`. Write, `--check` and `--print` then exit `2`, print no
  values/digests, and leave the old file byte- and mode-identical. A managed
  `export KEY=...` line is now found (previously it was duplicated). Before
  replacement the candidate's full parsed digest map is compared with the
  original, so an unrelated variable can never change silently; the existing
  atomic `0600` write, symlink/non-regular refusal and failure cleanup remain.
  `tools/tests/test-env-sync.sh` grows from 20 to 32 fake-only checks
  (multiline managed, unrelated multiline hiding a managed-looking line,
  unterminated quote, orphan line, CRLF/export, quote styles, duplicates,
  directory unchanged); `test-atomic.py` grows to 6 (adds a full-map digest comparison case). No bridge runtime, package
  npm file-list change; no live credential/DSH run.

- **Security (R04): the catalog default is no longer reported as a session's
  actual permission preset.** `_meta.qwenpaw.permission_preset` and the
  `permission_mode` select now come only from a live read-back
  (`presetState`). When the session is unavailable, `current()` is missing or
  throws, the value is empty, or the value is outside the catalog, the field is
  omitted with `permission_preset_known: false` and the select is dropped
  instead of reusing `default_permission_preset`. `initialize` reports the
  default only. Wire protocol stays `1` (additive fields).
- **Security (R09): `permissionPresets: false` now disables the bridge surface
  instead of hiding it.** Standard `permission_mode` (and the
  `permission_preset` / `permissionPreset` aliases) return `-32602`;
  `qwenpaw/permission/set` and `qwenpaw/permission/get` return `-32601`. All of
  them are answered locally, never forwarded to stock ACP, and make zero
  `service.set` calls. The scope limit is unchanged: this switch governs the
  bridge's own hot-switch surface, not stock/DSH permission features or the
  profile default.
- **Behavior (R09): a switch is confirmed by read-back before success.**
  `service.set()` without a throw is no longer treated as “switched”; an
  unverifiable or mismatching read-back returns `-32602` with
  `permission_preset_written: true` / `permission_preset_confirmed: false` so a
  client stops and re-reads instead of trusting an unknown preset.
- Tests: `test/permission_boundaries.test.js` (19 offline fake ctx/service
  checks) covers both regressions; `test/protocol.test.js` is unchanged. No
  live DSH run in this change, so integration remains unverified here.
- Add an optional source-checkout-only `tools/dsh-env-sync.py` helper for
  single-writer headless environment synchronization, with 32 fake-only
  behavior checks and 6 atomic-write checks. Document manual use, conservative
  encoding, file-level symlink refusal, and platform/security limitations.
- Add optional fake-only catalog and credential-service sampling diagnostics,
  with checkout-relative ACP helper imports and explicit isolation/output
  cautions. Timing samples do not establish discovery causality.
- No bridge runtime or npm file-list changes (the version bump ships separately in this 1.1.0 release). No automatic
  installation, cron job, tag, or npm publication.

## 0.2.1 — 2026-10-23

- Declare `engines.dsh` (`>=0.2.0-rc.2 <0.3.0-0`) alongside the existing peer
  ranges. DSH 0.2.1 evaluates `engines.dsh` first and only falls back to the
  `@deepseek-ai/dsh*` peer ranges when it is absent; both paths use
  prerelease-inclusive semver. The supported range is unchanged — 0.2.1
  prereleases (`0.2.1-rc.1`, `0.2.1-rc.2`) already satisfied the peer range
  under the same rule, so this release makes the constraint explicit in one
  place instead of relying on the fallback.
- No wire or behavior change: `_meta.qwenpaw` protocol stays `1` and `lib/*`
  is untouched apart from `BRIDGE_VERSION`.
- Docs: README now states the enforcement order and that an unsatisfied range
  drops the plugin silently at profile boot.

Verified on DSH `0.2.1-rc.2`: probe 19/19 (177 and 89 live chunks on two
profiles, zero committed duplicates, permission switch keeps the PID), contract
suite s01–s06 6/6, and a negative test (range set to `<0.2.0`) that correctly
dropped the plugin.

## 0.2.0 — 2026-10-21

- Add `status-plugin/` (`dsh-qwenpaw-bridge-status` 0.1.0), a host-only DSH
  **web** plugin that shows a QwenPaw connection card under 插件 → 已安装.
  It probes `http://127.0.0.1:8088/api/harnesses` at web-profile boot and
  reports green (connected) or red (disconnected).
- Repository release: the bridge wire contract (`_meta.qwenpaw`, protocol 1)
  and the `lib/*` behavior are unchanged from 0.1.0. The 0.2.0 bump marks the
  repo-level release that also ships the status plugin.

## 0.1.0 — 2026-10-21

- Split `dsh-qwenpaw-bridge` out of the `qwenpaw-dsh` monorepo into its own
  repository. The wire contract (`_meta.qwenpaw`, protocol 1) is unchanged.
- Renamed the package from its old scoped name to the unscoped
  `dsh-qwenpaw-bridge`.
- Replaced the symlink/`install.sh` profile bootstrap with the two-stage DSH
  install path: `--from-default-profile acp`, then
  `dsh plugin --profile qwenpaw add dsh-qwenpaw-bridge`.
- Moved the sample profile patch to `examples/profile/cordis.patch.yml` and
  removed its duplicate `qwenpaw-bridge` row.
- Declared the supported DSH peer range as
  `>=0.2.0-rc.2 <0.3.0-0`, added `engines.node >=22`, and added repository,
  homepage and bug links.
- Added a Node test that keeps `BRIDGE_VERSION` and `package.json.version` in
  sync, and made `_meta` read the bridge name/version/protocol from
  `lib/protocol.js` only.
- Rewrote `test/probe.py` to be self-contained (no `spikes/spike_lib`
  dependency) and tightened the acceptance assertions.
