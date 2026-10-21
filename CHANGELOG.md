# Changelog

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
