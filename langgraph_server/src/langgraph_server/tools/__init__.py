"""Tool registry for the LangGraph server."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Dict

from langchain_core.tools import BaseTool

from .add_clip_tool import addClipToTimeline
from .apply_video_effect_tool import applyVideoEffectToClip, getVideoEffectJobStatus
from .delete_clip_tool import deleteClipFromTimeline
from .docs_tool import search_product_docs
from .generate_image_tool import generateImage
from .generate_music_tool import generateMusic
from .generate_tts_tool import generateSpeech
from .generate_veo_video_tool import generateVeoVideo
from .get_asset_metadata_tool import getAssetMetadata
from .get_timeline_state_tool import getTimelineState
from .list_assets_tool import listAssets
from .list_project_assets_tool import listProjectAssets
from .plan_narrative_edit_tool import createEditPlan
from .render_video_tool import renderVideo
from .search_assets_tool import searchAssets
from .subscribe_pipeline_tool import subscribeToAssetPipeline
from .time_tool import get_current_time_utc
from .weather_tool import lookup_weather_snapshot


def get_registered_tools() -> Sequence[BaseTool]:
    """Return all tools available to the agent."""

    return (
        addClipToTimeline,
        applyVideoEffectToClip,
        getVideoEffectJobStatus,
        deleteClipFromTimeline,
        generateImage,
        generateMusic,
        generateSpeech,
        generateVeoVideo,
        get_current_time_utc,
        getAssetMetadata,
        getTimelineState,
        listAssets,
        listProjectAssets,
        createEditPlan,
        searchAssets,
        search_product_docs,
        renderVideo,
        subscribeToAssetPipeline,
        lookup_weather_snapshot,
    )


def get_tools_by_name() -> Dict[str, BaseTool]:
    """Convenience mapping for tool lookup by name."""

    return {tool.name: tool for tool in get_registered_tools()}


__all__ = [
    "get_registered_tools",
    "get_tools_by_name",
]
