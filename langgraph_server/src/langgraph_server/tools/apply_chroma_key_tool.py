"""Tool to apply chroma key (green screen) to a video or image clip."""

from __future__ import annotations

import logging
import time
import uuid

from langchain_core.tools import tool

from ..config import get_settings
from ..firebase import get_branch_data, set_branch_data, ensure_main_branch_exists

from .add_clip_tool import (
    _get_project_data,
    _load_automerge_doc,
    _save_automerge_doc,
    _set_project_data,
)
from .update_clip_tool import _find_clip

logger = logging.getLogger(__name__)


@tool
def applyChromaKeyToClip(
    clip_id: str,
    color: str,
    threshold: float = 0.4,
    smoothness: float = 0.1,
    _agent_context: dict | None = None,
) -> dict:
    """Apply a chroma key (green screen) effect to a video or image clip.

    Makes the chosen key color transparent so the clip can be composited over
    another background. Use getTimelineState to find clip IDs.

    Args:
        clip_id: The clip ID to apply chroma key to (e.g. "clip-abc12345").
        color: Key color as hex (e.g. "#00ff00" for green, "#0000ff" for blue).
        threshold: Tolerance 0-1; higher = more of the key color becomes transparent (default 0.4).
        smoothness: Edge softness 0-1 (default 0.1).

    Returns:
        Status dict with clip info or error message.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")
    branch_id = context.get("branch_id")

    clip_id = (clip_id or "").strip()
    if not clip_id:
        return {"status": "error", "message": "clip_id is required."}

    color = (color or "").strip()
    if not color.startswith("#") or len(color) < 4:
        return {"status": "error", "message": "color must be a hex value (e.g. #00ff00)."}

    threshold = max(0.0, min(1.0, float(threshold)))
    smoothness = max(0.0, min(1.0, float(smoothness)))

    if not user_id or not project_id:
        return {"status": "error", "message": "User and project context required."}

    settings = get_settings()
    use_branch_id = branch_id or "main"

    try:
        branch_data = get_branch_data(user_id, project_id, use_branch_id, settings)

        if not branch_data:
            if use_branch_id == "main":
                ensure_main_branch_exists(user_id, project_id, settings)
                branch_data = get_branch_data(user_id, project_id, use_branch_id, settings)
            else:
                return {"status": "error", "message": f"Branch '{use_branch_id}' not found."}

        automerge_state = branch_data.get("automergeState")
        if not automerge_state:
            if use_branch_id == "main":
                automerge_state = ensure_main_branch_exists(user_id, project_id, settings)
            else:
                return {"status": "error", "message": "Project has no timeline data yet."}

        doc = _load_automerge_doc(automerge_state)
        project_data = _get_project_data(doc)
        if not project_data:
            return {"status": "error", "message": "Could not parse project timeline data."}

        found = _find_clip(project_data, clip_id)
        if not found:
            return {"status": "error", "message": f"Clip '{clip_id}' not found. Use getTimelineState to list clips."}

        layer, clip = found
        clip_type = clip.get("type", "")
        if clip_type not in ("video", "image"):
            return {"status": "error", "message": "Chroma key can only be applied to video or image clips."}

        clip["chromaKey"] = {
            "color": color,
            "threshold": threshold,
            "smoothness": smoothness,
        }
        _set_project_data(doc, project_data)
        new_state = _save_automerge_doc(doc)

        set_branch_data(
            user_id,
            project_id,
            use_branch_id,
            {
                **branch_data,
                "automergeState": new_state,
                "commitId": str(uuid.uuid4()),
                "timestamp": int(time.time() * 1000),
            },
            settings,
        )

        logger.info(
            "[APPLY_CHROMA_KEY] Applied chroma key to clip %s in project %s (branch %s)",
            clip_id, project_id, use_branch_id,
        )

        return {
            "status": "success",
            "message": f"Applied chroma key to {clip_type} clip '{clip.get('name', clip_id)}' (key color {color}).",
            "clip": {
                "id": clip_id,
                "type": clip_type,
                "name": clip.get("name"),
                "chromaKey": clip["chromaKey"],
            },
        }

    except Exception as e:
        logger.exception("[APPLY_CHROMA_KEY] FAILED: %s", str(e))
        return {"status": "error", "message": str(e)}
