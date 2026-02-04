"""Tool to set project caption settings (style for audio/video clip captions)."""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
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


def _load_font_families() -> tuple[str, ...]:
    """Load font families from shared/fonts.json (single source of truth with app)."""
    # Single path calculation: go up 5 levels from this file to reach base directory
    # Works in both dev and Docker when structure matches
    base_path = Path(__file__).resolve().parent.parent.parent.parent.parent
    path = base_path / "shared" / "fonts.json"
    
    with open(path) as f:
        data = json.load(f)
    fonts = data["fonts"]
    family_map: dict[str, dict] = {}
    for font in fonts:
        base = font["family"].replace(" Variable", "")
        existing = family_map.get(base)
        if existing is None or (
            font.get("isVariable", False) and not existing.get("isVariable", False)
        ):
            family_map[base] = font
    return tuple(sorted(f["family"] for f in family_map.values()))


# Allowed values matching app/scene (CaptionStyleType and font options)
CAPTION_STYLES = (
    "pill",
    "karaoke-lime",
    "karaoke-magenta",
    "karaoke-cyan",
    "outlined",
    "bold-outline",
    "minimal",
    "word-highlight",
    "pink-pill",
    "dark-pill-lime",
    "cloud-blob",
)
CAPTION_FONT_FAMILIES = _load_font_families()
CAPTION_FONT_FAMILIES_STR = ", ".join(CAPTION_FONT_FAMILIES)
CAPTION_FONT_WEIGHTS = (400, 500, 700)
MIN_FONT_SIZE = 10
MAX_FONT_SIZE = 48
MIN_DISTANCE = 0
MAX_DISTANCE = 500


_SET_CAPTION_DOC = """Set the project's caption settings for audio and video clip captions.

These settings control how transcribed speech is displayed as captions on video and audio clips (pill style, font, position). Use this when the user wants to change how captions look (e.g. "use pill captions", "karaoke style", "minimal captions").

Args:
    style: Caption style. One of: pill, karaoke-lime, karaoke-magenta, karaoke-cyan, outlined, bold-outline, minimal, word-highlight, pink-pill, dark-pill-lime, cloud-blob.
    font_family: Font for captions. Available fonts include: """ + CAPTION_FONT_FAMILIES_STR + """.
    font_size: Base font size for captions (10–48). Default 18.
    font_weight: Font weight: 400, 500, or 700.
    distance_from_bottom: Pixels from bottom of frame (0–500). Default 140.

Returns:
    Status dict with updated caption settings or error message.
"""


def _setCaptionSettings_impl(
    style: str | None = None,
    font_family: str | None = None,
    font_size: int | None = None,
    font_weight: int | None = None,
    distance_from_bottom: int | None = None,
    _agent_context: dict | None = None,
) -> dict:
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")
    branch_id = context.get("branch_id")

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "User and project context required to set caption settings.",
        }

    if all(
        x is None
        for x in (style, font_family, font_size, font_weight, distance_from_bottom)
    ):
        return {
            "status": "error",
            "message": "Provide at least one of: style, font_family, font_size, font_weight, distance_from_bottom.",
        }

    if style is not None and style not in CAPTION_STYLES:
        return {
            "status": "error",
            "message": f"style must be one of: {', '.join(CAPTION_STYLES)}.",
        }
    if font_family is not None and font_family not in CAPTION_FONT_FAMILIES:
        return {
            "status": "error",
            "message": f"font_family must be one of: {', '.join(CAPTION_FONT_FAMILIES)}.",
        }
    if font_weight is not None and font_weight not in CAPTION_FONT_WEIGHTS:
        return {
            "status": "error",
            "message": f"font_weight must be one of: {', '.join(str(w) for w in CAPTION_FONT_WEIGHTS)}.",
        }
    if font_size is not None and (font_size < MIN_FONT_SIZE or font_size > MAX_FONT_SIZE):
        return {
            "status": "error",
            "message": f"font_size must be between {MIN_FONT_SIZE} and {MAX_FONT_SIZE}.",
        }
    if distance_from_bottom is not None and (
        distance_from_bottom < MIN_DISTANCE or distance_from_bottom > MAX_DISTANCE
    ):
        return {
            "status": "error",
            "message": f"distance_from_bottom must be between {MIN_DISTANCE} and {MAX_DISTANCE}.",
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

        # Merge into existing captionSettings (app defaults)
        existing = project_data.get("captionSettings") or {}
        if not isinstance(existing, dict):
            existing = {}
        caption_settings: dict[str, Any] = {
            "fontFamily": existing.get("fontFamily", "Inter Variable"),
            "fontWeight": existing.get("fontWeight", 400),
            "fontSize": existing.get("fontSize", 18),
            "distanceFromBottom": existing.get("distanceFromBottom", 140),
            "style": existing.get("style", "pill"),
        }
        if style is not None:
            caption_settings["style"] = style
        if font_family is not None:
            caption_settings["fontFamily"] = font_family
        if font_size is not None:
            caption_settings["fontSize"] = font_size
        if font_weight is not None:
            caption_settings["fontWeight"] = font_weight
        if distance_from_bottom is not None:
            caption_settings["distanceFromBottom"] = distance_from_bottom

        project_data["captionSettings"] = caption_settings

        _set_project_data(doc, project_data)
        new_state = _save_automerge_doc(doc)

        branch_ref.update({
            "automergeState": new_state,
            "commitId": str(uuid.uuid4()),
            "timestamp": int(time.time() * 1000),
        })

        logger.info(
            "[SET_CAPTION_SETTINGS] Updated caption settings for project %s: %s",
            project_id,
            caption_settings,
        )

        return {
            "status": "success",
            "message": "Caption settings updated.",
            "captionSettings": caption_settings,
        }
    except Exception as e:
        logger.exception("[SET_CAPTION_SETTINGS] %s", e)
        return {
            "status": "error",
            "message": str(e),
        }


_setCaptionSettings_impl.__doc__ = _SET_CAPTION_DOC
setCaptionSettings = tool(_setCaptionSettings_impl)
