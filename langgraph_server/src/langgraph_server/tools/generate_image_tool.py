"""Tool to generate images using Google's Gemini image generation (Banana)."""

from __future__ import annotations

import base64
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict
from uuid import uuid4
import json

import httpx
from google.cloud import storage
from google.oauth2 import service_account
from langchain_core.tools import tool

from ..api_key_provider import get_current_key, keys_count, reset_key_index_to_zero, rotate_next_key
from ..config import Settings, get_settings
from ..credits import deduct_credits, get_credits_for_action, InsufficientCreditsError
from ..hmac_auth import get_asset_service_upload_headers

logger = logging.getLogger(__name__)

_ASPECT_RATIO_CHOICES = {"1:1", "16:9", "9:16", "4:3", "3:4"}
_SIZE_CHOICES = {"1K", "2K", "4K"}


def _get_gcs_credentials(settings: Settings):
    """Get GCP credentials from the Google service account key."""
    key_path = settings.google_service_account_key
    if not key_path:
        return None

    path = Path(key_path).expanduser()
    if path.exists():
        return service_account.Credentials.from_service_account_file(str(path))

    try:
        key_data = json.loads(key_path)
        return service_account.Credentials.from_service_account_info(key_data)
    except json.JSONDecodeError:
        return None


def _upload_to_asset_service(
    image_bytes: bytes,
    filename: str,
    content_type: str,
    user_id: str,
    project_id: str,
    settings: Settings,
) -> dict | None:
    """Upload image to asset service and return asset data with signed URL."""
    if not settings.asset_service_url:
        logger.warning("[BANANA] Asset service URL not configured")
        return None

    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/upload"
    
    try:
        files = {"file": (filename, image_bytes, content_type)}
        data = {"source": "banana", "run_pipeline": "true"}
        
        # Sign request for asset service authentication with file hash
        headers = get_asset_service_upload_headers(image_bytes)
        response = httpx.post(endpoint, files=files, data=data, headers=headers, timeout=60.0)
        
        if response.status_code not in (200, 201):
            logger.error("[BANANA] Asset service upload failed: %s - %s", response.status_code, response.text[:200])
            return None
        
        result = response.json()
        asset = result.get("asset", {})
        asset_id = asset.get("id")
        
        if not asset_id:
            logger.error("[BANANA] Asset service did not return asset ID")
            return None

        logger.info("[BANANA] Uploaded image to asset service: asset_id=%s", asset_id)
        return {
            "assetId": asset_id,
            "gcsUri": asset.get("gcsUri"),
            "signedUrl": asset.get("signedUrl"),
        }
    except Exception as e:
        logger.exception("[BANANA] Failed to upload to asset service: %s", e)
        return None


def _upload_image_to_gcs(
    image_bytes: bytes,
    object_name: str,
    content_type: str,
    settings: Settings,
) -> str | None:
    """Upload image bytes to GCS and return the gs:// URI (fallback)."""
    credentials = _get_gcs_credentials(settings)
    if not credentials:
        logger.warning("No GCS credentials available for image upload")
        return None

    try:
        client = storage.Client(project=settings.google_project_id, credentials=credentials)
        bucket = client.bucket(settings.google_cloud_storage_bucket)
        blob = bucket.blob(object_name)

        blob.upload_from_string(image_bytes, content_type=content_type)
        gcs_uri = f"gs://{settings.google_cloud_storage_bucket}/{object_name}"
        logger.info("[BANANA] Uploaded image to %s", gcs_uri)
        return gcs_uri
    except Exception as e:
        logger.exception("[BANANA] Failed to upload image to GCS: %s", e)
        return None


def _generate_signed_url(
    gcs_uri: str,
    settings: Settings,
    expires_in_seconds: int = 604800,
) -> str | None:
    """Generate a signed download URL from a gs:// URI. Default expiry is 7 days."""
    if not gcs_uri.startswith("gs://"):
        return None

    parts = gcs_uri[5:].split("/", 1)
    if len(parts) != 2:
        return None

    bucket_name, object_name = parts
    credentials = _get_gcs_credentials(settings)
    if not credentials:
        return None

    try:
        client = storage.Client(project=settings.google_project_id, credentials=credentials)
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(object_name)

        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(seconds=expires_in_seconds),
            method="GET",
        )
        return url
    except Exception as e:
        logger.warning("[BANANA] Failed to generate signed URL: %s", e)
        return None


