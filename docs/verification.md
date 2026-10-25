# Verification record

This records completed Linux integration checks, not a compatibility guarantee
for every version or platform. Only scopes and conclusions are retained here,
without machine identifiers, private paths, session logs, or credentials.
These are dated records, not checks rerun by this documentation update.

## 2026-10-25: bridge 1.1.0 with qwenpaw-dsh 1.1.0

Environment: Linux, QwenPaw 2.2.2.post1, DSH 0.2.1-rc.2.

| Check | Observation |
| --- | --- |
| Text streaming | One answer received 105 text deltas spread across generation, not delivered in a single batch at the end |
| Concurrency | Two sessions on the same connection each received their complete marker without content from the other session |
| Cancellation | A cancel notification was sent, the consumer exited, and a subsequent request in the same session completed normally |
| Resume | A new adapter process resumed an earlier ACP session and answered about the previous synthetic topic |

These checks ran primarily through the installed QwenPaw adapter, with one
additional short-answer check through the QwenPaw HTTP API. They are not
dedicated acceptance tests for every bridge capability. Sending a cancel
notification does not establish that provider billing stopped immediately.
These stream/concurrency/cancel/resume observations belong to plugin 1.1.0;
they were not a rerun of that suite with plugin 1.1.1.

The bridge's separately recorded offline scope was 39 Node tests, 32 helper
checks, 6 atomic-write checks, and 5 runner self-tests. Permission tests used a
fake service to verify default/actual separation, write read-back, initial
fallback, and feature disabling; they do not replace real permission-service
tests. The 1.1.0 release checks were offline-only; the live observations above
are separate integration evidence, not release-gate results.

## 2026-10-25: bridge 1.1.0 with qwenpaw-dsh 1.1.1

On the same Linux host and DSH version, a live check read a synthetic temporary
file successfully: the plugin 1.1.1 tool-completion event directly contained
the file text. The bridge remained 1.1.0; it was not bumped for this tool-text
fix.

This is evidence for a QwenPaw-side mapping fix, not verification of arbitrary
tools, a file-read allowlist, or every permission policy. It does not extend
the earlier plugin 1.1.0 streaming/concurrency scope to plugin 1.1.1.

## Not yet covered

- Dedicated end-to-end checks for macOS, native Windows, WSL, or every supported
  DSH version.
- Every real-DSH failure branch for permission hot switching, confirmed/fallback,
  and disabling the feature.
- Every provider, reasoning stream, committed deduplication, MCP, and attachment
  combination.
- Strong read isolation for all private paths; read-only is not a read-path
  allowlist.

Delta counts are not performance guarantees. `streaming: true`, a nonempty
model catalog, or a healthy status card cannot replace a model-call test.
Earlier records remain in [TESTING.md](../TESTING.md); each conclusion applies
only to its recorded environment and date.

Before reproducing a check, select the appropriate entry point in the
[development guide](development.md). Real calls require confirmation of the
target, permissions, model cost, and output location. Do not publish raw dumps
or logs directly.
