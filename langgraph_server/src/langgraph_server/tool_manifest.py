from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict


def _workdir() -> Path:
    return Path(__file__).resolve().parents[3]


def _manifest_path() -> Path:
    return _workdir() / "shared" / "tools" / "manifest.json"


@lru_cache(maxsize=1)
def load_tool_manifest() -> Dict[str, Any]:
    path = _manifest_path()
    if not path.exists():
        raise FileNotFoundError(f"Tool manifest not found at {path}")
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    tools = payload.get("tools")
    if not isinstance(tools, dict):
        raise ValueError("Tool manifest is missing the 'tools' section.")
    return tools


def get_tool_metadata(name: str) -> Dict[str, Any] | None:
    tools = load_tool_manifest()
    entry = tools.get(name)
    return entry
