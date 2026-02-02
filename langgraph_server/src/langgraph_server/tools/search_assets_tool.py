"""Tool to search assets in the project's asset library."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import httpx
from langchain_core.tools import tool

from ..config import get_settings
from ..hmac_auth import get_asset_service_headers

logger = logging.getLogger(__name__)


@tool
def searchAssets(
    query: str,
    asset_type: str | None = None,
    limit: int = 10,
    _agent_context: Optional[Dict[str, Any]] = None,
) -> dict:
    """Search for assets in the project's media library by content.

    This searches across:
    - Filename
    - AI-generated descriptions
    - Gemini analysis text
    - Transcribed speech/dialogue
    - Detected labels and entities

    Use this tool when:
    - User asks to "find" or "search" for specific content
    - User asks "do I have any videos of X"
    - User asks "find the clip where someone says X"
    - User wants to locate assets by description, not by name
    - You need to find assets matching certain criteria

    Args:
        query: Search query - can be natural language like "sunset beach" or "person talking"
        asset_type: Optional filter - "video", "audio", "image", or "other"
        limit: Maximum number of results to return (default 10)

    Returns:
        Search results with matching assets and highlighted snippets
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "Both user_id and project_id are required to search assets.",
        }

    if not query or not query.strip():
        return {
            "status": "error",
            "message": "A search query is required.",
        }

    settings = get_settings()
    if not settings.asset_service_url:
        return {
            "status": "error",
            "message": "Asset service URL not configured.",
        }

    # Build search endpoint URL
    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/search/{user_id}/{project_id}/search"

    # Build request body
    body = {
        "query": query.strip(),
        "limit": min(limit, 50),  # Cap at 50
    }
    if asset_type:
        body["type"] = asset_type

    try:
        import json
        body_str = json.dumps(body)
        headers = get_asset_service_headers(body_str)
        headers["Content-Type"] = "application/json"
        
        response = httpx.post(
            endpoint,
            content=body_str,
            headers=headers,
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        logger.warning("Failed to contact asset service for search: %s", exc)
        return {
            "status": "error",
            "message": f"Could not reach asset service: {exc}",
        }

    if response.status_code == 503:
        return {
            "status": "error",
            "message": "Search is not configured. Algolia needs to be set up.",
        }

    if response.status_code != 200:
        return {
            "status": "error",
            "message": f"Search failed with HTTP {response.status_code}: {response.text[:200]}",
        }

    try:
        result = response.json()
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Invalid response from search service: {exc}",
        }

    hits = result.get("hits", [])
    total = result.get("total", 0)
    processing_time = result.get("processingTimeMs", 0)

    if not hits:
        return {
            "status": "success",
            "outputs": [
                {
                    "type": "text",
                    "text": f"No assets found matching '{query}'",
                },
            ],
            "searchResults": {
                "query": query,
                "total": 0,
                "hits": [],
            },
        }

    # Build human-readable summary
    items = []
    for hit in hits:
        name = hit.get("name", "Untitled")
        asset_type_str = hit.get("type", "unknown")
        duration = hit.get("duration")
        description = hit.get("description", "")

        # Build description with highlights if available
        highlights = hit.get("highlights", {})
        snippet = highlights.get("description") or highlights.get("searchableText") or description
        if snippet and len(snippet) > 150:
            snippet = snippet[:150] + "..."

        if duration:
            desc = f"**{name}** ({asset_type_str}, {duration:.1f}s)"
        else:
            desc = f"**{name}** ({asset_type_str})"

        if snippet:
            desc += f"\n  _{snippet}_"

        items.append({"type": "text", "text": desc})

    title = f"Found {total} asset{'s' if total != 1 else ''} matching '{query}'"

    # Simplified data for agent context
    simplified = [
        {
            "id": hit.get("id"),
            "name": hit.get("name"),
            "type": hit.get("type"),
            "duration": hit.get("duration"),
            "description": hit.get("description"),
            "labels": hit.get("labels", [])[:10],  # Limit labels
        }
        for hit in hits
    ]

    return {
        "status": "success",
        "outputs": [
            {"type": "list", "title": title, "items": items},
            {"type": "json", "data": simplified},
        ],
        "searchResults": {
            "query": query,
            "total": total,
            "processingTimeMs": processing_time,
            "hits": simplified,
        },
    }
