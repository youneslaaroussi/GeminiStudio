"""Tool to reorder timeline layers (modifies Automerge state server-side)."""

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

logger = logging.getLogger(__name__)


@tool
def reorderLayers(
    layer_ids: list[str],
    _agent_context: dict | None = None,
) -> dict:
    """Reorder timeline layers. Use this when the user says layers are reversed or a title should be on top.

    Layer order determines what appears on top: the LAST layer in the list is drawn on top (visible above others).
    The FIRST layer in the list is at the bottom. So to put a title card on top of video, the title layer must
    come AFTER the video layer in the list. Call getTimelineState first to get current layer IDs and order.

    Args:
        layer_ids: Ordered list of layer IDs. First ID = bottom layer, last ID = top layer.
                   Only include layers you want to reorder; order of this list becomes the new timeline order.
                   Any layers not listed are appended after the given list (keeping their relative order).

    Returns:
        Status dict with new layer order or error message.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")
    branch_id = context.get("branch_id")

    logger.info(
        "[REORDER_LAYERS] Called with: layer_ids=%s, project_id=%s, user_id=%s, branch_id=%s",
        layer_ids, project_id, user_id, branch_id,
    )

    if not user_id or not project_id:
        logger.error("[REORDER_LAYERS] Missing user_id or project_id")
        return {
            "status": "error",
            "message": "User and project context required to modify timeline.",
        }

    if not layer_ids or not isinstance(layer_ids, list):
        return {
            "status": "error",
            "message": "layer_ids must be a non-empty list of layer IDs. Use getTimelineState to get current layer IDs.",
        }

    seen = set()
    ordered_ids = []
    for lid in layer_ids:
        if not isinstance(lid, str) or not lid.strip():
            continue
        lid = lid.strip()
        if lid in seen:
            continue
        seen.add(lid)
        ordered_ids.append(lid)

    if not ordered_ids:
        return {
            "status": "error",
            "message": "No valid layer IDs provided.",
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

        layers = project_data.get("layers", [])
        by_id = {l.get("id"): l for l in layers if l.get("id")}

        # New order: first the requested order, then any layers not in the list (keep relative order)
        new_layers = []
        for lid in ordered_ids:
            if lid in by_id:
                new_layers.append(by_id[lid])
        for layer in layers:
            if layer.get("id") not in seen:
                new_layers.append(layer)

        if len(new_layers) != len(layers):
            return {
                "status": "error",
                "message": "Reordering produced a different number of layers; aborting.",
            }

        project_data["layers"] = new_layers
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

        names = [l.get("name", l.get("id", "?")) for l in new_layers]
        logger.info(
            "[REORDER_LAYERS] SUCCESS: New order %s in project %s (branch %s)",
            names, project_id, use_branch_id,
        )

        return {
            "status": "success",
            "message": "Layers reordered. Top (visible above others) is last in list.",
            "layerOrder": [{"id": l.get("id"), "name": l.get("name", "Unnamed")} for l in new_layers],
        }

    except Exception as e:
        logger.exception("[REORDER_LAYERS] FAILED: %s", str(e))
        return {
            "status": "error",
            "message": f"Failed to reorder layers: {str(e)}",
        }
