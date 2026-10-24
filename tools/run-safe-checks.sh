#!/usr/bin/env bash
# Explicit safe local checks for the dsh-qwenpaw-bridge repository.
#
# Default: 39 offline Node tests + syntax checks. No DSH, no npm install, no
# pack lifecycle scripts, no credentials, no network.
# --with-helpers: additionally runs the 32 env-helper checks and 6 atomic-write
# checks (38 total). Requires an existing Python with PyYAML and Node >= 22.9;
# missing prerequisites fail explicitly and nothing is installed.
#
# Usage:
#   tools/run-safe-checks.sh
#   tools/run-safe-checks.sh --with-helpers --python /path/to/venv/bin/python
#   tools/run-safe-checks.sh --list
#   tools/run-safe-checks.sh --only protocol --expect-node 1
set -u

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd) || exit 1
NODE=${NODE:-node}
PYTHON=${PYTHON:-python3}
WITH_HELPERS=0
LIST=0
EXPECT_NODE_OVERRIDE=""
ONLY=()

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-helpers) WITH_HELPERS=1 ;;
    --list) LIST=1 ;;
    --repo-root) shift; ROOT=${1:-} ;;
    --python) shift; PYTHON=${1:-} ;;
    --node) shift; NODE=${1:-} ;;
    --only) shift; ONLY+=("${1:-}") ;;
    --expect-node) shift; EXPECT_NODE_OVERRIDE=${1:-} ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$LIST" -eq 1 ]; then
  printf '%s\t%s\n' "test/protocol.test.js" "4"
  printf '%s\t%s\n' "test/permission_boundaries.test.js" "35"
  printf '%s\n' "# helpers (explicit --with-helpers): 32 env-helper + 6 atomic = 38"
  exit 0
fi

NODE_BIN=$(command -v "$NODE" 2>/dev/null || true)
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node not found: $NODE" >&2
  exit 2
fi
PY_BIN=""
if [ "$WITH_HELPERS" -eq 1 ]; then
  PY_BIN=$(command -v "$PYTHON" 2>/dev/null || true)
  if [ -z "$PY_BIN" ]; then
    echo "ERROR: python not found: $PYTHON (required by --with-helpers)" >&2
    exit 2
  fi
fi

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/bridge-safe-checks.XXXXXX") || exit 2
cleanup() { rm -rf -- "$TMP_ROOT"; }
trap cleanup EXIT INT TERM

mkdir -p "$TMP_ROOT/home" "$TMP_ROOT/dsh" "$TMP_ROOT/tmp" || exit 2
if [ -n "$PY_BIN" ]; then
  PATH_DIRS="$(dirname -- "$NODE_BIN"):$(dirname -- "$PY_BIN"):/usr/local/bin:/usr/bin:/bin"
else
  PATH_DIRS="$(dirname -- "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin"
fi
RUN_ENV=(env -i
  PATH="$PATH_DIRS"
  HOME="$TMP_ROOT/home"
  DSH_HOME="$TMP_ROOT/dsh"
  TMPDIR="$TMP_ROOT/tmp"
  LANG=C.UTF-8
  LC_ALL=C.UTF-8
  PYTHONDONTWRITEBYTECODE=1)

node_version=$("$NODE_BIN" -p 'process.versions.node' 2>/dev/null || true)
if [ -z "$node_version" ]; then
  echo "ERROR: cannot query node version" >&2
  exit 2
fi
echo "node:   $NODE_BIN ($node_version)"
if [ -n "$PY_BIN" ]; then
  echo "python: $PY_BIN"
fi

# --- offline Node tests ------------------------------------------------------
TEST_FILES=()
EXPECTED_NODE=0
if [ "${#ONLY[@]}" -eq 0 ]; then
  TEST_FILES=("test/protocol.test.js" "test/permission_boundaries.test.js")
  EXPECTED_NODE=39
else
  for name in "${ONLY[@]}"; do
    case "$name" in
      protocol|test/protocol.test.js)
        TEST_FILES+=("test/protocol.test.js"); EXPECTED_NODE=$((EXPECTED_NODE + 4)) ;;
      permission_boundaries|test/permission_boundaries.test.js)
        TEST_FILES+=("test/permission_boundaries.test.js"); EXPECTED_NODE=$((EXPECTED_NODE + 35)) ;;
      *)
        echo "ERROR: refusing non-whitelisted test: $name" >&2
        exit 2 ;;
    esac
  done
fi
if [ -n "$EXPECT_NODE_OVERRIDE" ]; then
  EXPECTED_NODE=$EXPECT_NODE_OVERRIDE
fi

for relative in "${TEST_FILES[@]}"; do
  if [ ! -f "$ROOT/$relative" ]; then
    echo "ERROR: test file not found: $ROOT/$relative" >&2
    exit 2
  fi
done
NODE_PATHS=()
for relative in "${TEST_FILES[@]}"; do
  NODE_PATHS+=("$ROOT/$relative")
done

