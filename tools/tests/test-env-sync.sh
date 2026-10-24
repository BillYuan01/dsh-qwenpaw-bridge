#!/usr/bin/env bash
# Isolated behaviour tests for the repository's tools/dsh-env-sync.py.
# Every case runs in a throwaway DSH_HOME with fake values; no live credential
# store, network, or service is used. Requires Bash and GNU tools.
set -u

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 1
TOOL="${DSH_ENV_SYNC:-$SCRIPT_DIR/../dsh-env-sync.py}"
PY="${DSH_ENV_SYNC_PY:-python3}"
# All cases live under one generated parent, including early-exit cleanup.
TEST_TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/dsh-env-sync-tests.XXXXXX") || exit 1
export TMPDIR="$TEST_TMP_ROOT"
trap 'rm -rf -- "$TEST_TMP_ROOT"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
FAKE="fake-value-not-a-real-key-0001"
FAKE2="fake-value-not-a-real-key-0002"
pass=0; fail=0
ok()  { printf 'PASS  %s\n' "$1"; pass=$((pass+1)); }
bad() { printf 'FAIL  %s -- %s\n' "$1" "$2"; fail=$((fail+1)); }

newhome() {  # fake credential store + fake .env in a fresh directory
  H=$(mktemp -d "$TEST_TMP_ROOT/envsync.XXXXXX") || exit 1
  printf 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: %s\n' "$FAKE" > "$H/.credentials.yaml"
  chmod 600 "$H/.credentials.yaml"
  printf 'OTHER_VAR=keep-me\n' > "$H/.env"
  chmod 600 "$H/.env"
}
run() { DSH_HOME="$H" "$PY" "$TOOL" "$@"; }

# 1 --check on a drifted store must report drift and exit 1
newhome
out=$(run --check); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q 'DEEPSEEK_API_KEY: missing-in-env' \
  && ok "check detects missing key in .env (state, not value)" \
  || bad "check detects missing key in .env" "rc=$rc out=$out"

# 2 repair, then --check is clean; unrelated variable survives; mode is 600
run >/dev/null 2>&1; rc=$?
mode=$(stat -c '%a' "$H/.env")
grep -q '^OTHER_VAR=keep-me$' "$H/.env" && other=1 || other=0
out2=$(run --check); rc2=$?
[ "$rc" -eq 0 ] && [ "$rc2" -eq 0 ] && [ "$mode" = "600" ] && [ "$other" = "1" ] \
  && echo "$out2" | grep -q 'in-sync' \
  && ok "repair writes atomically, keeps OTHER_VAR, mode 600, check clean" \
  || bad "repair writes atomically, keeps OTHER_VAR, mode 600" "rc=$rc rc2=$rc2 mode=$mode other=$other"

# 3 stale value is reported as drift, not silently kept
printf 'DEEPSEEK_API_KEY=%s\nOTHER_VAR=keep-me\n' "$FAKE2" > "$H/.env"
out=$(run --check); rc=$?
echo "$out" | grep -q 'DEEPSEEK_API_KEY: stale' && [ "$rc" -eq 1 ] \
  && ok "check flags a stale value" || bad "check flags a stale value" "rc=$rc out=$out"

# 4 a key without an sk- prefix is legitimate: never rejected on shape
H2=$(mktemp -d "$TEST_TMP_ROOT/envsync.XXXXXX") || exit 1
printf 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: plain-legacy-token_123\n' > "$H2/.credentials.yaml"
H="$H2" run >/dev/null 2>&1; rc=$?
grep -q '^DEEPSEEK_API_KEY=plain-legacy-token_123$' "$H2/.env" && [ "$rc" -eq 0 ] \
  && ok "non sk- prefixed value accepted verbatim" || bad "non sk- prefixed value accepted" "rc=$rc"

# 5 missing source fails and leaves the target byte-identical
newhome; before=$(sha256sum "$H/.env" | cut -d' ' -f1)
mv "$H/.credentials.yaml" "$H/.credentials.yaml.off"
err=$(run 2>&1); rc=$?
after=$(sha256sum "$H/.env" | cut -d' ' -f1)
[ "$rc" -ne 0 ] && [ "$before" = "$after" ] && echo "$err" | grep -qi 'not found' \
  && ok "missing credential store: fails, target untouched" \
  || bad "missing credential store: fails, target untouched" "rc=$rc same=$([ "$before" = "$after" ] && echo y || echo n)"
mv "$H/.credentials.yaml.off" "$H/.credentials.yaml"

