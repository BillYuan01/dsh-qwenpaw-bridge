#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unit checks for the atomic-write path of dsh-env-sync (no credentials read).

Loads the hardened script as a module by path, then exercises `atomic_write`
with `os.replace` patched to fail, and records the temp file's mode at replace
time. Everything runs against fake values in a throwaway directory.
"""
from __future__ import annotations

import importlib.util
import os
import pathlib
import stat
import sys
import tempfile

TARGET = os.environ.get("DSH_ENV_SYNC") or str(pathlib.Path(__file__).resolve().parents[1] / "dsh-env-sync.py")
FAKE = "fake-atomic-value-0042"
passes = 0
failures = 0


def ok(name: str) -> None:
    global passes
    passes += 1
    print(f"PASS  {name}")


def bad(name: str, detail: str) -> None:
    global failures
    failures += 1
    print(f"FAIL  {name} -- {detail}")


def load_module():
    spec = importlib.util.spec_from_loader("dsh_env_sync", loader=None)
    module = importlib.util.module_from_spec(spec)
    source = pathlib.Path(TARGET).read_text(encoding="utf-8")
    exec(compile(source, TARGET, "exec"), module.__dict__)
    return module


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        home = pathlib.Path(raw)
        # Set the fake home before module constants are initialized; importing
        # the helper does not read credentials or invoke its main function.
        os.environ["DSH_HOME"] = str(home)
        module = load_module()
        target = home / ".env"
        target.write_text("OLD_VAR=keep\n", encoding="utf-8")
        os.chmod(target, 0o600)
        before = target.read_bytes()

        real_replace = os.replace
        seen: dict[str, object] = {}

        def exploding_replace(src, dst):
            seen["mode"] = stat.S_IMODE(os.stat(src).st_mode)
            seen["tmp_name"] = pathlib.Path(src).name
            raise OSError("simulated replace failure")

        module.os.replace = exploding_replace
        try:
            module.atomic_write(target, f"DEEPSEEK_API_KEY={FAKE}\n", {"DEEPSEEK_API_KEY": FAKE})
            bad("failed replace must raise", "no exception")
        except OSError:
            if target.read_bytes() == before:
                ok("failed replace leaves the old file byte-identical")
            else:
                bad("failed replace leaves the old file byte-identical", "content changed")
        leftovers = [p.name for p in home.iterdir() if p.name.startswith(".env.tmp-")]
        if not leftovers:
            ok("failed replace leaves no temp file behind")
        else:
            bad("failed replace leaves no temp file behind", str(leftovers))
        if seen.get("mode") == 0o600:
            ok("temp file is 0600 before os.replace")
        else:
            bad("temp file is 0600 before os.replace", f"mode={seen.get('mode')}")

        module.os.replace = real_replace
        text = module.render(target.read_text(encoding="utf-8"), {"DEEPSEEK_API_KEY": FAKE})
        module.atomic_write(target, text, {"DEEPSEEK_API_KEY": FAKE})
        mode = stat.S_IMODE(os.stat(target).st_mode)
        parsed = module.parse_with_node(target)
        if mode == 0o600 and parsed.get("DEEPSEEK_API_KEY") == module.digest(FAKE):
            ok("successful replace writes mode 0600 and verifies through DSH's parser")
        else:
            bad("successful replace writes mode 0600", f"mode={mode} parsed={parsed.get('DEEPSEEK_API_KEY')}")

        if "OLD_VAR=keep" not in target.read_text(encoding="utf-8"):
            bad("unmanaged variable survives a rewrite", target.read_text(encoding="utf-8"))
        else:
            ok("unmanaged variable survives a rewrite")

        # A candidate that would change a non-managed variable is refused even
        # when the managed key itself round-trips.
        other = home / "other.env"
        other.write_text("KEEP_VAR=original\n", encoding="utf-8")
        baseline = module.parse_with_node(other)
        before_other = other.read_bytes()
        try:
            module.atomic_write(
                other,
                "KEEP_VAR=changed\nDEEPSEEK_API_KEY=" + FAKE + "\n",
                {"DEEPSEEK_API_KEY": FAKE},
                baseline=baseline,
            )
            bad("unrelated digest change must be refused", "no exception")
        except SystemExit as error:
            if other.read_bytes() == before_other:
                ok(f"unrelated digest change refused (exit {error.code}), old file intact")
            else:
                bad("unrelated digest change refused", "target changed")

    print(f"\n{passes} passed, {failures} failed")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
