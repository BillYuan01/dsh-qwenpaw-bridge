# -*- coding: utf-8 -*-
"""Minimal, self-contained helpers for the dsh-qwenpaw-bridge live probe.

This file deliberately has no dependency on the qwenpaw-dsh repository. Its
only hard requirement is the official ACP Python SDK (import name ``acp``),
which ships inside the QwenPaw virtualenv.

MIT licensed, same as the bridge. Keep it small: the probe is an acceptance
tool, not a general-purpose ACP client library.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

try:
    from acp import PROTOCOL_VERSION, spawn_agent_process  # noqa: F401
    from acp.schema import (  # noqa: F401
        AllowedOutcome,
        ClientCapabilities,
        DeniedOutcome,
        Implementation,
        RequestPermissionResponse,
    )
except Exception as exc:  # pragma: no cover - environment guard
    raise SystemExit(
        "This probe needs the official ACP Python SDK (import name 'acp').\n"
        "Run it with the QwenPaw virtualenv, for example:\n"
        "    ~/.qwenpaw/venv/bin/python test/probe.py --dsh-home <home>\n"
        f"Underlying import error: {exc!r}",
    )

DSH_BIN = shutil.which("dsh") or str(Path.home() / ".local" / "bin" / "dsh")

PermissionDecider = Callable[[list[Any], Any, dict[str, Any]], "str | None"]


def dsh_version() -> str:
    """Return the installed DSH version, or an explanatory placeholder."""
    try:
        out = subprocess.run(
            [DSH_BIN, "--version"], capture_output=True, text=True, timeout=60,
        )
        return (out.stdout or out.stderr).strip().splitlines()[0]
    except Exception as exc:  # pragma: no cover - environment dependent
        return f"<unavailable: {exc!r}>"


def package_version() -> str:
    """Read this repository's package version without a build step."""
    try:
        manifest = json.loads(
            (Path(__file__).resolve().parent.parent / "package.json").read_text(encoding="utf-8"),
        )
        return str(manifest.get("version", "<unknown>"))
    except Exception:
        return "<unknown>"


