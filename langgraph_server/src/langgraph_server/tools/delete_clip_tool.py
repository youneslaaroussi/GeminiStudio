"""Tool to delete clips from the timeline (modifies Automerge state server-side)."""

from __future__ import annotations

import logging
import uuid

from langchain_core.tools import tool

from ..config import get_settings
from ..firebase import get_firestore_client

from .add_clip_tool import (
    _get_project_data,
    _load_automerge_doc,
    _save_automerge_doc,
    _set_project_data,
)

logger = logging.getLogger(__name__)


@tool
def deleteClipFromTimeline(
    clip_ids: list[str],
    project_id: str | None = None,
    user_id: str | None = None,
    branch_id: str | None = None,
) -> dict:
    """Delete one or more clips from the project timeline by clip ID.

    Use getProjectSummary or list clips to discover clip IDs before deleting.
    Clips are identified by their "id" field (e.g. "clip-abc12345").

    Args:
        clip_ids: List of clip IDs to delete (e.g. ["clip-abc12345", "clip-def67890"])
        project_id: Project ID (injected by agent)
        user_id: User ID (injected by agent)
        branch_id: Branch ID (injected by agent, defaults to "main")

    Returns:
        Status dict with deleted clip info or error message.
    """
    logger.info(
        "[DELETE_CLIP] Called with: clip_ids=%s, project_id=%s, user_id=%s, branch_id=%s",
        clip_ids, project_id, user_id, branch_id,
    )

    if not user_id or not project_id:
        logger.error("[DELETE_CLIP] Missing user_id or project_id")
        return {
            "status": "error",
            "message": "User and project context required to modify timeline.",
        }

    if not clip_ids or not isinstance(clip_ids, list):
        return {
            "status": "error",
            "message": "At least one clip_id is required. Pass a list, e.g. [\"clip-abc12345\"].",
        }

    to_delete = {cid.strip() for cid in clip_ids if cid and isinstance(cid, str) and cid.strip()}
    if not to_delete:
        return {
            "status": "error",
            "message": "No valid clip IDs provided.",
        }

    settings = get_settings()
    db = get_firestore_client(settings)

    use_branch_id = branch_id or "main"
    logger.info("[DELETE_CLIP] Using branch: %s", use_branch_id)

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
            logger.error("[DELETE_CLIP] Branch not found: %s", use_branch_id)
            return {
                "status": "error",
                "message": f"Branch '{use_branch_id}' not found for project.",
            }

        branch_data = branch_doc.to_dict()
        automerge_state = branch_data.get("automergeState")

        if not automerge_state:
            logger.error("[DELETE_CLIP] No automergeState in branch")
            return {
                "status": "error",
                "message": "Project has no timeline data yet.",
            }

        doc = _load_automerge_doc(automerge_state)
        project_data = _get_project_data(doc)

        if not project_data:
            logger.error("[DELETE_CLIP] Could not parse project timeline data")
            return {
                "status": "error",
                "message": "Could not parse project timeline data.",
            }

        layers = project_data.get("layers", [])
        deleted: list[dict] = []
        not_found: set[str] = set(to_delete)

        for layer in layers:
            clips = layer.get("clips", [])
            if not clips:
                continue
            new_clips = []
            for c in clips:
                cid = c.get("id")
                if cid in to_delete:
                    deleted.append({
                        "id": cid,
                        "name": c.get("name", "Unnamed"),
                        "type": c.get("type", "unknown"),
                        "layerId": layer.get("id"),
                    })
                    not_found.discard(cid)
                else:
                    new_clips.append(c)
            layer["clips"] = new_clips

        if not deleted:
            return {
                "status": "error",
                "message": f"No clips found with the given IDs: {list(to_delete)}. "
                           "Use getProjectSummary or list clips to get valid clip IDs.",
            }

        _set_project_data(doc, project_data)
        new_state = _save_automerge_doc(doc)

        branch_ref.update({
            "automergeState": new_state,
            "commitId": str(uuid.uuid4()),
        })

        msg_extra = ""
        if not_found:
            msg_extra = f" ({len(not_found)} requested ID(s) not found: {sorted(not_found)})"

        logger.info(
            "[DELETE_CLIP] SUCCESS: Deleted %d clip(s) from project %s (branch %s)%s",
            len(deleted), project_id, use_branch_id, msg_extra,
        )

        return {
            "status": "success",
            "message": f"Deleted {len(deleted)} clip(s): {[d['id'] for d in deleted]}.{msg_extra}",
            "deleted": deleted,
        }

    except Exception as e:
        logger.exception("[DELETE_CLIP] FAILED: %s", str(e))
        return {
            "status": "error",
            "message": f"Failed to delete clips: {str(e)}",
        }


