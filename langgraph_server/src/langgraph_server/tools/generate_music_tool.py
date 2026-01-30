"""Tool to generate music using Google's Lyria model."""

from __future__ import annotations

import base64
import logging
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict
from uuid import uuid4
import json

import httpx
from google.cloud import storage
from google.oauth2 import service_account
from langchain_core.tools import tool

from ..config import Settings, get_settings

logger = logging.getLogger(__name__)

_DURATION_CHOICES = {10, 20, 30, 60}  # seconds


def _get_gcs_credentials(settings: Settings):
    """Get GCP credentials from service account key."""
    key_path = settings.firebase_service_account_key
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
    audio_bytes: bytes,
    filename: str,
    content_type: str,
    user_id: str,
    project_id: str,
    settings: Settings,
) -> dict | None:
    """Upload audio to asset service and return asset data with URL."""
    if not settings.asset_service_url:
        logger.warning("[LYRIA] Asset service URL not configured")
        return None

    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/upload"
    
    try:
        files = {"file": (filename, audio_bytes, content_type)}
        data = {"source": "lyria", "run_pipeline": "true"}
        
        response = httpx.post(endpoint, files=files, data=data, timeout=60.0)
        
        if response.status_code not in (200, 201):
            logger.error("[LYRIA] Asset service upload failed: %s - %s", response.status_code, response.text[:200])
            return None
        
        result = response.json()
        asset = result.get("asset", {})
        asset_id = asset.get("id")
        
        if not asset_id:
            logger.error("[LYRIA] Asset service did not return asset ID")
            return None
        
        # Get filename from asset for proper extension in proxy URL
        asset_filename = asset.get("fileName", "audio.mp3")
        
        # Build proxy URL for CORS-safe access (include filename for proper extension)
        proxy_url = f"/api/assets/{asset_id}/file/{asset_filename}?projectId={project_id}&userId={user_id}"
        
        logger.info("[LYRIA] Uploaded audio to asset service: asset_id=%s", asset_id)
        return {
            "assetId": asset_id,
            "proxyUrl": proxy_url,
            "gcsUri": asset.get("gcsUri"),
            "signedUrl": asset.get("signedUrl"),
        }
    except Exception as e:
        logger.exception("[LYRIA] Failed to upload to asset service: %s", e)
        return None


def _upload_audio_to_gcs(
    audio_bytes: bytes,
    object_name: str,
    content_type: str,
    settings: Settings,
) -> str | None:
    """Upload audio bytes to GCS and return the gs:// URI (fallback)."""
    credentials = _get_gcs_credentials(settings)
    if not credentials:
        logger.warning("No GCS credentials available for audio upload")
        return None

    try:
        client = storage.Client(project=settings.google_project_id, credentials=credentials)
        bucket = client.bucket(settings.google_cloud_storage_bucket)
        blob = bucket.blob(object_name)

        blob.upload_from_string(audio_bytes, content_type=content_type)
        gcs_uri = f"gs://{settings.google_cloud_storage_bucket}/{object_name}"
        logger.info("[LYRIA] Uploaded audio to %s", gcs_uri)
        return gcs_uri
    except Exception as e:
        logger.exception("[LYRIA] Failed to upload audio to GCS: %s", e)
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
        logger.warning("[LYRIA] Failed to generate signed URL: %s", e)
        return None