echo
echo "=== offline node tests (${TEST_FILES[*]}) ==="
node_out=$("${RUN_ENV[@]}" "$NODE_BIN" --test "${NODE_PATHS[@]}" 2>&1)
node_rc=$?
printf '%s\n' "$node_out"
node_tests=$(printf '%s\n' "$node_out" | awk '$1=="#" && $2=="tests"{v=$3} END{print v+0}')
node_pass=$(printf '%s\n' "$node_out" | awk '$1=="#" && $2=="pass"{v=$3} END{print v+0}')
node_fail=$(printf '%s\n' "$node_out" | awk '$1=="#" && $2=="fail"{v=$3} END{print v+0}')
node_skip=$(printf '%s\n' "$node_out" | awk '$1=="#" && $2=="skipped"{v=$3} END{print v+0}')
if [ "$node_rc" -ne 0 ] || [ "$node_tests" -ne "$EXPECTED_NODE" ] \
    || [ "$node_pass" -ne "$EXPECTED_NODE" ] || [ "$node_fail" -ne 0 ] \
    || [ "$node_skip" -ne 0 ]; then
  echo "NODE RESULT: FAIL (rc=$node_rc tests=$node_tests expected=$EXPECTED_NODE pass=$node_pass fail=$node_fail skipped=$node_skip)" >&2
  exit 1
fi
echo "NODE RESULT: PASS (tests=$node_tests pass=$node_pass fail=$node_fail skipped=$node_skip)"

echo
echo "=== node --check ==="
static_ok=0
static_bad=0
JS_DIRS=()
[ -d "$ROOT/lib" ] && JS_DIRS+=("$ROOT/lib")
[ -d "$ROOT/test" ] && JS_DIRS+=("$ROOT/test")
if [ "${#JS_DIRS[@]}" -gt 0 ]; then
  while IFS= read -r file; do
    if "$NODE_BIN" --check "$file" >/dev/null 2>&1; then
      static_ok=$((static_ok + 1))
    else
      echo "SYNTAX FAIL: $file" >&2
      static_bad=$((static_bad + 1))
    fi
  done < <(find "${JS_DIRS[@]}" -maxdepth 1 -type f -name '*.js' | sort)
fi
if [ "$static_bad" -ne 0 ]; then
  echo "STATIC RESULT: FAIL ($static_ok ok, $static_bad failed)" >&2
  exit 1
fi
echo "STATIC RESULT: PASS ($static_ok files)"

# --- optional helpers --------------------------------------------------------
HELPER_TOTAL=0
ATOMIC_TOTAL=0
if [ "$WITH_HELPERS" -eq 1 ]; then
  echo
  echo "=== helper prerequisites ==="
  if ! "$NODE_BIN" -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && minor >= 9) ? 0 : 1);
  '; then
    echo "ERROR: --with-helpers requires Node >= 22.9 (found $node_version); nothing installed" >&2
    exit 2
  fi
  if ! "${RUN_ENV[@]}" "$PY_BIN" -c 'import sys, yaml; assert sys.version_info >= (3, 10)' >/dev/null 2>&1; then
    echo "ERROR: --with-helpers requires Python >= 3.10 with PyYAML; nothing installed" >&2
    exit 2
  fi
  echo "prerequisites: OK (Node $node_version, Python + PyYAML)"

  echo
  echo "=== env-helper checks (32) ==="
  helper_out=$("${RUN_ENV[@]}" DSH_ENV_SYNC_PY="$PY_BIN" DSH_ENV_SYNC_NODE="$NODE_BIN" \
    bash "$ROOT/tools/tests/test-env-sync.sh" 2>&1)
  helper_rc=$?
  printf '%s\n' "$helper_out"
  read -r helper_pass helper_fail < <(
    printf '%s\n' "$helper_out" | awk '/^[0-9]+ passed, [0-9]+ failed$/{print $1, $3}' | tail -1
  )
  helper_pass=${helper_pass:-0}
  helper_fail=${helper_fail:-1}
  HELPER_TOTAL=$helper_pass
  if [ "$helper_rc" -ne 0 ] || [ "$helper_pass" -ne 32 ] || [ "$helper_fail" -ne 0 ]; then
    echo "HELPER RESULT: FAIL (rc=$helper_rc passed=$helper_pass failed=$helper_fail expected=32)" >&2
    exit 1
  fi
  echo "HELPER RESULT: PASS (passed=$helper_pass failed=$helper_fail)"

  echo
  echo "=== atomic-write checks (6) ==="
  atomic_out=$("${RUN_ENV[@]}" "$PY_BIN" "$ROOT/tools/tests/test-atomic.py" 2>&1)
  atomic_rc=$?
  printf '%s\n' "$atomic_out"
  read -r atomic_pass atomic_fail < <(
    printf '%s\n' "$atomic_out" | awk '/^[0-9]+ passed, [0-9]+ failed$/{print $1, $3}' | tail -1
  )
  atomic_pass=${atomic_pass:-0}
  atomic_fail=${atomic_fail:-1}
  ATOMIC_TOTAL=$atomic_pass
  if [ "$atomic_rc" -ne 0 ] || [ "$atomic_pass" -ne 6 ] || [ "$atomic_fail" -ne 0 ]; then
    echo "ATOMIC RESULT: FAIL (rc=$atomic_rc passed=$atomic_pass failed=$atomic_fail expected=6)" >&2
    exit 1
  fi
  echo "ATOMIC RESULT: PASS (passed=$atomic_pass failed=$atomic_fail)"
fi

echo
echo "=== summary ==="
echo "node:   $node_pass/$EXPECTED_NODE"
echo "static: $static_ok files"
if [ "$WITH_HELPERS" -eq 1 ]; then
  echo "helper: $HELPER_TOTAL/32"
  echo "atomic: $ATOMIC_TOTAL/6"
else
  echo "helper: not run (explicit --with-helpers)"
fi
echo "RESULT: PASS"