# 6 empty value in the store fails without overwriting
newhome; before=$(sha256sum "$H/.env" | cut -d' ' -f1)
printf 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: ""\n' > "$H/.credentials.yaml"
err=$(run 2>&1); rc=$?
after=$(sha256sum "$H/.env" | cut -d' ' -f1)
[ "$rc" -ne 0 ] && [ "$before" = "$after" ] && echo "$err" | grep -qi 'empty' \
  && ok "empty source value: fails, target untouched" \
  || bad "empty source value: fails, target untouched" "rc=$rc same=$([ "$before" = "$after" ] && echo y || echo n)"

# 7 newline injection in the value is refused
newhome; before=$(sha256sum "$H/.env" | cut -d' ' -f1)
printf 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: "abc\\ndef"\n' > "$H/.credentials.yaml"
err=$(run 2>&1); rc=$?
after=$(sha256sum "$H/.env" | cut -d' ' -f1)
[ "$rc" -ne 0 ] && [ "$before" = "$after" ] && echo "$err" | grep -qi 'newline' \
  && ok "dotenv newline injection refused, target untouched" \
  || bad "dotenv newline injection refused" "rc=$rc same=$([ "$before" = "$after" ] && echo y || echo n)"

# 8 symlinked target is refused and the pointed-to file is unchanged
newhome; real="$H/real.env"
mv "$H/.env" "$real"; ln -s "$real" "$H/.env"
before=$(sha256sum "$real" | cut -d' ' -f1)
err=$(run 2>&1); rc=$?
after=$(sha256sum "$real" | cut -d' ' -f1)
[ "$rc" -ne 0 ] && [ "$before" = "$after" ] && echo "$err" | grep -qi 'symbolic link' \
  && ok "symlinked .env refused, link target unchanged" \
  || bad "symlinked .env refused" "rc=$rc same=$([ "$before" = "$after" ] && echo y || echo n)"

# 9 symlinked credential store is refused
newhome; mv "$H/.credentials.yaml" "$H/creds.real"; ln -s "$H/creds.real" "$H/.credentials.yaml"
before=$(sha256sum "$H/.env" | cut -d' ' -f1)
err=$(run 2>&1); rc=$?
after=$(sha256sum "$H/.env" | cut -d' ' -f1)
[ "$rc" -ne 0 ] && [ "$before" = "$after" ] && echo "$err" | grep -qi 'symbolic link' \
  && ok "symlinked credential store refused" \
  || bad "symlinked credential store refused" "rc=$rc same=$([ "$before" = "$after" ] && echo y || echo n)"

# 10 no temp files survive a run, and repeated runs are idempotent
newhome; run >/dev/null 2>&1; run >/dev/null 2>&1
left=$(find "$H" -maxdepth 1 -name '.env.tmp-*' | wc -l)
first=$(sha256sum "$H/.env" | cut -d' ' -f1); run >/dev/null 2>&1
second=$(sha256sum "$H/.env" | cut -d' ' -f1); out=$(run --check); rc=$?
[ "$left" -eq 0 ] && [ "$first" = "$second" ] && [ "$rc" -eq 0 ] \
  && ok "no leftover temp files, idempotent re-run" \
  || bad "no leftover temp files, idempotent re-run" "left=$left same=$([ "$first" = "$second" ] && echo y || echo n) rc=$rc"

# 11 status output never contains a value
newhome; run >/dev/null 2>&1; out=$(run --print)
echo "$out" | grep -q "$FAKE" && bad "status output never leaks values" "value appeared" \
  || ok "status output never leaks values"

# 12 unparseable store fails without overwriting
newhome; before=$(sha256sum "$H/.env" | cut -d' ' -f1)
printf 'version: 1\nrefs: [unclosed\n' > "$H/.credentials.yaml"
err=$(run 2>&1); rc=$?
after=$(sha256sum "$H/.env" | cut -d' ' -f1)
[ "$rc" -ne 0 ] && [ "$before" = "$after" ] \
  && ok "unparseable store: fails, target untouched" \
  || bad "unparseable store: fails, target untouched" "rc=$rc same=$([ "$before" = "$after" ] && echo y || echo n)"

# 13 preserved comments/ordering for unrelated lines
newhome; printf '# keep this comment\nOTHER_VAR=keep-me\n' > "$H/.env"
run >/dev/null 2>&1
head -2 "$H/.env" | grep -q '^# keep this comment$' && grep -q '^OTHER_VAR=keep-me$' "$H/.env" \
  && ok "unrelated lines and comments preserved" || bad "unrelated lines and comments preserved" "$(head -3 "$H/.env")"

# Ground truth for the boundary cases: DSH's own parser, not this script's idea.
parsed() {  # parsed <file> <key>
  "$PY" - "$1" "$2" <<'PYEOF'
import os, subprocess, sys
path, key = sys.argv[1], sys.argv[2]
code = ("const {parseEnv}=require('node:util');const fs=require('node:fs');"
        "const o=parseEnv(fs.readFileSync(process.argv[1],'utf8'));"
        "process.stdout.write(o[process.argv[2]]===undefined?'\\u0000MISSING':o[process.argv[2]])")
out = subprocess.run([os.environ.get("DSH_ENV_SYNC_NODE") or "node", "-e", code, path, key], capture_output=True, text=True)
print(out.stdout)
PYEOF
}

