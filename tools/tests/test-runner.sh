#!/usr/bin/env bash
# Self-test for tools/run-safe-checks.sh: proves the runner stays inside its
# whitelist and never executes a live-looking test file.
#
# All work happens in a throwaway fake repository with a sentinel file. No
# bridge code, DSH, credentials, network, or npm lifecycle script is involved.
set -u

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd) || exit 1
RUNNER="$ROOT/tools/run-safe-checks.sh"
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/bridge-runner-test.XXXXXX") || exit 1
trap 'rm -rf -- "$TMP_ROOT"' EXIT INT TERM
pass=0
fail=0
ok() { printf 'PASS  %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL  %s -- %s\n' "$1" "$2"; fail=$((fail + 1)); }

FAKE="$TMP_ROOT/repo"
mkdir -p "$FAKE/test" "$FAKE/lib"
MARKER="$TMP_ROOT/sentinel-ran"
cat > "$FAKE/test/protocol.test.js" <<'JS'
import test from 'node:test';
import assert from 'node:assert/strict';
test('fake protocol test runs in an isolated environment', () => {
  for (const key of ['HOME', 'DSH_HOME', 'TMPDIR']) {
    assert.ok(process.env[key], key);
    assert.notEqual(process.env[key], '/private-test-home-sentinel');
  }
  assert.equal(process.env.DEEPSEEK_API_KEY, undefined);
});
JS
cat > "$FAKE/test/live_sentinel.test.js" <<JS
import { writeFileSync } from 'node:fs';
writeFileSync(${MARKER@Q}, 'ran');
process.exit(99);
JS
printf '// fake lib\n' > "$FAKE/lib/fake.js"

out=$("$RUNNER" --repo-root "$FAKE" --only protocol --expect-node 1 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q 'NODE RESULT: PASS'; then
  ok "runner executes a whitelisted fake test"
else
  bad "runner executes a whitelisted fake test" "rc=$rc out=$out"
fi
if [ ! -e "$MARKER" ]; then
  ok "runner did not execute the non-whitelisted sentinel"
else
  bad "runner did not execute the non-whitelisted sentinel" "marker exists"
fi

out=$("$RUNNER" --repo-root "$FAKE" --list 2>&1)
rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q 'test/protocol.test.js' \
    && ! printf '%s\n' "$out" | grep -q 'live_sentinel'; then
  ok "--list shows only the fixed whitelist"
else
  bad "--list shows only the fixed whitelist" "rc=$rc out=$out"
fi

out=$("$RUNNER" --repo-root "$FAKE" --only permission_boundaries 2>&1)
rc=$?
if [ "$rc" -eq 2 ]; then
  ok "missing whitelisted file fails closed"
else
  bad "missing whitelisted file fails closed" "rc=$rc out=$out"
fi

out=$("$RUNNER" --repo-root "$FAKE" --only ../live_sentinel 2>&1)
rc=$?
if [ "$rc" -eq 2 ] && printf '%s\n' "$out" | grep -q 'refusing non-whitelisted'; then
  ok "path-like non-whitelisted name is refused"
else
  bad "path-like non-whitelisted name is refused" "rc=$rc out=$out"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
