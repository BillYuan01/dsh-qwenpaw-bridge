#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Report the ACP model catalog a DSH profile advertises, and when it appears.

No model is prompted: the probe initializes ACP and opens two sessions.
Use only a preconfigured isolated profile and fake credentials; profile startup
may itself have side effects. Sampling distinct times does not establish model
discovery causality. See diagnostics/README.md before running.
Prints one JSON object: local paths, bridge identity, catalog at initialize,
at the first session, and after a short delay, plus config-option identifiers.
Do not upload raw output.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

BRIDGE_TESTS = Path(__file__).resolve().parents[1] / 'test'
sys.path.insert(0, str(BRIDGE_TESTS))

from spike_lib import ProbeClient, initialize, jsonable, open_acp  # noqa: E402


def catalog(meta: dict) -> dict:
    qp = (meta or {}).get("qwenpaw") or {}
    models = qp.get("models") or []
    return {
        "bridge": qp.get("bridge"),
        "version": qp.get("version"),
        "protocol": qp.get("protocol"),
        "models": [f"{m.get('provider')}/{m.get('id')}" for m in models],
    }


async def main() -> int:
    home = Path(sys.argv[1]).expanduser().resolve()
    work = Path(sys.argv[2]).expanduser().resolve()
    work.mkdir(parents=True, exist_ok=True)
    mark = sys.argv[3] if len(sys.argv) > 3 else ""
    delay = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0

    client = ProbeClient()
    report: dict = {"home": str(home), "scenario": mark, "delay_s": delay}
    async with open_acp(home=home, workdir=work, client=client, profile="qwenpaw") as (conn, _proc):
        init = jsonable(await initialize(conn))
        report["at_initialize"] = catalog(init.get("_meta") or {})

        first = await conn.new_session(cwd=str(work))
        first_dump = jsonable(first)
        report["at_first_session"] = catalog(first_dump.get("_meta") or {})
        report["config_option_ids"] = [o.get("id") for o in (first_dump.get("configOptions") or [])]

        t0 = time.monotonic()
        await asyncio.sleep(delay)
        second = await conn.new_session(cwd=str(work))
        second_dump = jsonable(second)
        report["at_delayed_session"] = catalog(second_dump.get("_meta") or {})
        report["elapsed_before_delayed_s"] = round(time.monotonic() - t0, 3)

        await conn.close_session(session_id=first.session_id)
        await conn.close_session(session_id=second.session_id)

    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
