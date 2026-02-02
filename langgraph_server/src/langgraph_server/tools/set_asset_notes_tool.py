"""Tool to set or update user notes on an asset."""

from __future__ import annotations

import json
import logging

import httpx
from langchain_core.tools import tool

from ..config import get_settings
from ..hmac_auth import get_asset_service_headers

logger = logging.getLogger(__name__)


@tool
def setAssetNotes(
    asset_id: str,
    notes: str,
    user_id: str | None = None,
    project_id: str | None = None,
) -> dict:
    """Set or update notes on an asset. Use this to remember what an asset is for (e.g. "B-roll for intro", "voiceover take 2").

    Args:
        asset_id: The ID of the asset to update.
        notes: The notes text to set. Use empty string to clear notes.
        user_id: The user ID (injected by agent context).
        project_id: The project ID (injected by agent context).
    """

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "Both user_id and project_id are required to set asset notes.",
        }

    if not asset_id:
        return {
            "status": "error",
            "message": "asset_id is required.",
        }

    settings = get_settings()
    if not settings.asset_service_url:
        return {
            "status": "error",
            "message": "Asset service URL not configured.",
        }

    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/{asset_id}"
    body = {"notes": notes if notes else None}
    body_str = json.dumps(body)

    try:
        headers = get_asset_service_headers(body_str)
        headers["Content-Type"] = "application/json"

        response = httpx.patch(
            endpoint,
            json=body,
            headers=headers,
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        logger.warning("Failed to contact asset service: %s", exc)
        return {
            "status": "error",
            "message": f"Could not reach asset service: {exc}",
        }

    if response.status_code == 404:
        return {
            "status": "error",
            "message": f"Asset '{asset_id}' not found.",
        }

    if response.status_code != 200:
        return {
            "status": "error",
            "message": f"Asset service returned HTTP {response.status_code}: {response.text[:200]}",
        }

    return {
        "status": "success",
        "outputs": [
            {
                "type": "text",
                "text": f"Notes updated for asset '{asset_id}'." + (" Notes cleared." if not notes else ""),
            },
        ],
    }
