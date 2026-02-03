"""Tool to update a clip on the timeline (modifies Automerge state server-side)."""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from langchain_core.tools import tool

from ..config import get_settings
from ..firebase import get_firestore_client, ensure_main_branch_exists

from .add_clip_tool import (
    _get_project_data,
    _load_automerge_doc,
    _save_automerge_doc,
    _set_project_data,
)

logger = logging.getLogger(__name__)

TEXT_TEMPLATES = ("text", "title-card", "lower-third", "caption-style")

TRANSITION_TYPES = (
    "none", "fade", "slide-left", "slide-right", "slide-up", "slide-down",
    "cross-dissolve", "zoom", "blur", "dip-to-black",
)


def _find_clip(project_data: dict, clip_id: str) -> tuple[dict, dict] | None:
    """Find a clip by ID. Returns (layer, clip) or None."""
    for layer in project_data.get("layers", []):
        for clip in layer.get("clips", []):
            if clip.get("id") == clip_id:
                return (layer, clip)
    return None


def _apply_updates(clip: dict, updates: dict) -> None:
    """Apply updates to a clip dict in-place."""
    for key, value in updates.items():
        if value is not None:
            clip[key] = value


@tool
def updateClipInTimeline(
    clip_id: str,
    name: str | None = None,
    start: float | None = None,
    duration: float | None = None,
    offset: float | None = None,
    speed: float | None = None,
    position: str | None = None,
    scale: str | None = None,
    # Text clip settings (template, subtitle, etc.)
    template: str | None = None,
    subtitle: str | None = None,
    backgroundColor: str | None = None,
    text: str | None = None,
    fontSize: float | None = None,
    fill: str | None = None,
    opacity: float | None = None,
    # Nested JSON for complex settings (optional, overrides flat params if provided)
    text_settings: str | None = None,
    # Enter/exit transitions (in/out effects)
    enter_transition: str | None = None,
    exit_transition: str | None = None,
    # Color correction (video/image clips only)
    color_grading: str | None = None,
    _agent_context: dict | None = None,
) -> dict:
    """Update an existing clip on the project timeline.

    Use getTimelineState to discover clip IDs and their current properties.
    For text clips, use template (text|title-card|lower-third|caption-style),
    subtitle, and backgroundColor to change the text clip style.
    Use enter_transition and exit_transition (JSON: {"type":"fade","duration":0.5})
    to set in/out effects. Types: fade, slide-left, slide-right, slide-up, slide-down,
    zoom, dip-to-black. Duration 0.1-5s. Use type "none" to clear.
    For video/image clips, use color_grading (JSON) to set exposure, contrast, saturation,
    temperature, tint, highlights, shadows (values typically -100 to 100; exposure can be -2 to 2).

    Args:
        clip_id: The clip ID to update (e.g. "clip-abc12345")
        name: Optional new clip name
        start: Optional start time on timeline (seconds)
        duration: Optional duration (seconds)
        offset: Optional source offset (seconds)
        speed: Optional playback speed
        position: Optional JSON object {"x": 0, "y": 0}
        scale: Optional JSON object {"x": 1, "y": 1}
        template: For text clips: text, title-card, lower-third, or caption-style
        subtitle: For text clips with title-card or lower-third template
        backgroundColor: For text clips with background (e.g. rgba(0,0,0,0.8))
        text: For text clips: new text content
        fontSize: For text clips: font size in pixels
        fill: For text clips: text color (e.g. #ffffff)
        opacity: For text clips: opacity 0-1
        text_settings: Optional JSON string with text settings (overrides flat params)
        enter_transition: Optional JSON {"type":"fade","duration":0.5} for in transition
        exit_transition: Optional JSON {"type":"fade","duration":0.5} for out transition
        color_grading: Optional JSON for video/image clips: {"exposure":0,"contrast":0,"saturation":0,"temperature":0,"tint":0,"highlights":0,"shadows":0}. Values -100 to 100 (exposure often -2 to 2).

    Returns:
        Status dict with updated clip info or error message.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")
    branch_id = context.get("branch_id")

    logger.info(
        "[UPDATE_CLIP] Called with: clip_id=%s, name=%s, template=%s, project_id=%s, user_id=%s, branch_id=%s",
        clip_id, name, template, project_id, user_id, branch_id,
    )

    if not user_id or not project_id:
        logger.error("[UPDATE_CLIP] Missing user_id or project_id")
        return {
            "status": "error",
            "message": "User and project context required to modify timeline.",
        }

    clip_id = (clip_id or "").strip()
    if not clip_id:
        return {
            "status": "error",
            "message": "clip_id is required.",
        }

    # Validate template if provided
    if template is not None and template not in TEXT_TEMPLATES:
        return {
            "status": "error",
            "message": f"Invalid template '{template}'. Must be one of: {', '.join(TEXT_TEMPLATES)}.",
        }

    # Build updates dict
    updates: dict[str, Any] = {}
    if name is not None:
        updates["name"] = name.strip() if name else ""
    if start is not None and start >= 0:
        updates["start"] = start
    if duration is not None and duration > 0:
        updates["duration"] = duration
    if offset is not None and offset >= 0:
        updates["offset"] = offset
    if speed is not None and 0 < speed <= 8:
        updates["speed"] = speed
    if position is not None:
        try:
            updates["position"] = json.loads(position) if isinstance(position, str) else position
        except json.JSONDecodeError:
            pass
    if scale is not None:
        try:
            updates["scale"] = json.loads(scale) if isinstance(scale, str) else scale
        except json.JSONDecodeError:
            pass

    # Text clip updates - text_settings JSON overrides flat params
    if text_settings:
        try:
            ts = json.loads(text_settings) if isinstance(text_settings, str) else text_settings
            if isinstance(ts, dict):
                if "text" in ts:
                    updates["text"] = ts["text"]
                if "fontSize" in ts:
                    updates["fontSize"] = ts["fontSize"]
                if "fill" in ts:
                    updates["fill"] = ts["fill"]
                if "opacity" in ts:
                    updates["opacity"] = ts["opacity"]
                if "template" in ts and ts["template"] in TEXT_TEMPLATES:
                    updates["template"] = ts["template"]
                if "subtitle" in ts:
                    updates["subtitle"] = ts["subtitle"]
                if "backgroundColor" in ts:
                    updates["backgroundColor"] = ts["backgroundColor"]
        except (json.JSONDecodeError, TypeError):
            pass
    else:
        if text is not None:
            updates["text"] = text
        if fontSize is not None and fontSize > 0:
            updates["fontSize"] = fontSize
        if fill is not None:
            updates["fill"] = fill
        if opacity is not None and 0 <= opacity <= 1:
            updates["opacity"] = opacity
        if template is not None:
            updates["template"] = template
        if subtitle is not None:
            updates["subtitle"] = subtitle
        if backgroundColor is not None:
            updates["backgroundColor"] = backgroundColor

    # Enter/exit transitions - collect clears and adds separately (clears need del, not set)
    transition_clears: list[str] = []
    for key, param in (("enterTransition", enter_transition), ("exitTransition", exit_transition)):
        if param:
            try:
                t = json.loads(param) if isinstance(param, str) else param
                if isinstance(t, dict):
                    tt = t.get("type", "none")
                    if tt not in TRANSITION_TYPES:
                        continue
                    if tt == "none":
                        transition_clears.append(key)
                    else:
                        dur = t.get("duration", 0.5)
                        if isinstance(dur, (int, float)) and 0.1 <= dur <= 5:
                            updates[key] = {"type": tt, "duration": float(dur)}
            except (json.JSONDecodeError, TypeError):
                pass

    # Color grading (video/image clips only) - applied in _apply_updates when clip type is video/image
    color_grading_updates: dict[str, Any] = {}
    if color_grading:
        try:
            cg = json.loads(color_grading) if isinstance(color_grading, str) else color_grading
            if isinstance(cg, dict):
                for key in ("exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows"):
                    if key in cg and cg[key] is not None:
                        v = cg[key]
                        if isinstance(v, (int, float)):
                            if key == "exposure" and -2 <= v <= 2:
                                color_grading_updates[key] = float(v)
                            elif key != "exposure" and -100 <= v <= 100:
                                color_grading_updates[key] = float(v)
                if color_grading_updates:
                    updates["colorGrading"] = color_grading_updates
        except (json.JSONDecodeError, TypeError):
            pass

    # Merge colorGrading with existing clip values when we apply (see below)
    color_grading_merge = updates.pop("colorGrading", None)

    if not updates and not transition_clears and not color_grading_merge:
        return {
            "status": "error",
            "message": "No valid updates provided.",
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
                    "message": f"Branch '{use_branch_id}' not found.",
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

        found = _find_clip(project_data, clip_id)
        if not found:
            return {
                "status": "error",
                "message": f"Clip '{clip_id}' not found. Use getTimelineState to list clips.",
            }

        layer, clip = found
        clip_type = clip.get("type", "")

        # Enforce source duration for video/audio
        if clip_type in ("video", "audio"):
            source_duration = clip.get("sourceDuration")
            if source_duration is not None:
                new_offset = updates.get("offset", clip.get("offset", 0))
                new_duration = updates.get("duration", clip.get("duration", 0))
                if new_offset + new_duration > source_duration:
                    max_duration = max(0.1, source_duration - new_offset)
                    updates["duration"] = min(new_duration, max_duration)
                if new_offset > source_duration - 0.1:
                    updates["offset"] = max(0, source_duration - 0.1)

        _apply_updates(clip, updates)
        if color_grading_merge is not None and clip.get("type") in ("video", "image"):
            existing = clip.get("colorGrading") or {}
            merged = {**existing, **color_grading_merge}
            clip["colorGrading"] = merged
        for k in transition_clears:
            clip.pop(k, None)
        _set_project_data(doc, project_data)
        new_state = _save_automerge_doc(doc)

        branch_ref.update({
            "automergeState": new_state,
            "commitId": str(uuid.uuid4()),
            "timestamp": int(time.time() * 1000),
        })

        logger.info(
            "[UPDATE_CLIP] SUCCESS: Updated clip %s in project %s (branch %s)",
            clip_id, project_id, use_branch_id,
        )

        return {
            "status": "success",
            "message": f"Updated {clip_type} clip '{clip.get('name', clip_id)}'.",
            "clip": {
                "id": clip_id,
                "type": clip_type,
                "name": clip.get("name"),
                "start": clip.get("start"),
                "duration": clip.get("duration"),
                "template": clip.get("template") if clip_type == "text" else None,
            },
        }

    except Exception as e:
        logger.exception("[UPDATE_CLIP] FAILED: %s", str(e))
        return {
            "status": "error",
            "message": f"Failed to update clip: {str(e)}",
        }
