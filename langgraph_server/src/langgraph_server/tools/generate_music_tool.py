"""Tool to generate music using Google's Lyria model."""

from __future__ import annotations

import base64
import io
import logging
import wave
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
from ..credits import deduct_credits, get_credits_for_action, InsufficientCreditsError
from ..hmac_auth import get_asset_service_upload_headers

logger = logging.getLogger(__name__)


def _pcm_to_wav(pcm_data: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    """Convert raw PCM data to WAV format by adding headers."""
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_data)
    return buffer.getvalue()


def _pcm_to_mp3(pcm_data: bytes, sample_rate: int = 24000, channels: int = 1) -> bytes:
    """Convert raw PCM data to MP3 format using ffmpeg.
    
    Telegram's sendAudio only supports MP3 and M4A, not WAV.
    """
    import subprocess
    import tempfile
    import os
    
    # Create temp files for input WAV and output MP3
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as wav_file:
        wav_path = wav_file.name
        wav_bytes = _pcm_to_wav(pcm_data, sample_rate, channels)
        wav_file.write(wav_bytes)
    
    mp3_path = wav_path.replace('.wav', '.mp3')
    
    try:
        result = subprocess.run(
            [
                'ffmpeg', '-y',
                '-i', wav_path,
                '-codec:a', 'libmp3lame',
                '-qscale:a', '2',
                mp3_path
            ],
            capture_output=True,
            timeout=60,  # Longer timeout for music (up to 60s of audio)
        )
        
        if result.returncode != 0:
            logger.error("[LYRIA] ffmpeg conversion failed: %s", result.stderr.decode()[:500])
            return wav_bytes
        
        with open(mp3_path, 'rb') as f:
            mp3_bytes = f.read()
        
        logger.info("[LYRIA] Converted to MP3: %d bytes", len(mp3_bytes))
        return mp3_bytes
        
    except subprocess.TimeoutExpired:
        logger.error("[LYRIA] ffmpeg conversion timed out")
        return _pcm_to_wav(pcm_data, sample_rate, channels)
    except FileNotFoundError:
        logger.warning("[LYRIA] ffmpeg not found, falling back to WAV")
        return _pcm_to_wav(pcm_data, sample_rate, channels)
    finally:
        for path in [wav_path, mp3_path]:
            try:
                os.unlink(path)
            except OSError:
                pass


def _wav_to_mp3(wav_data: bytes) -> bytes:
    """Convert WAV bytes to MP3 using ffmpeg. Telegram sendAudio supports MP3/M4A, not WAV."""
    import subprocess
    import tempfile
    import os

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as wav_file:
        wav_path = wav_file.name
        wav_file.write(wav_data)

    mp3_path = wav_path.replace(".wav", ".mp3")
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", wav_path,
                "-codec:a", "libmp3lame",
                "-qscale:a", "2",
                mp3_path,
            ],
            capture_output=True,
            timeout=60,
        )
        if result.returncode != 0:
            logger.error("[LYRIA] ffmpeg WAV->MP3 failed: %s", result.stderr.decode()[:500])
            return wav_data
        with open(mp3_path, "rb") as f:
            return f.read()
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        logger.warning("[LYRIA] ffmpeg WAV->MP3 failed: %s, keeping WAV", e)
        return wav_data
    finally:
        for path in [wav_path, mp3_path]:
            try:
                os.unlink(path)
            except OSError:
                pass


_DURATION_CHOICES = {10, 20, 30, 60}  # seconds (Vertex Lyria returns ~30s clips; duration is informational)


def _get_gcp_key_path(settings: Settings) -> str | None:
    """Resolve GCP service account key path (for Vertex, GCS, etc.). Never use Firebase key."""
    key = (
        getattr(settings, "google_service_account_key", None)
        or getattr(settings, "google_application_credentials", None)
    )
    return key if key and str(key).strip() else None


def _get_gcs_credentials(settings: Settings):
    """Get GCP credentials from service account key (GCP key only, not Firebase)."""
    key_path = _get_gcp_key_path(settings)
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


# Vertex AI (Lyria) requires cloud-platform scope when minting the access token (same as app Lyria).
_VERTEX_SCOPE = ["https://www.googleapis.com/auth/cloud-platform"]


def _get_credentials_from_key(key_value: str | None) -> service_account.Credentials | None:
    """Load service account credentials from a file path or JSON string."""
    if not key_value or not key_value.strip():
        return None
    key_value = key_value.strip()
    path = Path(key_value).expanduser()
    if path.exists():
        return service_account.Credentials.from_service_account_file(str(path))
    try:
        key_data = json.loads(key_value)
        return service_account.Credentials.from_service_account_info(key_data)
    except json.JSONDecodeError:
        return None


