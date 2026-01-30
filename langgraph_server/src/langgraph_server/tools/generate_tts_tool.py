"""Tool to generate speech from text using Google's TTS model."""

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

logger = logging.getLogger(__name__)


def _pcm_to_wav(pcm_data: bytes, sample_rate: int = 24000, channels: int = 1, sample_width: int = 2) -> bytes:
    """Convert raw PCM data to WAV format by adding headers.
    
    Args:
        pcm_data: Raw 16-bit signed little-endian PCM audio data
        sample_rate: Audio sample rate in Hz (default 24000 for Gemini TTS)
        channels: Number of audio channels (1 = mono)
        sample_width: Bytes per sample (2 = 16-bit)
    
    Returns:
        WAV file bytes with proper RIFF header
    """
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
    
    Args:
        pcm_data: Raw 16-bit signed little-endian PCM audio data
        sample_rate: Audio sample rate in Hz (default 24000 for Gemini TTS)
        channels: Number of audio channels (1 = mono)
    
    Returns:
        MP3 file bytes
    """
    import subprocess
    import tempfile
    import os
    
    # Create temp files for input WAV and output MP3
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as wav_file:
        wav_path = wav_file.name
        # First convert PCM to WAV (ffmpeg needs headers)
        wav_bytes = _pcm_to_wav(pcm_data, sample_rate, channels)
        wav_file.write(wav_bytes)
    
    mp3_path = wav_path.replace('.wav', '.mp3')
    
    try:
        # Convert WAV to MP3 using ffmpeg
        result = subprocess.run(
            [
                'ffmpeg', '-y',  # Overwrite output
                '-i', wav_path,  # Input WAV
                '-codec:a', 'libmp3lame',  # MP3 codec
                '-qscale:a', '2',  # High quality (VBR ~190kbps)
                mp3_path
            ],
            capture_output=True,
            timeout=30,
        )
        
        if result.returncode != 0:
            logger.error("[TTS] ffmpeg conversion failed: %s", result.stderr.decode()[:500])
            # Fall back to WAV if ffmpeg fails
            return wav_bytes
        
        # Read the MP3 file
        with open(mp3_path, 'rb') as f:
            mp3_bytes = f.read()
        
        logger.info("[TTS] Converted to MP3: %d bytes", len(mp3_bytes))
        return mp3_bytes
        
    except subprocess.TimeoutExpired:
        logger.error("[TTS] ffmpeg conversion timed out")
        return _pcm_to_wav(pcm_data, sample_rate, channels)
    except FileNotFoundError:
        logger.warning("[TTS] ffmpeg not found, falling back to WAV")
        return _pcm_to_wav(pcm_data, sample_rate, channels)
    finally:
        # Clean up temp files
        for path in [wav_path, mp3_path]:
            try:
                os.unlink(path)
            except OSError:
                pass

# Available TTS voices
_VOICE_CHOICES = {
    "Puck": "Upbeat, playful male voice",
    "Charon": "Deep, authoritative male voice",
    "Kore": "Warm, friendly female voice",
    "Fenrir": "Bold, energetic male voice",
    "Aoede": "Bright, cheerful female voice",
    "Leda": "Calm, soothing female voice",
    "Orus": "Clear, professional male voice",
    "Zephyr": "Soft, gentle voice",
}

_VOICE_NAMES = set(_VOICE_CHOICES.keys())


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
        logger.warning("[TTS] Asset service URL not configured")
        return None

    endpoint = f"{settings.asset_service_url.rstrip('/')}/api/assets/{user_id}/{project_id}/upload"
    
    try:
        files = {"file": (filename, audio_bytes, content_type)}
        data = {"source": "tts", "run_pipeline": "true"}
        
        response = httpx.post(endpoint, files=files, data=data, timeout=60.0)
        
        if response.status_code not in (200, 201):
            logger.error("[TTS] Asset service upload failed: %s - %s", response.status_code, response.text[:200])
            return None
        
        result = response.json()
        asset = result.get("asset", {})
        asset_id = asset.get("id")
        
        if not asset_id:
            logger.error("[TTS] Asset service did not return asset ID")
            return None
        
        # Get filename from asset for proper extension in proxy URL
        asset_filename = asset.get("fileName", "audio.mp3")
        
        # Build proxy URL for CORS-safe access (include filename for proper extension)
        proxy_url = f"/api/assets/{asset_id}/file/{asset_filename}?projectId={project_id}&userId={user_id}"
        
        logger.info("[TTS] Uploaded audio to asset service: asset_id=%s", asset_id)
        return {
            "assetId": asset_id,
            "proxyUrl": proxy_url,
            "gcsUri": asset.get("gcsUri"),
            "signedUrl": asset.get("signedUrl"),
        }
    except Exception as e:
        logger.exception("[TTS] Failed to upload to asset service: %s", e)
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
        logger.info("[TTS] Uploaded audio to %s", gcs_uri)
        return gcs_uri
    except Exception as e:
        logger.exception("[TTS] Failed to upload audio to GCS: %s", e)
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
        logger.warning("[TTS] Failed to generate signed URL: %s", e)
        return None


@tool
def generateSpeech(
    text: str,
    voice: str = "Kore",
    project_id: str | None = None,
    user_id: str | None = None,
) -> dict:
    """Generate natural-sounding speech from text using Google's TTS model.

    Creates high-quality voice audio from text. Great for voiceovers, narration,
    announcements, and accessibility features.

    IMPORTANT: When this tool succeeds, you MUST include the audioUrl in your response
    to the user so they can hear the speech. For example: "Here is the audio: [audioUrl]"
    If the user asks to hear it again later, use listProjectAssets to get the URL.

    Available voices:
    - Puck: Upbeat, playful male voice
    - Charon: Deep, authoritative male voice
    - Kore: Warm, friendly female voice (default)
    - Fenrir: Bold, energetic male voice
    - Aoede: Bright, cheerful female voice
    - Leda: Calm, soothing female voice
    - Orus: Clear, professional male voice
    - Zephyr: Soft, gentle voice

    Args:
        text: The text to convert to speech. Can include punctuation for natural pauses.
            Supports up to 5000 characters.
        voice: Voice to use - Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, or Zephyr.
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
            "message": "Unable to generate speech because no user context is available.",
            "reason": "missing_user",
        }

    if not text or len(text.strip()) < 2:
        return {
            "status": "error",
            "message": "Please provide text to convert to speech (at least 2 characters).",
            "reason": "invalid_text",
        }

    if len(text) > 5000:
        return {
            "status": "error",
            "message": "Text is too long. Maximum 5000 characters.",
            "reason": "text_too_long",
        }

    if voice not in _VOICE_NAMES:
        voice_list = ", ".join(sorted(_VOICE_NAMES))
        return {
            "status": "error",
            "message": f"Invalid voice '{voice}'. Choose from: {voice_list}",
            "reason": "invalid_voice",
        }

    # Deduct credits before generation
    cost = get_credits_for_action("tts")
    try:
        deduct_credits(user_id, cost, "tts", settings)
    except InsufficientCreditsError as e:
        logger.warning("[TTS] Insufficient credits for user %s", user_id)
        return {
            "status": "error",
            "message": f"Insufficient credits. You need {e.required} R‑Credits for TTS generation. Add credits in Gemini Studio Settings to continue.",
            "reason": "insufficient_credits",
            "required": e.required,
            "current": e.current,
        }

    request_id = uuid4().hex

    try:
        client = genai.Client(api_key=settings.google_api_key)
        
        # Generate speech using TTS model
        response = client.models.generate_content(
            model=settings.tts_model,
            contents=text.strip(),
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=voice,
                        )
                    )
                ),
            ),
        )

    except Exception as exc:
        logger.exception("[TTS] API request failed")
        return {
            "status": "error",
            "message": f"Failed to generate speech: {exc}",
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
        logger.error("[TTS] Failed to extract audio from response: %s", e)
        return {
            "status": "error",
            "message": "TTS did not return audio data. Please try again.",
            "reason": "no_audio_data",
        }

    if not audio_data:
        return {
            "status": "error",
            "message": "TTS did not return audio data. Please try again.",
            "reason": "no_audio_data",
        }

    # Decode if base64
    if isinstance(audio_data, str):
        audio_bytes = base64.b64decode(audio_data)
    else:
        audio_bytes = bytes(audio_data) if not isinstance(audio_data, bytes) else audio_data

    logger.info("[TTS] Raw audio: %d bytes, mime_type=%s", len(audio_bytes), mime_type)

    # Check if it's raw PCM (L16 = 16-bit linear PCM) and convert to MP3
    # Gemini TTS returns "audio/L16;codec=pcm;rate=24000"
    # Note: Telegram sendAudio only supports MP3/M4A, not WAV
    if mime_type and ("L16" in mime_type or "pcm" in mime_type.lower()):
        # Parse sample rate from mime_type
        sample_rate = 24000  # default for Gemini TTS
        if "rate=" in mime_type:
            try:
                rate_str = mime_type.split("rate=")[1].split(";")[0]
                sample_rate = int(rate_str)
            except (IndexError, ValueError):
                pass
        
        logger.info("[TTS] Converting raw PCM to MP3 (sample_rate=%d)", sample_rate)
        audio_bytes = _pcm_to_mp3(audio_bytes, sample_rate=sample_rate)
        mime_type = "audio/mpeg"
        logger.info("[TTS] MP3 conversion complete: %d bytes", len(audio_bytes))

    # Determine file extension based on final mime_type
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

    effective_project_id = project_id or "unknown"
    text_slug = text[:30].replace(" ", "-").lower()
    # Remove special characters from slug
    text_slug = "".join(c for c in text_slug if c.isalnum() or c == "-")
    filename = f"tts-{voice.lower()}-{text_slug}-{request_id[:8]}{ext}"

    # Try asset service first (provides proxy URL for CORS-safe access)
    asset_data = _upload_to_asset_service(
        audio_bytes, filename, mime_type, user_id, effective_project_id, settings
    )

    if asset_data:
        logger.info(
            "[TTS] Generated speech: voice=%s, text=%s..., asset_id=%s",
            voice,
            text[:50],
            asset_data["assetId"],
        )
        # Prefer signed URL for external clients (like Telegram)
        audio_url = asset_data.get("signedUrl") or asset_data["proxyUrl"]
        return {
            "status": "success",
            "message": f"Speech generated successfully (voice: {voice}). IMPORTANT: Include this URL in your response so the user can hear the audio: {audio_url}",
            "audioUrl": audio_url,
            "proxyUrl": asset_data["proxyUrl"],
            "assetId": asset_data["assetId"],
            "gcsUri": asset_data.get("gcsUri"),
            "mimeType": mime_type,
            "voice": voice,
            "textLength": len(text),
        }

    # Fallback to direct GCS upload
    gcs_object_name = f"tts/{user_id}/{effective_project_id}/{request_id}{ext}"
    gcs_uri = _upload_audio_to_gcs(audio_bytes, gcs_object_name, mime_type, settings)

    if not gcs_uri:
        return {
            "status": "error",
            "message": "Speech generated but upload failed.",
            "reason": "upload_failed",
        }

    download_url = _generate_signed_url(gcs_uri, settings)
    audio_url = download_url or gcs_uri

    logger.info(
        "[TTS] Generated speech (GCS fallback): voice=%s, text=%s..., gcs=%s",
        voice,
        text[:50],
        gcs_uri,
    )

    return {
        "status": "success",
        "message": f"Speech generated successfully (voice: {voice}). IMPORTANT: Include this URL in your response so the user can hear the audio: {audio_url}",
        "audioUrl": audio_url,
        "gcsUri": gcs_uri,
        "mimeType": mime_type,
        "voice": voice,
        "textLength": len(text),
    }
