from __future__ import annotations

from datetime import datetime, timezone

from langchain_core.tools import tool


@tool
def get_current_time_utc() -> str:
    """Return the current time in UTC (ISO8601)."""

    return datetime.now(timezone.utc).isoformat()
