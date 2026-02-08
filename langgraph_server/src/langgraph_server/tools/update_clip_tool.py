"""Tool to update a clip on the timeline (modifies Automerge state server-side)."""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from langchain_core.tools import tool

from ..config import get_settings
from ..firebase import get_branch_data, set_branch_data, ensure_main_branch_exists

from .add_clip_tool import (
    _get_project_data,
    _load_automerge_doc,
    _save_automerge_doc,
    _set_project_data,
)

logger = logging.getLogger(__name__)

TEXT_TEMPLATES = ("text", "title-card", "lower-third", "caption-style")

ANIMATION_TYPES = ("none", "hover", "pulse", "float", "glow")

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
    # Chroma key / green screen (video/image clips only)
    chroma_key: str | None = None,
    # Video focus area (crop/ken-burns region; video clips only)
    focus: str | None = None,
    # Video clip audio volume 0-1 (video clips only)
    audio_volume: float | None = None,
    # Idle animation (video, text, image clips only): hover, pulse, float, glow
    animation: str | None = None,
    animation_intensity: float | None = None,
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
    temperature, tint, highlights, shadows. IMPORTANT: exposure is the only field with range -2 to 2;
    all others (contrast, saturation, temperature, tint, highlights, shadows) use range -100 to 100.
    Use values like 20 or -30 for visible changes—values like 1.4 are far too small.
    Use chroma_key (JSON) to make a key color transparent: {"color": "#00ff00", "threshold": 0.4, "smoothness": 0.1}.
    color and threshold are required; smoothness is optional (0-1). Omit or set to null to remove chroma key.
    For video clips, use focus (JSON) to set focus/zoom: {"x": 0.5, "y": 0.5, "zoom": 1}. x,y = center (0–1), zoom = 1 for full frame, 2 for 2×. Pass null to clear.
    Use animation (hover|pulse|float|glow) for idle animations on video, text, image clips. Use animation_intensity 0-5 (1=normal, 5=5x). Pass "none" or omit to clear.
    For component clips, text, fontSize, fill, opacity, and speed are applied to the component's inputs (e.g. Typewriter text input).

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
        color_grading: Optional JSON for video/image clips. exposure: -2 to 2 only; contrast, saturation, temperature, tint, highlights, shadows: -100 to 100 (use e.g. 20 or -30 for visible effect—do not use 1.4 or other small values).
        chroma_key: Optional JSON for video/image clips: {"color":"#00ff00","threshold":0.4,"smoothness":0.1}. Key color (hex), threshold 0-1, smoothness 0-1. Pass null to remove.
        focus: Optional JSON for video clips: {"x":0.5,"y":0.5,"zoom":1}. Center (0–1) and zoom ratio. Pass null to clear.
        audio_volume: Optional 0-1 for video clips. Controls the volume of the video's audio track.
        animation: Optional idle animation for video/text/image: hover, pulse, float, glow. "none" to clear.
        animation_intensity: Optional 0-5 (1=normal, 5=5x). Only used when animation is set.

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

    # Chroma key (video/image clips only). Clear if "null" or "".
    chroma_key_clear = False
    if chroma_key is not None:
        if isinstance(chroma_key, str) and chroma_key.strip().lower() in ("null", ""):
            chroma_key_clear = True
        else:
            try:
                ck = json.loads(chroma_key) if isinstance(chroma_key, str) else chroma_key
                if isinstance(ck, dict) and "color" in ck and "threshold" in ck:
                    key_color = str(ck["color"]).strip()
                    threshold = ck.get("threshold", 0.4)
                    smoothness = ck.get("smoothness", 0.1)
                    if isinstance(threshold, (int, float)) and 0 <= threshold <= 1:
                        updates["chromaKey"] = {
                            "color": key_color,
                            "threshold": float(threshold),
                            "smoothness": float(smoothness) if isinstance(smoothness, (int, float)) else 0.1,
                        }
            except (json.JSONDecodeError, TypeError):
                pass

    # Animation (video, text, image clips only). Clear if "none" or "".
    if animation is not None:
        anim = (animation or "").strip().lower()
        if anim in ANIMATION_TYPES and anim != "none":
            updates["animation"] = anim
        elif anim in ("none", ""):
            updates["_clear_animation"] = True  # Flag to remove
    if animation_intensity is not None and isinstance(animation_intensity, (int, float)):
        val = float(animation_intensity)
        if 0 <= val <= 5:
            updates["animationIntensity"] = val

    # Video clip audio volume (video clips only) 0-1.
    if audio_volume is not None and isinstance(audio_volume, (int, float)):
        val = float(audio_volume)
        if 0 <= val <= 1:
            updates["audioVolume"] = val

    # Focus/zoom (video clips only). Clear if "null" or "". Format: {"x": 0.5, "y": 0.5, "zoom": 1}.
    focus_clear = False
    if focus is not None:
        if isinstance(focus, str) and focus.strip().lower() in ("null", ""):
            focus_clear = True
        else:
            try:
                f = json.loads(focus) if isinstance(focus, str) else focus
                if isinstance(f, dict) and "x" in f and "y" in f and "zoom" in f:
                    z_val = f.get("zoom", 1)
                    if isinstance(z_val, (int, float)) and z_val >= 1:
                        updates["focus"] = {
                            "x": max(0, min(1, float(f["x"]))),
                            "y": max(0, min(1, float(f["y"]))),
                            "zoom": float(z_val),
                        }
            except (json.JSONDecodeError, TypeError, KeyError, ValueError):
                pass

    # Merge colorGrading with existing clip values when we apply (see below)
    color_grading_merge = updates.pop("colorGrading", None)

    animation_clear = updates.pop("_clear_animation", False)

    if not updates and not transition_clears and not color_grading_merge and not chroma_key_clear and not focus_clear and not animation_clear:
        return {
            "status": "error",
            "message": "No valid updates provided.",
        }

    settings = get_settings()
    use_branch_id = branch_id or "main"

    try:
        branch_data = get_branch_data(user_id, project_id, use_branch_id, settings)

        if not branch_data:
            if use_branch_id == "main":
                ensure_main_branch_exists(user_id, project_id, settings)
                branch_data = get_branch_data(user_id, project_id, use_branch_id, settings)
            else:
                return {
                    "status": "error",
                    "message": f"Branch '{use_branch_id}' not found.",
                }

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

        # For component clips, map text/fontSize/fill/opacity/speed into inputs (scene uses clip.inputs as component props)
        if clip_type == "component":
            component_input_keys = ("text", "fontSize", "fill", "opacity", "speed")
            for key in component_input_keys:
                if key in updates:
                    clip.setdefault("inputs", {})
                    clip["inputs"][key] = updates.pop(key)

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
        if animation_clear and clip.get("type") in ("video", "text", "image"):
            clip.pop("animation", None)
            clip.pop("animationIntensity", None)
        if color_grading_merge is not None and clip.get("type") in ("video", "image"):
            existing = clip.get("colorGrading") or {}
            merged = {**existing, **color_grading_merge}
            clip["colorGrading"] = merged
        for k in transition_clears:
            clip.pop(k, None)
        if chroma_key_clear and clip.get("type") in ("video", "image"):
            clip.pop("chromaKey", None)
        if focus_clear and clip.get("type") == "video":
            clip.pop("focus", None)
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
