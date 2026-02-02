"""Google Cloud Transcoder API service."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)


class TranscodeJobStatus(str, Enum):
    """Status of a transcode job."""
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


class OutputFormat(str, Enum):
    """Supported output formats."""
    MP4 = "mp4"
    HLS = "hls"
    DASH = "dash"


class VideoCodec(str, Enum):
    """Supported video codecs."""
    H264 = "h264"
    H265 = "h265"
    VP9 = "vp9"


class AudioCodec(str, Enum):
    """Supported audio codecs."""
    AAC = "aac"
    MP3 = "mp3"
    OPUS = "opus"


@dataclass
class TranscodeConfig:
    """Configuration for a transcode job."""
    # Output format
    output_format: OutputFormat = OutputFormat.MP4

    # Video settings
    video_codec: VideoCodec = VideoCodec.H264
    video_bitrate_bps: int | None = None  # None = auto
    width: int | None = None  # None = preserve original
    height: int | None = None  # None = preserve original
    frame_rate: float | None = None  # None = preserve original

    # Audio settings
    audio_codec: AudioCodec = AudioCodec.AAC
    audio_bitrate_bps: int | None = None  # None = auto
    sample_rate_hz: int | None = None  # None = preserve original
    channels: int | None = None  # None = preserve original

    # Presets (overrides individual settings if specified)
    preset: str | None = None  # e.g., "preset/web-hd", "preset/web-sd"

    def to_job_config(self) -> dict[str, Any]:
        """Convert to Transcoder API job config format."""
        if self.preset:
            # Use preset - simplest configuration
            return {"templateId": self.preset}

        # Build custom config
        config: dict[str, Any] = {
            "elementaryStreams": [],
            "muxStreams": [],
        }

        # Video stream
        video_stream: dict[str, Any] = {
            "key": "video-stream0",
            "videoStream": {}
        }

        if self.video_codec == VideoCodec.H264:
            video_stream["videoStream"]["h264"] = self._build_h264_config()
        elif self.video_codec == VideoCodec.H265:
            video_stream["videoStream"]["h265"] = self._build_h265_config()
        elif self.video_codec == VideoCodec.VP9:
            video_stream["videoStream"]["vp9"] = self._build_vp9_config()

        config["elementaryStreams"].append(video_stream)

        # Audio stream
        audio_stream: dict[str, Any] = {
            "key": "audio-stream0",
            "audioStream": {}
        }

        if self.audio_codec == AudioCodec.AAC:
            audio_stream["audioStream"]["codec"] = "aac"
        elif self.audio_codec == AudioCodec.MP3:
            audio_stream["audioStream"]["codec"] = "mp3"
        elif self.audio_codec == AudioCodec.OPUS:
            audio_stream["audioStream"]["codec"] = "opus"

        # Transcoder API requires audio bitrateBps
        audio_stream["audioStream"]["bitrateBps"] = self.audio_bitrate_bps or 64_000
        if self.sample_rate_hz:
            audio_stream["audioStream"]["sampleRateHertz"] = self.sample_rate_hz
        if self.channels:
            audio_stream["audioStream"]["channelCount"] = self.channels

        config["elementaryStreams"].append(audio_stream)

        # Mux stream (output container)
        mux_stream = {
            "key": "output0",
            "elementaryStreams": ["video-stream0", "audio-stream0"],
        }

        if self.output_format == OutputFormat.MP4:
            mux_stream["container"] = "mp4"
            mux_stream["fileName"] = "output.mp4"
        elif self.output_format == OutputFormat.HLS:
            mux_stream["segmentSettings"] = {"segmentDuration": "6s"}
            # For HLS, we use fmp4 segments
            mux_stream["container"] = "fmp4"
        elif self.output_format == OutputFormat.DASH:
            mux_stream["segmentSettings"] = {"segmentDuration": "6s"}
            mux_stream["container"] = "fmp4"

        config["muxStreams"].append(mux_stream)

        return {"config": config}

    def _build_h264_config(self) -> dict[str, Any]:
        """Build H264 video config. Omit width/height to preserve input aspect ratio (e.g. vertical)."""
        cfg: dict[str, Any] = {
            "profile": "high",
            "preset": "medium",
            "bitrateBps": self.video_bitrate_bps or 2_500_000,
            "frameRate": self.frame_rate or 30.0,
        }
        if self.width:
            cfg["widthPixels"] = self.width
        if self.height:
            cfg["heightPixels"] = self.height
        return cfg

    def _build_h265_config(self) -> dict[str, Any]:
        """Build H265/HEVC video config. Omit width/height to preserve input aspect ratio."""
        cfg: dict[str, Any] = {
            "profile": "main",
            "preset": "medium",
            "bitrateBps": self.video_bitrate_bps or 2_500_000,
            "frameRate": self.frame_rate or 30.0,
        }
        if self.width:
            cfg["widthPixels"] = self.width
        if self.height:
            cfg["heightPixels"] = self.height
        return cfg

    def _build_vp9_config(self) -> dict[str, Any]:
        """Build VP9 video config. Omit width/height to preserve input aspect ratio."""
        cfg: dict[str, Any] = {
            "profile": "profile0",
            "bitrateBps": self.video_bitrate_bps or 2_500_000,
            "frameRate": self.frame_rate or 30.0,
        }
        if self.width:
            cfg["widthPixels"] = self.width
        if self.height:
            cfg["heightPixels"] = self.height
        return cfg


def get_transcode_access_token() -> str:
    """Get access token for Transcoder API."""
    settings = get_settings()

    # Prefer transcoder-specific service account
    key_source = settings.transcoder_service_account_key or settings.google_service_account_key

    if not key_source:
        raise ValueError("No service account key configured for Transcoder API")

    # Parse service account key
    try:
        if key_source.strip().startswith("{"):
            sa_info = json.loads(key_source)
        else:
            # Assume it's a file path
            with open(key_source, "r") as f:
                sa_info = json.load(f)
    except Exception as e:
        raise ValueError(f"Failed to parse service account key: {e}")

    # Use service account to get access token via JWT
    import time
    import jwt

    now = int(time.time())
    payload = {
        "iss": sa_info["client_email"],
        "sub": sa_info["client_email"],
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
        "scope": "https://www.googleapis.com/auth/cloud-platform",
    }

    signed_jwt = jwt.encode(payload, sa_info["private_key"], algorithm="RS256")

    # Exchange JWT for access token
    import requests
    response = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": signed_jwt,
        },
    )

    if response.status_code != 200:
        raise RuntimeError(f"Failed to get access token: {response.text}")

    return response.json()["access_token"]


async def create_transcode_job(
    input_uri: str,
    output_uri: str,
    config: TranscodeConfig,
) -> str:
    """
    Create a transcode job using the Transcoder API.

    Args:
        input_uri: GCS URI of the input video (gs://bucket/path/to/video.mp4)
        output_uri: GCS URI prefix for output files (gs://bucket/path/to/output/)
        config: Transcoding configuration

    Returns:
        Job name (e.g., "projects/123/locations/us-central1/jobs/abc123")
    """
    settings = get_settings()
    project_id = settings.effective_transcoder_project_id
    location = settings.transcoder_location

    token = get_transcode_access_token()

    # Build job payload
    job_config = config.to_job_config()
    job_payload: dict[str, Any] = {
        "inputUri": input_uri,
        "outputUri": output_uri,
        **job_config,
    }

    url = f"https://transcoder.googleapis.com/v1/projects/{project_id}/locations/{location}/jobs"

    async with httpx.AsyncClient() as client:
        response = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=job_payload,
            timeout=60.0,
        )

        if response.status_code not in (200, 201):
            raise RuntimeError(f"Transcoder API request failed: {response.text}")

        data = response.json()
        job_name = data.get("name")
        if not job_name:
            raise RuntimeError("Transcoder API did not return a job name")

        logger.info(f"Created transcode job: {job_name}")
        return job_name


async def get_transcode_job_status(job_name: str) -> tuple[TranscodeJobStatus, dict[str, Any]]:
    """
    Get the status of a transcode job.

    Args:
        job_name: Full job name from create_transcode_job

    Returns:
        Tuple of (status, metadata dict)
    """
    token = get_transcode_access_token()

    url = f"https://transcoder.googleapis.com/v1/{job_name}"

    async with httpx.AsyncClient() as client:
        response = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

        if response.status_code != 200:
            raise RuntimeError(f"Failed to get job status: {response.text}")

        data = response.json()
        state = data.get("state", "STATE_UNSPECIFIED")

        # Map API states to our status enum
        status_map = {
            "PENDING": TranscodeJobStatus.PENDING,
            "RUNNING": TranscodeJobStatus.RUNNING,
            "SUCCEEDED": TranscodeJobStatus.SUCCEEDED,
            "FAILED": TranscodeJobStatus.FAILED,
        }
        status = status_map.get(state, TranscodeJobStatus.PENDING)

        # Build metadata
        metadata: dict[str, Any] = {
            "state": state,
            "createTime": data.get("createTime"),
            "startTime": data.get("startTime"),
            "endTime": data.get("endTime"),
        }

        if status == TranscodeJobStatus.FAILED:
            error = data.get("error", {})
            metadata["error"] = error.get("message", "Unknown error")
            metadata["errorCode"] = error.get("code")

        if status == TranscodeJobStatus.SUCCEEDED:
            # Get output info
            metadata["outputUri"] = data.get("outputUri")

        return status, metadata