@tool
def generateImage(
    prompt: str,
    aspect_ratio: str = "1:1",
    image_size: str = "1K",
    _agent_context: dict | None = None,
) -> dict:
    """Generate an image using Google's Gemini image model (Banana).

    This is a synchronous operation - the image is generated and returned immediately.

    IMPORTANT: When this tool succeeds, you MUST include the imageUrl in your response
    to the user so they can see the image. For example: "Here is your image: [imageUrl]"
    If the user asks to see the image again later, use listProjectAssets to get the URL.

    Args:
        prompt: Detailed description of the image to generate.
        aspect_ratio: Image aspect ratio - "1:1", "16:9", "9:16", "4:3", or "3:4".
        image_size: Output size - "1K", "2K", or "4K".

    Returns:
        Dict with imageUrl that MUST be included in your response to the user.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")

    settings = get_settings()

    if not user_id:
        return {
            "status": "error",
            "message": "Unable to generate image because no user context is available.",
            "reason": "missing_user",
        }

    if not prompt or len(prompt.strip()) < 3:
        return {
            "status": "error",
            "message": "Please provide a more detailed prompt (at least 3 characters).",
            "reason": "invalid_prompt",
        }

    if aspect_ratio not in _ASPECT_RATIO_CHOICES:
        return {
            "status": "error",
            "message": f"Invalid aspect_ratio '{aspect_ratio}'. Choose from {sorted(_ASPECT_RATIO_CHOICES)}.",
            "reason": "invalid_aspect_ratio",
        }

    if image_size not in _SIZE_CHOICES:
        return {
            "status": "error",
            "message": f"Invalid image_size '{image_size}'. Choose from {sorted(_SIZE_CHOICES)}.",
            "reason": "invalid_size",
        }

    # Deduct credits before generation
    cost = get_credits_for_action("image_generation")
    try:
        deduct_credits(user_id, cost, "image_generation", settings)
    except InsufficientCreditsError as e:
        logger.warning("[BANANA] Insufficient credits for user %s", user_id)
        return {
            "status": "error",
            "message": f"Insufficient credits. You need {e.required} R‑Credits for image generation. Add credits in Gemini Studio Settings to continue.",
            "reason": "insufficient_credits",
            "required": e.required,
            "current": e.current,
        }

    request_id = uuid4().hex

    request_body = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt.strip()}],
            }
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
                "imageSize": image_size,
            },
        },
    }

    n_keys = max(1, keys_count())
    banana_model_ids = settings.banana_model_ids
    last_status: int | None = None
    last_error_text: str = ""
    response: httpx.Response | None = None
    for model_id in banana_model_ids:
        for _ in range(n_keys):
            api_key = get_current_key()
            if not api_key:
                return {
                    "status": "error",
                    "message": "Gemini API key not configured.",
                    "reason": "api_error",
                }
            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={api_key}"
            try:
                response = httpx.post(api_url, json=request_body, timeout=120.0)
            except httpx.HTTPError as exc:
                logger.exception("[BANANA] API request failed")
                return {
                    "status": "error",
                    "message": f"Failed to contact Gemini API: {exc}",
                    "reason": "api_error",
                }

            if response.status_code == 200:
                break
            last_status = response.status_code
            last_error_text = response.text[:200]
            if response.status_code == 429 and keys_count() > 1:
                logger.warning("[BANANA] 429 quota exceeded, rotating to next API key")
                rotate_next_key()
                continue
            logger.error("[BANANA] API error: %s - %s", response.status_code, last_error_text)
            return {
                "status": "error",
                "message": f"Gemini API error (HTTP {response.status_code}): {last_error_text}",
                "reason": "api_error",
            }
        else:
            continue
        break
    else:
        reset_key_index_to_zero()
        return {
            "status": "error",
            "message": f"Gemini API error (HTTP {last_status}): {last_error_text}",
            "reason": "api_error",
        }

    assert response is not None
    try:
        payload = response.json()
    except Exception:
        return {
            "status": "error",
            "message": "Failed to parse Gemini API response.",
            "reason": "parse_error",
        }

    # Extract image data
    inline_data = None
    candidates = payload.get("candidates", [])
    for candidate in candidates:
        parts = candidate.get("content", {}).get("parts", [])
        for part in parts:
            if part.get("inlineData", {}).get("data"):
                inline_data = part["inlineData"]
                break
        if inline_data:
            break

    if not inline_data or not inline_data.get("data"):
        return {
            "status": "error",
            "message": "Gemini did not return image data. Try a different prompt.",
            "reason": "no_image_data",
        }

    # Decode and upload
    mime_type = inline_data.get("mimeType", "image/png")
    image_bytes = base64.b64decode(inline_data["data"])

    ext = ".png"
    if mime_type == "image/jpeg":
        ext = ".jpg"
    elif mime_type == "image/webp":
        ext = ".webp"

    effective_project_id = project_id or "unknown"
    prompt_slug = prompt[:30].replace(" ", "-").lower()
    filename = f"banana-{prompt_slug}-{request_id[:8]}{ext}"

    # Try asset service first (returns signed URL for direct access)
    asset_data = _upload_to_asset_service(
        image_bytes, filename, mime_type, user_id, effective_project_id, settings
    )

    if asset_data:
        logger.info(
            "[BANANA] Generated image: prompt=%s..., aspect=%s, size=%s, asset_id=%s",
            prompt[:50],
            aspect_ratio,
            image_size,
            asset_data["assetId"],
        )
        image_url = asset_data.get("signedUrl")
        return {
            "status": "success",
            "message": f"Image generated successfully. IMPORTANT: Include this URL in your response so the user can see the image: {image_url}",
            "imageUrl": image_url,
            "assetId": asset_data["assetId"],
            "gcsUri": asset_data.get("gcsUri"),
            "mimeType": mime_type,
            "prompt": prompt[:200],
        }

    # Fallback to direct GCS upload
    gcs_object_name = f"banana/{user_id}/{effective_project_id}/{request_id}{ext}"
    gcs_uri = _upload_image_to_gcs(image_bytes, gcs_object_name, mime_type, settings)

    if not gcs_uri:
        # Return base64 as fallback
        return {
            "status": "success",
            "message": "Image generated but cloud upload failed. Returning base64 data.",
            "imageData": inline_data["data"],
            "mimeType": mime_type,
        }

    download_url = _generate_signed_url(gcs_uri, settings)
    image_url = download_url or gcs_uri

    logger.info(
        "[BANANA] Generated image (GCS fallback): prompt=%s..., aspect=%s, size=%s, gcs=%s",
        prompt[:50],
        aspect_ratio,
        image_size,
        gcs_uri,
    )

    return {
        "status": "success",
        "message": f"Image generated successfully. IMPORTANT: Include this URL in your response so the user can see the image: {image_url}",
        "imageUrl": image_url,
        "gcsUri": gcs_uri,
        "mimeType": mime_type,
        "prompt": prompt[:200],
    }
