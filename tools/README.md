# Optional headless environment sync

`dsh-env-sync.py` is a manual, opt-in workaround for profiles that need a key in
the launch environment before credential-service resolution is available. It
is not a diagnosis of ACP discovery timing and is not required by the bridge.
**No bridge runtime change:** these helpers are available from a GitHub source
checkout only. The root package's `files` list excludes `tools/` (and
`diagnostics/`); the helper addition itself required no version bump, tag, or
npm publish. The root package version is now `1.1.0`; this helper still ships
only in a source checkout and is not part of the npm file list.

## Safe local checks

From the checkout root:

```sh
tools/run-safe-checks.sh
tools/run-safe-checks.sh --with-helpers --python /path/to/venv/bin/python
tools/run-safe-checks.sh --list
bash tools/tests/test-runner.sh
```

Default runs the 39 offline Node tests (`protocol` + `permission_boundaries`)
and `node --check` for `lib/`/`test/`. It never starts DSH, never runs
`npm install` or pack lifecycle scripts, and never reads credentials.

`--with-helpers` explicitly adds the 32 env-helper checks and 6 atomic-write
checks (38). It requires an existing Python >=3.10 with PyYAML and Node >=22.9;
missing prerequisites are a hard error and nothing is installed. Both modes use
a throwaway `HOME`, `DSH_HOME` and `TMPDIR`, with an `env -i` allowlist.
`tools/tests/test-runner.sh` proves a whitelisted fake test runs while a
sentinel live-looking file is not executed.


## Requirements and portability

- Python **>=3.10**, with **PyYAML** installed in the chosen Python environment.
- Node **>=22.9**, providing `node:util.parseEnv`, on `PATH`. Set
  `DSH_ENV_SYNC_NODE=/absolute/path/to/node` to override the executable (not a
  shell command). This also applies to the tests' parser checks.
- An existing DSH home and credential store for actual use. `DSH_HOME` selects
  the home; otherwise the helper uses `~/.dsh`. Only `DEEPSEEK_API_KEY` is managed.

Testing so far covers two POSIX/Linux hosts, not cross-platform certification.
macOS is untested. Native Windows is unsupported/untested: the owner-only
POSIX permission assumptions have not been validated there. The shell suite
requires Bash and GNU tools, including `stat`, `sed`, `sha256sum`, and `mktemp`;
macOS's default command-line tools are not a tested substitute.

## Safety model

This is a **single-writer helper, not credential-storage elimination**: it reads
`$DSH_HOME/.credentials.yaml` (`refs.DEEPSEEK_API_KEY`) and derives
`$DSH_HOME/.env`, creating a
second plaintext copy. Keep the credential store as the source of truth for
the managed key; do not edit that key in `.env`, and do not run concurrent
writers. Keep the home directory private and trusted. The helper is not a
lock, secret manager, or defense against concurrent directory replacement.

- Missing/invalid source data and symlinked/non-regular source or target files
  are refused. This is file-level symlink refusal, not ancestor-path hardening.
- Writes use a same-directory temporary file, mode `0600` from creation,
  `fsync`, Node parser verification, then atomic replacement. Failed verification
  leaves the old target intact. An already in-sync file is not rewritten or
  permission-repaired; verify its permissions independently.
- Managed duplicates are collapsed; unrelated lines, comments, and order are
  retained, but line endings/final newline are normalized on rewrite. `export
  KEY=...` is recognized and rewritten as a managed assignment (the `export`
  prefix is dropped on that line). This is still not a general dotenv editor.
- **Structural refusal:** a multiline quoted value (a `'`, `"` or backtick
  opener with no same-quote closer on its physical line) or an orphan
  non-comment line without `=` makes the whole file non-rewritable. This
  applies to unrelated variables too: their continuation lines can look
  exactly like a managed assignment. In that state the write, `--check` and
  `--print` all exit `2`, print `unusable-structure`, and leave the old file
  byte- and mode-identical. Fix the multiline value by hand.
- Empty values, leading/trailing whitespace, control characters, double quotes,
  and backslashes are conservatively rejected rather than relying on escaping.
  `$` stays literal; `#` and internal whitespace are quoted. Node parses the
  candidate and its digests are checked before replacement, and every
  non-managed key must keep the same digest as the original file; a rewrite
  that would change an unrelated variable is refused.
- `--check` **reads real local values internally** when pointed at a real home,
  but prints only key names/status, never values or digests. Exit codes: `0`
  in sync, `1` drift/missing key, `2` invalid input/dependency/error or
  `unusable-structure`.
  `--print` is a read-only status report, returning `0` for reported drift;
  errors (including `unusable-structure`) exit `2`. With both flags, check exit
  semantics apply.
- Default mode writes only when drift is found. Status/error messages can
  include local paths; do not publish raw output without review.

## Non-destructive manual setup

Keep this checkout and run the script by path with a Python environment you
control. There is no installer, service, automatic startup hook, or cron job.
If needed, create a dedicated virtual environment and install PyYAML yourself;
review/authorize those dependency downloads separately. Do not replace an
existing active helper, profile, `.env`, or credential store to try this tool.

From the checkout root, after selecting an **existing, intended** DSH home:

```sh
# Read-only checks first; these still read the selected credential store.
DSH_HOME=/path/to/intended-dsh-home python3 tools/dsh-env-sync.py --check
DSH_HOME=/path/to/intended-dsh-home python3 tools/dsh-env-sync.py --print
```

Only after reviewing the target, permissions, and drift, deliberately run the
write command (not part of setup or the test instructions):

```sh
DSH_HOME=/path/to/intended-dsh-home python3 tools/dsh-env-sync.py
```

No live-home command above was used for the publication checks.

## Fake-only tests

From the checkout root:

```sh
bash tools/tests/test-env-sync.sh       # 32 behavior checks
python3 tools/tests/test-atomic.py      # 6 atomic-write checks
```

Both default to the repository's `tools/dsh-env-sync.py`, never a user's active
script. The shell suite defaults to `python3`; choose another environment with
`DSH_ENV_SYNC_PY=/path/to/python`. For the atomic suite, invoke that Python
explicitly. `DSH_ENV_SYNC` is an explicit test-target override; leave it unset
for checkout validation. Every case uses generated fake stores/values. The
shell suite creates an isolated `TMPDIR` parent and removes only its generated
tree via an exit trap; the Python suite uses `TemporaryDirectory` and sets a
fake `DSH_HOME` before loading the helper. Importing the helper initializes
paths but does not read the store; reads happen only in `main()`.
