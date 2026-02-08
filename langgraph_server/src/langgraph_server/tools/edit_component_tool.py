"""Tool to edit an existing Motion Canvas custom component asset."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

import httpx
from langchain_core.tools import tool

from ..config import get_settings
from ..hmac_auth import get_asset_service_headers
from .create_component_tool import _trial_compile

logger = logging.getLogger(__name__)


@tool
def editComponent(
    asset_id: str,
    code: Optional[str] = None,
    name: Optional[str] = None,
    component_name: Optional[str] = None,
    input_defs: Optional[List[Dict[str, Any]]] = None,
    description: Optional[str] = None,
    _agent_context: Optional[Dict[str, Any]] = None,
) -> dict:
    """Edit an existing Motion Canvas custom component asset.

    Provide only the fields you want to change. When updating code, provide
    the complete new source (not a diff).

    Args:
        asset_id: The ID of the component asset to edit.
        code: Updated Motion Canvas TSX source code (complete replacement).
        name: Updated display name.
        component_name: Updated exported class name.
        input_defs: Updated input definitions list. Each dict has keys: name, type, default, label (optional).
        description: Updated description.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "Both user_id and project_id are required to edit a component.",
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

    # Build patch body with only provided fields
    patch_body: Dict[str, Any] = {}
    if code is not None:
        patch_body["code"] = code
    if name is not None:
        patch_body["name"] = name
    if component_name is not None:
        patch_body["componentName"] = component_name
    if input_defs is not None:
        # Coerce to list (model sometimes sends JSON string)
        if isinstance(input_defs, list):
            patch_body["inputDefs"] = input_defs
        elif isinstance(input_defs, str):
            try:
                parsed = json.loads(input_defs)
                patch_body["inputDefs"] = parsed if isinstance(parsed, list) else []
            except json.JSONDecodeError:
                patch_body["inputDefs"] = []
        else:
            patch_body["inputDefs"] = []
    if description is not None:
        patch_body["description"] = description

    if not patch_body:
        return {
            "status": "error",
            "message": "No fields provided to update.",
        }

    endpoint = (
        f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/{asset_id}"
    )
    body_str = json.dumps(patch_body)

    try:
        headers = get_asset_service_headers(body_str)
        headers["Content-Type"] = "application/json"

        # Send the exact bytes we signed so asset-service HMAC verification succeeds
        response = httpx.patch(
            endpoint,
            content=body_str.encode("utf-8"),
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
            "message": f"Component asset '{asset_id}' not found.",
        }

    if response.status_code != 200:
        return {
            "status": "error",
            "message": f"Asset service returned HTTP {response.status_code}: {response.text[:200]}",
        }

    changed_fields = list(patch_body.keys())
    comp_name = component_name or "component"
    if code is not None:
        summary = f'Updated code for "{comp_name}"'
    else:
        summary = f'Updated {", ".join(changed_fields)} for "{comp_name}"'

    outputs = [
        {
            "type": "text",
            "text": summary,
        },
    ]

    # Trial compile to validate when code was changed
    if code is not None and comp_name:
        compile_error = _trial_compile(settings, user_id, project_id, comp_name, code)
        if compile_error:
            outputs.append({
                "type": "text",
                "text": (
                    f"COMPILATION ERROR: {compile_error}. "
                    "The component was saved but the code has errors that prevent it from being used. "
                    "Please call editComponent to fix the issues."
                ),
            })

    return {"status": "success", "outputs": outputs}
