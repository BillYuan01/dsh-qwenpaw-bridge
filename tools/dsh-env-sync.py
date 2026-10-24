#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sync DSH's headless API keys from its credential store into ``$DSH_HOME/.env``.

Optional workaround for headless profiles that need a launch-environment key
before credential-service resolution is available. Whether this is needed
depends on the profile and DSH version; it is not a claim that ACP ignores the
credential store or a diagnosis of model-discovery timing. This helper copies
the managed value into an additional plaintext file; it does not eliminate
credential storage.

Model (single writer, derived file):
  * the credential store is the only place a human edits;
  * ``.env`` is derived from it by this tool and is never hand-edited;
  * manual ``--check`` reports drift when run; no scheduler is installed.

Usage:
    dsh-env-sync            # write/refresh $DSH_HOME/.env (default ~/.dsh/.env)
    dsh-env-sync --check    # exit 0 if in sync, 1 if stale/missing (no write)
    dsh-env-sync --print    # same report as --check, exit 0 unless an error occurs

Safety rules:
  * never prints a secret, only key names and their state; values are compared
    as SHA-256 digests, so they do not cross the helper's stdout either;
  * a missing/unreadable/invalid source fails without touching the target;
  * the credential file and the target must be regular files, not symlinks or
    directories;
  * the write is atomic (same-directory temp file, mode 0600 from creation,
    fsync, a verified parse, then os.replace), so a failure cannot tear the old
    file;
  * **encoding is verified against DSH's own parser** (Node's
    ``util.parseEnv``, the same one ``process.loadEnvFile`` uses) before the
    replace; a value that cannot be represented losslessly is refused instead
    of being written altered. No key-prefix guessing;
  * ``$`` needs no escaping (that parser does not expand variables), ``#`` and
    inner whitespace are quoted, and ``"``/``\\`` are conservatively refused
    rather than attempting escape handling;
  * unrelated lines, comments, and ordering are retained; line endings and
    the final newline are normalized on rewrite.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile

KEYS = ("DEEPSEEK_API_KEY",)
HOME = pathlib.Path(os.environ.get("DSH_HOME") or (pathlib.Path.home() / ".dsh")).expanduser()
CREDS = HOME / ".credentials.yaml"
ENV_FILE = HOME / ".env"
NODE = os.environ.get("DSH_ENV_SYNC_NODE") or "node"

IN_SYNC = "in-sync"
MISSING_IN_ENV = "missing-in-env"
STALE = "stale"
MISSING_IN_STORE = "missing-in-store"

# Read and digest the file with the parser DSH itself uses: Node's
# `process.loadEnvFile` is `util.parseEnv`, so the digest comparison below is a
# check of real loader semantics, not of this script's own idea of dotenv.
NODE_READER = r"""
const { parseEnv } = require('node:util')
const fs = require('node:fs')
const crypto = require('node:crypto')
const text = fs.readFileSync(process.argv[1], 'utf8')
const parsed = parseEnv(text)
const out = {}
for (const [key, value] of Object.entries(parsed)) {
  out[key] = crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}
process.stdout.write(JSON.stringify(out))
"""


def fail(message: str) -> None:
    sys.stderr.write(f"dsh-env-sync: {message}\n")
    raise SystemExit(2)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def regular_file(path: pathlib.Path, what: str) -> bool:
    """True when *path* is a regular file; refuses symlinks and other file types."""
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    if stat.S_ISLNK(info.st_mode):
        fail(f"{what} is a symbolic link ({path}); refusing to read or write through it")
    if not stat.S_ISREG(info.st_mode):
        fail(f"{what} is not a regular file ({path})")
    return True


def read_store() -> dict[str, str]:
    """Return ref name -> secret from the credential store (values never printed)."""
    try:
        import yaml
    except ImportError:
        fail("PyYAML is required (use a Python environment with PyYAML installed)")
    if not regular_file(CREDS, "credential store"):
        fail(f"credential store not found: {CREDS}")
    try:
        data = yaml.safe_load(CREDS.read_text(encoding="utf-8")) or {}
    except Exception as error:  # noqa: BLE001 - any parse/IO problem is fatal, not skipped
        fail(f"credential store is unreadable or invalid ({type(error).__name__}); nothing written")
    if not isinstance(data, dict):
        fail("credential store root is not a mapping; nothing written")
    refs = data.get("refs") or {}
    if not isinstance(refs, dict):
        fail("credential store 'refs' is not a mapping; nothing written")
    return {k: v for k, v in refs.items() if isinstance(v, str)}