def _get_vertex_access_token(settings: Settings) -> str | None:
    """Get an access token for Vertex AI with cloud-platform scope. Uses GCP service account only (GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS). Never uses Firebase key."""
    key_value = _get_gcp_key_path(settings)
    creds = _get_credentials_from_key(key_value) if key_value else None
    if not creds:
        return None
    creds = creds.with_scopes(_VERTEX_SCOPE)
    from google.auth.transport.requests import Request
    creds.refresh(Request())
    return creds.token


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
        
        # Sign request for asset service authentication with file hash
        headers = get_asset_service_upload_headers(audio_bytes)
        response = httpx.post(endpoint, files=files, data=data, headers=headers, timeout=60.0)
        
        if response.status_code not in (200, 201):
            logger.error("[LYRIA] Asset service upload failed: %s - %s", response.status_code, response.text[:200])
            return None
        
        result = response.json()
        asset = result.get("asset", {})
        asset_id = asset.get("id")
        
        if not asset_id:
            logger.error("[LYRIA] Asset service did not return asset ID")
            return None

        logger.info("[LYRIA] Uploaded audio to asset service: asset_id=%s", asset_id)
        return {
            "assetId": asset_id,
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
    _agent_context: dict | None = None,
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

    Returns:
        Dict with audioUrl that MUST be included in your response to the user.
    """
    context = _agent_context or {}
    user_id = context.get("user_id")
    project_id = context.get("project_id")

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

    # Deduct credits before generation
    cost = get_credits_for_action("lyria_generation")
    try:
        deduct_credits(user_id, cost, "lyria_generation", settings)
    except InsufficientCreditsError as e:
        logger.warning("[LYRIA] Insufficient credits for user %s", user_id)
        return {
            "status": "error",
            "message": f"Insufficient credits. You need {e.required} R‑Credits for music generation. Add credits in Gemini Studio Settings to continue.",
            "reason": "insufficient_credits",
            "required": e.required,
            "current": e.current,
        }

    request_id = uuid4().hex

    # Lyria is only available on Vertex AI (predict endpoint), not Gemini generateContent
    token = _get_vertex_access_token(settings)
    if not token:
        logger.warning("[LYRIA] No Vertex AI credentials (GCP service account)")
        return {
            "status": "error",
            "message": "Music generation requires a GCP service account with Vertex AI access. Set GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS to your GCP service account JSON (not the Firebase key).",
            "reason": "missing_credentials",
        }

    location = getattr(settings, "lyria_location", None) or "us-central1"
    model = getattr(settings, "lyria_model", None) or "lyria-002"
    project_id_vertex = settings.google_project_id
    predict_url = (
        f"https://{location}-aiplatform.googleapis.com/v1/projects/{project_id_vertex}"
        f"/locations/{location}/publishers/google/models/{model}:predict"
    )

    try:
        response = httpx.post(
            predict_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={
                "instances": [{"prompt": prompt.strip()}],
                "parameters": {},
            },
            timeout=60.0,
        )
        response.raise_for_status()
        body = response.json()
    except httpx.HTTPStatusError as exc:
        logger.exception("[LYRIA] Vertex AI request failed: %s", exc.response.text[:500])
        return {
            "status": "error",
            "message": f"Failed to generate music: {exc.response.text[:300]}",
            "reason": "api_error",
        }
    except Exception as exc:
        logger.exception("[LYRIA] API request failed")
        return {
            "status": "error",
            "message": f"Failed to generate music: {exc}",
            "reason": "api_error",
        }

    predictions = body.get("predictions") or []
    if not predictions:
        logger.error("[LYRIA] Vertex response had no predictions: %s", body)
        return {
            "status": "error",
            "message": "Lyria did not return audio data. Try a different prompt.",
            "reason": "no_audio_data",
        }

    first = predictions[0]
    # Vertex Lyria returns audioContent (doc); some clients use bytesBase64Encoded
    audio_b64 = first.get("audioContent") or first.get("bytesBase64Encoded")
    if not audio_b64:
        logger.error("[LYRIA] Prediction missing audioContent: %s", first)
        return {
            "status": "error",
            "message": "Lyria did not return audio data. Try a different prompt.",
            "reason": "no_audio_data",
        }

    audio_bytes = base64.b64decode(audio_b64)
    mime_type = first.get("mimeType") or "audio/wav"
    logger.info("[LYRIA] Raw audio: %d bytes, mime_type=%s", len(audio_bytes), mime_type)

    # Keep WAV as-is; asset service pipeline handles transcoding if needed
    # Determine file extension based on mime_type
    ext = ".mp3"
    if mime_type:
        if "mp3" in mime_type or "mpeg" in mime_type:
            ext = ".mp3"
        elif "ogg" in mime_type:
            ext = ".ogg"
        elif "mp4" in mime_type or "m4a" in mime_type:
            ext = ".m4a"
        elif "wav" in mime_type:
            ext = ".wav"

    effective_project_id = project_id or context.get("project_id") or "unknown"
    prompt_slug = prompt[:30].replace(" ", "-").lower()
    # Remove special characters from slug
    prompt_slug = "".join(c for c in prompt_slug if c.isalnum() or c == "-")
    filename = f"lyria-{prompt_slug}-{request_id[:8]}{ext}"

    # Try asset service first (returns signed URL for direct access)
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
        audio_url = asset_data.get("signedUrl")
        return {
            "status": "success",
            "message": f"Music generated successfully ({duration_seconds}s). IMPORTANT: Include this URL in your response so the user can hear the music: {audio_url}",
            "audioUrl": audio_url,
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
