"""Tool to set scene configuration (resolution, fps, background, name)."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from langchain_core.tools import tool

from ..config import get_settings
from ..firebase import get_firestore_client, ensure_main_branch_exists, update_project_name

from .add_clip_tool import (
    _get_project_data,
    _load_automerge_doc,
    _save_automerge_doc,
    _set_project_data,
)

logger = logging.getLogger(__name__)

# Bounds aligned with app (project-store.ts, SceneSettings)
MIN_WIDTH = 320
MIN_HEIGHT = 240
MIN_FPS = 1
MAX_FPS = 240


@tool
def setSceneConfig(
    width: int | None = None,
    height: int | None = None,
    fps: int | None = None,
    background: str | None = None,
    name: str | None = None,
    _agent_context: dict | None = None,
) -> dict:
    """Set the project scene configuration: dimensions (width x height), frame rate (fps), background color, or project name.

    Only provided fields are updated; others are left unchanged.
    Use this to change resolution (e.g. 1920x1080), fps (e.g. 24, 30, 60), background (hex color), or project name.

    Args:
        width: Output width in pixels (min 320). Use with height to set resolution.
        height: Output height in pixels (min 240). Use with width to set resolution.
        fps: Frames per second (1–240). Common values: 24, 25, 30, 50, 60.
        background: Background color as hex (e.g. "#000000" for black).
        name: Project display name.

    Returns:
        Status dict with updated config or error message.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")
    branch_id = context.get("branch_id")

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "User and project context required to set scene config.",
        }

    if width is None and height is None and fps is None and background is None and name is None:
        return {
            "status": "error",
            "message": "Provide at least one of: width, height, fps, background, name.",
        }

    # Resolution: require both if either is set
    if (width is not None) != (height is not None):
        return {
            "status": "error",
            "message": "Provide both width and height to set resolution.",
        }

    if width is not None and (width < MIN_WIDTH or height is not None and height < MIN_HEIGHT):
        return {
            "status": "error",
            "message": f"Resolution must be at least {MIN_WIDTH}x{MIN_HEIGHT}.",
        }

    if fps is not None and (fps < MIN_FPS or fps > MAX_FPS):
        return {
            "status": "error",
            "message": f"fps must be between {MIN_FPS} and {MAX_FPS}.",
        }

    settings = get_settings()
    db = get_firestore_client(settings)
    use_branch_id = branch_id or "main"

    try:
        branch_ref = (
            db.collection("users")
            .document(user_id)
            .collection("projects")
            .document(project_id)
            .collection("branches")
            .document(use_branch_id)
        )
        branch_doc = branch_ref.get()

        if not branch_doc.exists:
            if use_branch_id == "main":
                ensure_main_branch_exists(user_id, project_id, settings)
                branch_doc = branch_ref.get()
            else:
                return {
                    "status": "error",
                    "message": f"Branch '{use_branch_id}' not found for project.",
                }

        branch_data = branch_doc.to_dict()
        automerge_state = branch_data.get("automergeState")

        if not automerge_state:
            if use_branch_id == "main":
                automerge_state = ensure_main_branch_exists(user_id, project_id, settings)
            else:
                return {
                    "status": "error",
                    "message": "Project has no timeline data yet.",
                }

        doc = _load_automerge_doc(automerge_state)
        project_data = _get_project_data(doc)

        if not project_data:
            return {
                "status": "error",
                "message": "Could not parse project timeline data.",
            }

        # Apply updates
        if width is not None and height is not None:
            project_data["resolution"] = {
                "width": max(MIN_WIDTH, width),
                "height": max(MIN_HEIGHT, height),
            }
        if fps is not None:
            project_data["fps"] = max(MIN_FPS, min(MAX_FPS, fps))
        if background is not None:
            project_data["background"] = background
        if name is not None:
            project_data["name"] = name or "Untitled Project"
            # Keep Firestore project metadata in sync so app shows the name
            update_project_name(user_id, project_id, project_data["name"], settings)

        _set_project_data(doc, project_data)
        new_state = _save_automerge_doc(doc)

        branch_ref.update({
            "automergeState": new_state,
            "commitId": str(uuid.uuid4()),
            "timestamp": int(time.time() * 1000),
        })

        resolution = project_data.get("resolution", {})
        updated: dict[str, Any] = {
            "resolution": {"width": resolution.get("width", 1920), "height": resolution.get("height", 1080)},
            "fps": project_data.get("fps", 30),
            "background": project_data.get("background", "#000000"),
            "name": project_data.get("name", "Untitled Project"),
        }

        lines = [
            "Scene config updated.",
            f"Resolution: {updated['resolution']['width']}x{updated['resolution']['height']}",
            f"FPS: {updated['fps']}",
            f"Background: {updated['background']}",
            f"Name: {updated['name']}",
        ]

        return {
            "status": "success",
            "message": " ".join(lines),
            "config": updated,
        }
    except Exception as e:
        logger.exception("[SET_SCENE_CONFIG] %s", e)
        return {
            "status": "error",
            "message": str(e),
        }