@tool
def generateMusic(
    prompt: str,
    duration_seconds: int = 30,
    project_id: str | None = None,
    user_id: str | None = None,
) -> dict:
    """Generate music using Google's Lyria AI model from a text prompt.

    Creates original music based on a descriptive prompt. Great for background music,
    soundtracks, jingles, and ambient audio for videos.

    IMPORTANT: When this tool succeeds, you MUST include the audioUrl in your response
    to the user so they can hear the music. For example: "Here is your music: [audioUrl]"
    If the user asks to hear the music again later, use listProjectAssets to get the URL.

    Args:
        prompt: Detailed description of the music to generate. Include genre, mood,
            instruments, tempo, and style. E.g. "upbeat electronic dance music with
            synth leads, driving bassline, 128 BPM, energetic festival vibe".
        duration_seconds: Length of the music - 10, 20, 30, or 60 seconds.
        project_id: Project ID (injected by agent).
        user_id: User ID (injected by agent).

    Returns:
        Dict with audioUrl that MUST be included in your response to the user.
    """
    from google import genai
    from google.genai import types

    settings = get_settings()

    if not user_id:
        return {
            "status": "error",
            "message": "Unable to generate music because no user context is available.",
            "reason": "missing_user",
        }

    if not prompt or len(prompt.strip()) < 5:
        return {
            "status": "error",
            "message": "Please provide a more detailed prompt (at least 5 characters).",
            "reason": "invalid_prompt",
        }

    if duration_seconds not in _DURATION_CHOICES:
        return {
            "status": "error",
            "message": f"Invalid duration_seconds '{duration_seconds}'. Choose from {sorted(_DURATION_CHOICES)}.",
            "reason": "invalid_duration",
        }

    request_id = uuid4().hex

    try:
        client = genai.Client(api_key=settings.google_api_key)
        
        # Generate music using Lyria
        response = client.models.generate_content(
            model=settings.lyria_model,
            contents=prompt.strip(),
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name="Lyria",
                        )
                    )
                ),
            ),
        )

    except Exception as exc:
        logger.exception("[LYRIA] API request failed")
        return {
            "status": "error",
            "message": f"Failed to generate music: {exc}",
            "reason": "api_error",
        }

    # Extract audio data from response
    audio_data = None
    mime_type = "audio/mp3"
    
    try:
        for part in response.candidates[0].content.parts:
            if hasattr(part, 'inline_data') and part.inline_data:
                audio_data = part.inline_data.data
                mime_type = part.inline_data.mime_type or "audio/mp3"
                break
    except (IndexError, AttributeError) as e:
        logger.error("[LYRIA] Failed to extract audio from response: %s", e)
        return {
            "status": "error",
            "message": "Lyria did not return audio data. Try a different prompt.",
            "reason": "no_audio_data",
        }

    if not audio_data:
        return {
            "status": "error",
            "message": "Lyria did not return audio data. Try a different prompt.",
            "reason": "no_audio_data",
        }

    # Decode if base64
    if isinstance(audio_data, str):
        audio_bytes = base64.b64decode(audio_data)
    else:
        audio_bytes = audio_data

    # Determine file extension
    ext = ".mp3"
    if "wav" in mime_type:
        ext = ".wav"
    elif "ogg" in mime_type:
        ext = ".ogg"
    elif "mp4" in mime_type or "m4a" in mime_type:
        ext = ".m4a"

    effective_project_id = project_id or "unknown"
    prompt_slug = prompt[:30].replace(" ", "-").lower()
    # Remove special characters from slug
    prompt_slug = "".join(c for c in prompt_slug if c.isalnum() or c == "-")
    filename = f"lyria-{prompt_slug}-{request_id[:8]}{ext}"

    # Try asset service first (provides proxy URL for CORS-safe access)
    asset_data = _upload_to_asset_service(
        audio_bytes, filename, mime_type, user_id, effective_project_id, settings
    )

    if asset_data:
        logger.info(
            "[LYRIA] Generated music: prompt=%s..., duration=%ds, asset_id=%s",
            prompt[:50],
            duration_seconds,
            asset_data["assetId"],
        )
        # Prefer signed URL for external clients (like Telegram)
        audio_url = asset_data.get("signedUrl") or asset_data["proxyUrl"]
        return {
            "status": "success",
            "message": f"Music generated successfully ({duration_seconds}s). IMPORTANT: Include this URL in your response so the user can hear the music: {audio_url}",
            "audioUrl": audio_url,
            "proxyUrl": asset_data["proxyUrl"],
            "assetId": asset_data["assetId"],
            "gcsUri": asset_data.get("gcsUri"),
            "mimeType": mime_type,
            "durationSeconds": duration_seconds,
            "prompt": prompt[:200],
        }

    # Fallback to direct GCS upload
    gcs_object_name = f"lyria/{user_id}/{effective_project_id}/{request_id}{ext}"
    gcs_uri = _upload_audio_to_gcs(audio_bytes, gcs_object_name, mime_type, settings)

    if not gcs_uri:
        return {
            "status": "error",
            "message": "Music generated but upload failed.",
            "reason": "upload_failed",
        }

    download_url = _generate_signed_url(gcs_uri, settings)
    audio_url = download_url or gcs_uri

    logger.info(
        "[LYRIA] Generated music (GCS fallback): prompt=%s..., duration=%ds, gcs=%s",
        prompt[:50],
        duration_seconds,
        gcs_uri,
    )

    return {
        "status": "success",
        "message": f"Music generated successfully ({duration_seconds}s). IMPORTANT: Include this URL in your response so the user can hear the music: {audio_url}",
        "audioUrl": audio_url,
        "gcsUri": gcs_uri,
        "mimeType": mime_type,
        "durationSeconds": duration_seconds,
        "prompt": prompt[:200],
    }