def parse_with_node(path: pathlib.Path) -> dict[str, str]:
    """Digest map of a dotenv file, read by DSH's own parser."""
    try:
        done = subprocess.run(
            [NODE, "-e", NODE_READER, str(path)],
            capture_output=True, text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        fail(f"cannot run {NODE} to verify dotenv semantics ({type(error).__name__}); nothing written")
    if done.returncode != 0:
        detail = (done.stderr or "").strip().splitlines()
        fail(f"{NODE} could not parse {path.name} ({detail[0] if detail else 'no stderr'}); nothing written")
    try:
        return json.loads(done.stdout)
    except json.JSONDecodeError:
        fail(f"{NODE} returned an unreadable digest map; nothing written")


def encode_line(name: str, value: str) -> str:
    """One dotenv line for *value*; refuses what the loader cannot represent."""
    if value == "":
        fail(f"{name} is empty in the credential store; nothing written")
    if value != value.strip():
        fail(f"{name} has leading/trailing whitespace, which is not representable; nothing written")
    for char, label in {"\n": "newline", "\r": "carriage return", "\x00": "NUL"}.items():
        if char in value:
            fail(f"{name} contains a {label}, which would inject dotenv lines; nothing written")
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in value):
        fail(f"{name} contains a control character; nothing written")
    if '"' in value:
        fail(f"{name} contains a double quote; conservative encoding policy refuses it; nothing written")
    if "\\" in value:
        fail(f"{name} contains a backslash; conservative encoding policy refuses it; nothing written")
    # `#` truncates an unquoted value; whitespace does not survive unquoted either.
    if any(ch.isspace() for ch in value) or "#" in value:
        return f'{name}="{value}"'
    return f"{name}={value}"


def render(existing: str, updates: dict[str, str]) -> str:
    """Rewrite managed lines, preserving other lines and normalizing line endings."""
    lines = existing.splitlines() if existing else []
    kept: list[str] = []
    seen: set[str] = set()
    for line in lines:
        name = line.partition("=")[0].strip()
        if name in updates:
            if name in seen:  # collapse duplicates instead of emitting both
                continue
            seen.add(name)
            kept.append(encode_line(name, updates[name]))
            continue
        kept.append(line)
    for name, value in updates.items():
        if name not in seen:
            kept.append(encode_line(name, value))
    return "\n".join(kept) + "\n"


def atomic_write(path: pathlib.Path, text: str, expect: dict[str, str]) -> None:
    """Write *text* atomically after proving the loader reads back exactly *expect*."""
    if path.exists() or path.is_symlink():
        regular_file(path, "target .env")
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".env.tmp-")
    tmp = pathlib.Path(tmp_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        parsed = parse_with_node(tmp)
        for name, value in expect.items():
            got = parsed.get(name)
            if got is None:
                fail(f"verification failed: {name} is not readable back from the encoded line; nothing written")
            if got != digest(value):
                fail(f"verification failed: {name} would not round-trip through DSH's dotenv parser; nothing written")
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        tmp.unlink(missing_ok=True)
        raise
    finally:
        tmp.unlink(missing_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync DSH headless keys into $DSH_HOME/.env")
    ap.add_argument("--check", action="store_true", help="report drift, change nothing")
    ap.add_argument("--print", dest="show", action="store_true", help="show status per key")
    args = ap.parse_args()

    store = read_store()
    target_exists = regular_file(ENV_FILE, "target .env")
    current = parse_with_node(ENV_FILE) if target_exists else {}

    status: dict[str, str] = {}
    for key in KEYS:
        want = store.get(key)
        have = current.get(key)
        if want is None:
            status[key] = MISSING_IN_STORE
        elif have is None:
            status[key] = MISSING_IN_ENV
        elif have == digest(want):
            status[key] = IN_SYNC
        else:
            status[key] = STALE

    if args.show or args.check:
        for key, state in status.items():
            print(f"{key}: {state}")
        drifted = [k for k, s in status.items() if s != IN_SYNC]
        if args.check:
            return 1 if drifted else 0
        return 0

    updates: dict[str, str] = {}
    for key, state in status.items():
        if state in (MISSING_IN_ENV, STALE):
            updates[key] = store[key]
        elif state == MISSING_IN_STORE:
            fail(f"{key} is absent from the credential store; nothing written")

    if not updates:
        print(f"dsh-env-sync: {ENV_FILE} already in sync")
        return 0

    existing = ENV_FILE.read_text(encoding="utf-8") if target_exists else ""
    atomic_write(ENV_FILE, render(existing, updates), updates)
    print(f"dsh-env-sync: wrote {', '.join(updates)} -> {ENV_FILE} (mode 600)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
