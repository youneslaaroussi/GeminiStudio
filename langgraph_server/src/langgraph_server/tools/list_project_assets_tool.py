"""Tool to list assets from the project's asset library (via asset-service)."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import httpx
from langchain_core.tools import tool

from ..config import get_settings
from ..hmac_auth import get_asset_service_headers

logger = logging.getLogger(__name__)


@tool
def listProjectAssets(
    _agent_context: Optional[Dict[str, Any]] = None,
) -> dict:
    """Return the uploaded assets in the project's media library.

    This fetches from the asset-service (project-level storage), not the timeline.
    Assets here are available to be added to the timeline but may not yet be placed.
    Branch does not apply — asset library is shared across all branches.

    Use this tool when:
    - User asks to see or show an image/video/asset again
    - User asks "what assets do I have" or similar
    - You need to find a signedUrl to display media to the user

    The response includes signedUrl for each asset which you should include in your
    response if the user wants to see the media.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "Both user_id and project_id are required to list project assets.",
        }

    settings = get_settings()
    if not settings.asset_service_url:
        return {
            "status": "error",
            "message": "Asset service URL not configured.",
        }

    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}"

    try:
        # Sign request for asset service authentication
        headers = get_asset_service_headers("")
        response = httpx.get(endpoint, headers=headers, timeout=15.0)
    except httpx.HTTPError as exc:
        logger.warning("Failed to contact asset service: %s", exc)
        return {
            "status": "error",
            "message": f"Could not reach asset service: {exc}",
        }

    if response.status_code != 200:
        return {
            "status": "error",
            "message": f"Asset service returned HTTP {response.status_code}: {response.text[:200]}",
        }

    try:
        assets = response.json()
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Invalid response from asset service: {exc}",
        }

    if not isinstance(assets, list):
        assets = []

    # Build human-readable summary
    if assets:
        items = []
        for a in assets:
            name = a.get("name", "Untitled")
            asset_type = a.get("type", "unknown")
            duration = a.get("duration")
            size_bytes = a.get("size", 0)
            size_mb = round(size_bytes / (1024 * 1024), 2) if size_bytes else 0
            description = a.get("description", "")

            if asset_type == "component":
                comp_name = a.get("componentName", "")
                input_defs = a.get("inputDefs", [])
                input_count = len(input_defs) if isinstance(input_defs, list) else 0
                parts = [name, "COMPONENT"]
                if comp_name:
                    parts.append(f"class: {comp_name}")
                if input_count > 0:
                    parts.append(f"{input_count} input{'s' if input_count > 1 else ''}")
                if description:
                    parts.append(description)
                desc = " • ".join(parts)
            elif duration:
                desc = f"{name} ({asset_type}, {duration:.1f}s, {size_mb}MB)"
                if description:
                    desc += f" — {description}"
            else:
                desc = f"{name} ({asset_type}, {size_mb}MB)"
                if description:
                    desc += f" — {description}"
            items.append({"type": "text", "text": desc})

        title = f"{len(assets)} asset{'s' if len(assets) != 1 else ''} in library"
    else:
        items = [{"type": "text", "text": "No assets uploaded yet."}]
        title = "0 assets"

    # Simplify asset data for agent context
    simplified = []
    for a in assets:
        entry: dict = {
            "id": a.get("id"),
            "name": a.get("name"),
            "type": a.get("type"),
            "mimeType": a.get("mimeType"),
            "duration": a.get("duration"),
            "width": a.get("width"),
            "height": a.get("height"),
            "signedUrl": a.get("signedUrl"),
            "notes": a.get("notes"),
            "description": a.get("description"),
        }
        # Include component-specific fields
        if a.get("type") == "component":
            entry["componentName"] = a.get("componentName")
            input_defs = a.get("inputDefs", [])
            entry["inputDefCount"] = len(input_defs) if isinstance(input_defs, list) else 0
            raw_code = a.get("code", "")
            entry["codePreview"] = (raw_code[:200] + "...") if len(raw_code) > 200 else raw_code
        simplified.append(entry)

    return {
        "status": "success",
        "outputs": [
            {"type": "list", "title": title, "items": items},
            {"type": "json", "data": simplified},
        ],
    }
