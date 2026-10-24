# Changelog

## Unreleased

- Add an optional source-checkout-only `tools/dsh-env-sync.py` helper for
  single-writer headless environment synchronization, with 20 fake-only
  behavior checks and 5 atomic-write checks. Document manual use, conservative
  encoding, file-level symlink refusal, and platform/security limitations.
- Add optional fake-only catalog and credential-service sampling diagnostics,
  with checkout-relative ACP helper imports and explicit isolation/output
  cautions. Timing samples do not establish discovery causality.
- No bridge runtime, package version, or npm file-list changes. No automatic
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