def jsonable(obj: Any) -> Any:
    """Convert pydantic models (ACP SDK) to plain JSON-compatible data."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(by_alias=True, exclude_none=True, mode="json")
    return obj


def prepare_home(home: Path) -> dict[str, Any]:
    """Link credentials into an already-installed isolated DSH home.

    The profile itself must exist: this repository intentionally does not
    create one, because the supported install path is
    ``--from-default-profile acp`` followed by ``dsh plugin add``.
    """
    home.mkdir(parents=True, exist_ok=True)
    target = home / ".credentials.yaml"
    source = Path.home() / ".dsh" / ".credentials.yaml"
    linked = False
    if not target.exists() and source.exists():
        target.symlink_to(source)
        linked = True
    return {
        "credentials_file": str(target),
        "credentials_file_exists": target.exists(),
        "credentials_symlinked": linked,
        "api_key_env_present": [
            key for key in ("DEEPSEEK_API_KEY", "OPENCODE_GO_API_KEY", "ANTHROPIC_API_KEY")
            if os.environ.get(key)
        ],
    }


def profile_installed(home: Path, profile: str) -> bool:
    return (home / "profiles" / profile / "package.json").exists()


def dsh_env(home: Path, extra: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ)
    env["DSH_HOME"] = str(home)
    for key in ("DSH_PROFILE", "DSH_PROFILE_DIR", "DSH_SESSION_ID", "DSH_SHELL", "DSH_TUI", "DSH_WEB"):
        env.pop(key, None)
    if extra:
        env.update({key: value for key, value in extra.items() if value is not None})
    return env


def _dump(model: Any) -> Any:
    return jsonable(model)


def pick_option(options: list[Any], kinds: tuple[str, ...]) -> str | None:
    for option in options:
        if getattr(option, "kind", None) in kinds:
            return option.option_id
    return None


def allow_once_decider(options: list[Any], tool_call: Any, meta: dict[str, Any]) -> str | None:
    return pick_option(options, ("allow_once", "allow_always"))


@dataclass
class ProbeClient:
    """ACP client that records every update and permission request."""

    decider: PermissionDecider = allow_once_decider
    t0: float = field(default_factory=time.monotonic)
    updates: list[dict[str, Any]] = field(default_factory=list)
    permissions: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: dict[str, dict[str, Any]] = field(default_factory=dict)
    conn: Any = None

    def on_connect(self, conn: Any) -> None:
        self.conn = conn

    def _record(self, payload: dict[str, Any]) -> dict[str, Any]:
        payload["t"] = round(time.monotonic() - self.t0, 4)
        self.updates.append(payload)
        return payload

    async def session_update(self, session_id: str, update: Any, **_: Any) -> None:
        data = _dump(update)
        kind = data.get("sessionUpdate", type(update).__name__)
        record = {"session_id": session_id, "kind": kind, "update": data}
        tool_call_id = data.get("toolCallId")
        if tool_call_id:
            record["toolCallId"] = tool_call_id
            if kind == "tool_call":
                self.tool_calls[tool_call_id] = dict(data)
            else:
                merged = self.tool_calls.setdefault(tool_call_id, {})
                for key, value in data.items():
                    if key != "sessionUpdate" and value is not None:
                        merged[key] = value
        self._record(record)

    async def request_permission(
        self, options: list[Any], session_id: str, tool_call: Any, **_: Any,
    ) -> RequestPermissionResponse:
        dumped_options = [_dump(option) for option in options]
        dumped_tool = _dump(tool_call)
        chosen = self.decider(options, tool_call, {"tool_call": dumped_tool})
        self.permissions.append({
            "session_id": session_id,
            "options": dumped_options,
            "tool_call": dumped_tool,
            "chosen_option_id": chosen,
            "t": round(time.monotonic() - self.t0, 4),
        })
        if chosen:
            return RequestPermissionResponse(outcome=AllowedOutcome(option_id=chosen))
        return RequestPermissionResponse(outcome=DeniedOutcome(outcome="cancelled"))

    async def read_text_file(self, path: str, session_id: str, **_: Any) -> Any:
        return {"content": Path(path).read_text(encoding="utf-8", errors="replace")}

    async def write_text_file(self, content: str, path: str, session_id: str, **_: Any) -> None:
        Path(path).write_text(content, encoding="utf-8")

    async def ext_method(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        return {}

    async def ext_notification(self, method: str, params: dict[str, Any]) -> None:
        return None

    def updates_of(self, kind: str) -> list[dict[str, Any]]:
        return [update for update in self.updates if update["kind"] == kind]

    def assistant_text(self) -> str:
        parts = []
        for update in self.updates_of("agent_message_chunk"):
            content = update["update"].get("content") or {}
            if isinstance(content, dict) and content.get("type") == "text":
                parts.append(content.get("text", ""))
        return "".join(parts)


@asynccontextmanager
async def open_acp(
    *,
    home: Path,
    workdir: Path,
    client: ProbeClient,
    profile: str,
):
    """Spawn ``dsh --profile <profile>`` and speak ACP over stdio."""
    env = dsh_env(home)
    workdir.mkdir(parents=True, exist_ok=True)
    async with spawn_agent_process(
        client, DSH_BIN, "--profile", profile, cwd=str(workdir), env=env,
    ) as (conn, process):
        yield conn, process


async def initialize(conn: Any, *, streaming: bool = True) -> Any:
    kwargs: dict[str, Any] = {
        "protocol_version": PROTOCOL_VERSION,
        "client_capabilities": ClientCapabilities(),
        "client_info": Implementation(name="dsh-qwenpaw-bridge-probe", version=package_version()),
    }
    if not streaming:
        kwargs["qwenpaw"] = {"streaming": False}
    return await conn.initialize(**kwargs)
