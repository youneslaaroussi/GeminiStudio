"""Tool registry for the LangGraph server."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Dict

from langchain_core.tools import BaseTool

from .add_clip_tool import addClipToTimeline
from .delete_clip_tool import deleteClipFromTimeline
from .docs_tool import search_product_docs
from .generate_image_tool import generateImage
from .generate_veo_video_tool import generateVeoVideo
from .get_asset_metadata_tool import getAssetMetadata
from .get_project_summary_tool import getProjectSummary
from .list_assets_tool import listAssets
from .list_project_assets_tool import listProjectAssets
from .render_video_tool import renderVideo
from .time_tool import get_current_time_utc
from .weather_tool import lookup_weather_snapshot


def get_registered_tools() -> Sequence[BaseTool]:
    """Return all tools available to the agent."""

    return (
        addClipToTimeline,
        deleteClipFromTimeline,
        generateImage,
        generateVeoVideo,
        get_current_time_utc,
        getAssetMetadata,
        getProjectSummary,
        listAssets,
        listProjectAssets,
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
