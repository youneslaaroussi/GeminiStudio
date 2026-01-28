"""Extract metadata from media files using ffprobe."""

from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class MediaMetadata:
    """Extracted media metadata."""

    duration: float | None = None
    width: int | None = None
    height: int | None = None
    codec: str | None = None
    audio_codec: str | None = None
    sample_rate: int | None = None
    channels: int | None = None
    bitrate: int | None = None
    format_name: str | None = None
    size: int | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary, excluding None values."""
        return {k: v for k, v in self.__dict__.items() if v is not None}


def extract_metadata(file_path: str | Path) -> MediaMetadata:
    """
    Extract metadata from a media file using ffprobe.

    Args:
        file_path: Path to the media file

    Returns:
        MediaMetadata with extracted information

    Raises:
        FileNotFoundError: If file doesn't exist
        RuntimeError: If ffprobe fails
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    cmd = [
        "ffprobe",
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"ffprobe timed out for {file_path}")
    except FileNotFoundError:
        raise RuntimeError("ffprobe not found. Please install ffmpeg.")

    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse ffprobe output: {e}")

    return _parse_ffprobe_output(data)


def _parse_ffprobe_output(data: dict[str, Any]) -> MediaMetadata:
    """Parse ffprobe JSON output into MediaMetadata."""
    metadata = MediaMetadata()

    # Parse format info
    format_info = data.get("format", {})
    metadata.format_name = format_info.get("format_name")
    metadata.size = _safe_int(format_info.get("size"))

    if "duration" in format_info:
        metadata.duration = _safe_float(format_info["duration"])

    if "bit_rate" in format_info:
        metadata.bitrate = _safe_int(format_info["bit_rate"])

    # Parse streams
    streams = data.get("streams", [])

    for stream in streams:
        codec_type = stream.get("codec_type")

        if codec_type == "video" and metadata.codec is None:
            metadata.codec = stream.get("codec_name")
            metadata.width = _safe_int(stream.get("width"))
            metadata.height = _safe_int(stream.get("height"))

            # Video stream might have more accurate duration
            if metadata.duration is None and "duration" in stream:
                metadata.duration = _safe_float(stream["duration"])

        elif codec_type == "audio" and metadata.audio_codec is None:
            metadata.audio_codec = stream.get("codec_name")
            metadata.sample_rate = _safe_int(stream.get("sample_rate"))
            metadata.channels = _safe_int(stream.get("channels"))

            # Audio stream might have more accurate duration for audio files
            if metadata.duration is None and "duration" in stream:
                metadata.duration = _safe_float(stream["duration"])

    return metadata


def _safe_float(value: Any) -> float | None:
    """Safely convert value to float."""
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _safe_int(value: Any) -> int | None:
    """Safely convert value to int."""
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def determine_asset_type(mime_type: str, filename: str | None = None) -> str:
    """
    Determine the asset type based on MIME type.

    Args:
        mime_type: The file's MIME type
        filename: Optional filename for additional context

    Returns:
        One of: "video", "audio", "image", "other"
    """
    if mime_type.startswith("video/"):
        return "video"
    if mime_type.startswith("audio/"):
        return "audio"
    if mime_type.startswith("image/"):
        return "image"

    # Check file extension as fallback
    if filename:
        ext = Path(filename).suffix.lower()
        video_exts = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
        audio_exts = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
        image_exts = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"}

        if ext in video_exts:
            return "video"
        if ext in audio_exts:
            return "audio"
        if ext in image_exts:
            return "image"

    return "other"