# 14 '#' inside a value must survive (unquoted would truncate at the '#')
newhome
sed -i "s/^  DEEPSEEK_API_KEY: .*/  DEEPSEEK_API_KEY: 'fake #hash value'/" "$H/.credentials.yaml"
run >/dev/null 2>&1; rc=$?
got=$(parsed "$H/.env" DEEPSEEK_API_KEY)
[ "$rc" -eq 0 ] && [ "$got" = "fake #hash value" ] \
  && ok "value with '#' round-trips through DSH's parser" \
  || bad "value with '#' round-trips" "rc=$rc got=$(printf %q "$got")"

# 15 '$' and '${}' are literal for this parser: never expand, never escape
newhome
sed -i "s/^  DEEPSEEK_API_KEY: .*/  DEEPSEEK_API_KEY: 'fake\$HOME-and-\${X}'/" "$H/.credentials.yaml"
run >/dev/null 2>&1; rc=$?
got=$(parsed "$H/.env" DEEPSEEK_API_KEY)
[ "$rc" -eq 0 ] && [ "$got" = 'fake$HOME-and-${X}' ] \
  && ok "value with \$ and \${} stays literal" \
  || bad "value with \$ and \${} stays literal" "rc=$rc got=$(printf %q "$got")"

# 16 inner whitespace is preserved by quoting
newhome
sed -i "s/^  DEEPSEEK_API_KEY: .*/  DEEPSEEK_API_KEY: 'fake  two  spaces'/" "$H/.credentials.yaml"
run >/dev/null 2>&1; rc=$?
got=$(parsed "$H/.env" DEEPSEEK_API_KEY)
[ "$rc" -eq 0 ] && [ "$got" = "fake  two  spaces" ] \
  && ok "inner whitespace preserved" || bad "inner whitespace preserved" "rc=$rc got=$(printf %q "$got")"

# 17 conservatively refuse double quotes, without modifying the target
newhome; before=$(sha256sum "$H/.env" | cut -d' ' -f1)
sed -i 's/^  DEEPSEEK_API_KEY: .*/  DEEPSEEK_API_KEY: \x27fake"quote\x27/' "$H/.credentials.yaml"
err=$(run 2>&1); rc=$?
after=$(sha256sum "$H/.env" | cut -d' ' -f1)
[ "$rc" -ne 0 ] && [ "$before" = "$after" ] && echo "$err" | grep -qi 'double quote' \
  && ok "double quote refused, target untouched" \
  || bad "double quote refused" "rc=$rc same=$([ "$before" = "$after" ] && echo y || echo n)"

# 18 conservatively refuse backslashes, without modifying the target
newhome; before=$(sha256sum "$H/.env" | cut -d' ' -f1)
sed -i 's/^  DEEPSEEK_API_KEY: .*/  DEEPSEEK_API_KEY: \x27fake\\\\slash\x27/' "$H/.credentials.yaml"
err=$(run 2>&1); rc=$?
after=$(sha256sum "$H/.env" | cut -d' ' -f1)
[ "$rc" -ne 0 ] && [ "$before" = "$after" ] && echo "$err" | grep -qi 'backslash' \
  && ok "backslash refused, target untouched" \
  || bad "backslash refused" "rc=$rc same=$([ "$before" = "$after" ] && echo y || echo n)"

# 19 a single quote is ordinary text for double-quoted values
newhome
sed -i "s/^  DEEPSEEK_API_KEY: .*/  DEEPSEEK_API_KEY: \"fake'quote\"/" "$H/.credentials.yaml"
run >/dev/null 2>&1; rc=$?
got=$(parsed "$H/.env" DEEPSEEK_API_KEY)
[ "$rc" -eq 0 ] && [ "$got" = "fake'quote" ] \
  && ok "single quote round-trips" || bad "single quote round-trips" "rc=$rc got=$(printf %q "$got")"

# 20 the target being a directory is refused, and that directory is untouched
newhome; rm -f "$H/.env"; mkdir "$H/.env"; touch "$H/.env/keep"
err=$(run 2>&1); rc=$?
[ "$rc" -ne 0 ] && [ -f "$H/.env/keep" ] && echo "$err" | grep -qi 'not a regular file' \
  && ok "directory target refused, contents untouched" \
  || bad "directory target refused" "rc=$rc keep=$([ -f "$H/.env/keep" ] && echo y || echo n)"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
