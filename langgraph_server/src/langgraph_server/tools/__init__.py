"""Tool registry for the LangGraph server."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Dict

from langchain_core.tools import BaseTool

from .docs_tool import search_product_docs
from .list_assets_tool import listAssets
from .render_video_tool import renderVideo
from .time_tool import get_current_time_utc
from .weather_tool import lookup_weather_snapshot


def get_registered_tools() -> Sequence[BaseTool]:
    """Return all tools available to the agent."""

    return (
        get_current_time_utc,
        listAssets,
        search_product_docs,
        renderVideo,
        lookup_weather_snapshot,
    )


def get_tools_by_name() -> Dict[str, BaseTool]:
    """Convenience mapping for tool lookup by name."""

    return {tool.name: tool for tool in get_registered_tools()}


__all__ = [
    "get_registered_tools",
    "get_tools_by_name",
]
