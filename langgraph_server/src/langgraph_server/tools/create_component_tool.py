"""Tool to create a custom Motion Canvas component asset."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

import httpx
from langchain_core.tools import tool

from ..config import get_settings
from ..hmac_auth import get_asset_service_headers, get_scene_compiler_headers

logger = logging.getLogger(__name__)


@tool
def createComponent(
    name: str,
    code: str,
    component_name: str,
    input_defs: Optional[List[Dict[str, Any]]] = None,
    description: Optional[str] = None,
    _agent_context: Optional[Dict[str, Any]] = None,
) -> dict:
    """Create a new Motion Canvas custom component asset with TSX source code.

    The component will be compiled server-side and available for use on the timeline.
    Write valid Motion Canvas TSX code that extends a Node (e.g. Layout, Rect, Circle).

    Args:
        name: Display name for the component asset (e.g. "Progress Ring").
        code: Complete Motion Canvas TSX source code for the component.
        component_name: The exported class name (e.g. "ProgressRing"). Must be a valid JS identifier.
        input_defs: Optional list of input definitions. Each dict has keys: name (str), type ("string"|"number"|"boolean"|"color"), default (str|number|bool), label (optional str).
        description: Optional short description of what the component does.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")

    if not user_id or not project_id:
        return {
            "status": "error",
            "message": "Both user_id and project_id are required to create a component.",
        }

    settings = get_settings()
    if not settings.asset_service_url:
        return {
            "status": "error",
            "message": "Asset service URL not configured.",
        }

    # 1. Create the component asset
    create_endpoint = (
        f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/component"
    )
    create_body: Dict[str, Any] = {
        "name": name,
        "code": code,
        "componentName": component_name,
        "inputDefs": input_defs or [],
    }
    body_str = json.dumps(create_body)

    try:
        headers = get_asset_service_headers(body_str)
        headers["Content-Type"] = "application/json"

        response = httpx.post(
            create_endpoint,
            json=create_body,
            headers=headers,
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        logger.warning("Failed to contact asset service: %s", exc)
        return {
            "status": "error",
            "message": f"Could not reach asset service: {exc}",
        }

    if response.status_code not in (200, 201):
        return {
            "status": "error",
            "message": f"Asset service returned HTTP {response.status_code}: {response.text[:200]}",
        }

    try:
        asset_data = response.json()
    except Exception:
        asset_data = {}

    asset_id = asset_data.get("id", "unknown")

    # 2. Set description if provided
    if description:
        patch_endpoint = (
            f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/{asset_id}"
        )
        patch_body = {"description": description}
        patch_str = json.dumps(patch_body)
        try:
            patch_headers = get_asset_service_headers(patch_str)
            patch_headers["Content-Type"] = "application/json"
            httpx.patch(
                patch_endpoint,
                json=patch_body,
                headers=patch_headers,
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            logger.warning("Failed to set description: %s", exc)

    input_count = len(input_defs) if input_defs else 0
    summary = f'Created component "{component_name}"'
    if input_count > 0:
        summary += f" with {input_count} input{'s' if input_count > 1 else ''}"

    outputs = [
        {
            "type": "text",
            "text": f"{summary}. Asset ID: {asset_id}",
        },
    ]

    # 3. Trial compile to validate the component code
    compile_error = _trial_compile(settings, user_id, project_id, component_name, code)
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


def _trial_compile(
    settings: object,
    user_id: str,
    project_id: str,
    component_name: str,
    code: str,
) -> str | None:
    """Trial-compile the scene with the given component to validate code.

    Fetches all existing component assets, builds file overrides including the
    new/updated code, and calls the scene compiler. Returns the error message
    on failure, or None on success.
    """
    if not getattr(settings, "scene_compiler_url", None):
        return None

    # Fetch all component assets from the asset service
    files: Dict[str, str] = {}
    try:
        list_endpoint = (
            f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}"  # type: ignore[union-attr]
        )
        list_headers = get_asset_service_headers("")
        list_resp = httpx.get(list_endpoint, headers=list_headers, timeout=10.0)
        if list_resp.status_code == 200:
            all_assets = list_resp.json().get("assets", [])
            for a in all_assets:
                if a.get("type") == "component" and a.get("componentName") and a.get("code"):
                    files[f"src/components/custom/{a['componentName']}.tsx"] = a["code"]
    except Exception as exc:
        logger.debug("Could not fetch assets for trial compile: %s", exc)

    # Override with the just-saved component
    files[f"src/components/custom/{component_name}.tsx"] = code

    compile_body = json.dumps({"files": files})
    try:
        compile_headers = get_scene_compiler_headers(compile_body)
        compile_resp = httpx.post(
            f"{settings.scene_compiler_url.rstrip('/')}/compile",  # type: ignore[union-attr]
            content=compile_body,
            headers=compile_headers,
            timeout=30.0,
        )
        if compile_resp.status_code != 200:
            try:
                err_data = compile_resp.json()
                return err_data.get("error", compile_resp.text[:300])
            except Exception:
                return compile_resp.text[:300]
    except Exception as exc:
        logger.debug("Scene compiler unavailable for trial compile: %s", exc)

    return None
