"""
Gemini Files API

Utilities for uploading and managing files with Google's Gemini Files API.
Files uploaded via this API can be used in generateContent requests and
persist for 48 hours.

@see https://ai.google.dev/gemini-api/docs/files
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Literal

import httpx

from ..api_key_provider import get_current_key
from ..config import get_settings
from ..storage.gcs import create_signed_url, download_from_gcs

logger = logging.getLogger(__name__)

BASE_URL = "https://generativelanguage.googleapis.com"


class GeminiFilesApiError(Exception):
    """Error thrown when the Files API returns an error."""

    def __init__(self, message: str, status_code: int, details: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.details = details


@dataclass
class GeminiFile:
    """Metadata returned when a file is uploaded to the Gemini Files API."""

    name: str
    """File name in the format 'files/{id}'"""

    mime_type: str
    """MIME type of the file"""

    size_bytes: str
    """Size in bytes"""

    create_time: str
    """Creation timestamp"""

    update_time: str
    """Last update timestamp"""

    expiration_time: str
    """Expiration timestamp (files expire after 48 hours)"""

    uri: str
    """URI to use in generateContent requests"""

    state: Literal["PROCESSING", "ACTIVE", "FAILED"]
    """Processing state"""

    display_name: str | None = None
    """Display name for the file"""

    sha256_hash: str | None = None
    """SHA256 hash of the file"""

    error: dict | None = None
    """Error details if state is FAILED"""

    @classmethod
    def from_dict(cls, data: dict) -> GeminiFile:
        """Create a GeminiFile from API response dict."""
        return cls(
            name=data["name"],
            mime_type=data["mimeType"],
            size_bytes=data.get("sizeBytes", "0"),
            create_time=data.get("createTime", ""),
            update_time=data.get("updateTime", ""),
            expiration_time=data.get("expirationTime", ""),
            uri=data["uri"],
            state=data.get("state", "PROCESSING"),
            display_name=data.get("displayName"),
            sha256_hash=data.get("sha256Hash"),
            error=data.get("error"),
        )


def _get_api_key() -> str:
    """Get the current Gemini API key (supports rotation via GEMINI_API_KEYS)."""
    key = get_current_key()
    if not key:
        settings = get_settings()
        key = settings.gemini_api_key
    if not key:
        raise GeminiFilesApiError(
            "GEMINI_API_KEY / GEMINI_API_KEYS is not configured",
            500,
        )
    return key


async def upload_file(
    data: bytes,
    mime_type: str,
    display_name: str | None = None,
) -> GeminiFile:
    """
    Upload a file to the Gemini Files API from bytes.

    Args:
        data: The file data as bytes
        mime_type: MIME type of the file
        display_name: Optional display name for the file

    Returns:
        The uploaded file metadata

    Example:
        ```python
        with open("video.mp4", "rb") as f:
            data = f.read()
        file = await upload_file(data, "video/mp4", "My Video")
        # Use file.uri in generateContent requests
        ```
    """
    api_key = _get_api_key()
    num_bytes = len(data)

    async with httpx.AsyncClient(timeout=300.0) as client:
        # Step 1: Start resumable upload and get upload URL
        start_response = await client.post(
            f"{BASE_URL}/upload/v1beta/files",
            params={"key": api_key},
            headers={
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(num_bytes),
                "X-Goog-Upload-Header-Content-Type": mime_type,
                "Content-Type": "application/json",
            },
            json={"file": {"display_name": display_name}} if display_name else {},
        )

        if start_response.status_code != 200:
            raise GeminiFilesApiError(
                f"Failed to start upload: {start_response.status_code}",
                start_response.status_code,
                start_response.text,
            )

        upload_url = start_response.headers.get("X-Goog-Upload-URL")
        if not upload_url:
            raise GeminiFilesApiError(
                "No upload URL returned from Files API",
                500,
            )

        # Step 2: Upload the file data
        upload_response = await client.post(
            upload_url,
            headers={
                "Content-Length": str(num_bytes),
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
            },
            content=data,
        )

        if upload_response.status_code != 200:
            raise GeminiFilesApiError(
                f"Failed to upload file: {upload_response.status_code}",
                upload_response.status_code,
                upload_response.text,
            )

        result = upload_response.json()
        return GeminiFile.from_dict(result["file"])


async def upload_file_from_url(
    url: str,
    mime_type: str,
    display_name: str | None = None,
) -> GeminiFile:
    """
    Upload a file to Gemini Files API from a URL.

    This fetches the content from the URL and uploads it to the Files API.
    Useful for uploading files from GCS signed URLs or other HTTP sources.

    Args:
        url: The URL to fetch the file from
        mime_type: MIME type of the file
        display_name: Optional display name for the file

    Returns:
        The uploaded file metadata

    Example:
        ```python
        file = await upload_file_from_url(
            "https://storage.googleapis.com/bucket/video.mp4?signature=...",
            "video/mp4",
            "My Video"
        )
        # Use file.uri in generateContent requests
        ```
    """
    logger.info(f"[gemini-files-api] Fetching file from URL...")

    async with httpx.AsyncClient(timeout=300.0) as client:
        response = await client.get(url)
        if response.status_code != 200:
            raise GeminiFilesApiError(
                f"Failed to fetch file from URL: {response.status_code} {response.reason_phrase}",
                response.status_code,
            )

        data = response.content
        size_mb = len(data) / 1024 / 1024
        logger.info(
            f"[gemini-files-api] Fetched {size_mb:.2f}MB, uploading to Files API..."
        )

    return await upload_file(data, mime_type, display_name)


async def upload_file_from_gcs(
    gcs_uri: str,
    mime_type: str,
    display_name: str | None = None,
) -> GeminiFile:
    """
    Upload a file to Gemini Files API from a GCS URI.

    This generates a signed URL for the GCS object and uploads it to the Files API.

    Args:
        gcs_uri: GCS URI in format gs://bucket/path
        mime_type: MIME type of the file
        display_name: Optional display name for the file

    Returns:
        The uploaded file metadata

    Example:
        ```python
        file = await upload_file_from_gcs(
            "gs://my-bucket/assets/video.mp4",
            "video/mp4",
            "My Video"
        )
        # Use file.uri in generateContent requests
        ```
    """
    if not gcs_uri.startswith("gs://"):
        raise ValueError(f"Invalid GCS URI: {gcs_uri}")

    # Parse GCS URI to get object name
    parts = gcs_uri[5:].split("/", 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid GCS URI: {gcs_uri}")

    bucket_name, object_name = parts

    logger.info(f"[gemini-files-api] Generating signed URL for {gcs_uri}")

    # Generate signed URL (valid for 1 hour - plenty of time for upload)
    signed_url = create_signed_url(object_name, bucket=bucket_name, expires_in_seconds=3600)

    return await upload_file_from_url(signed_url, mime_type, display_name)


async def get_file(name: str) -> GeminiFile:
    """
    Get metadata for a file.

    Args:
        name: The file name (e.g., "files/abc123")

    Returns:
        The file metadata
    """
    api_key = _get_api_key()

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{BASE_URL}/v1beta/{name}",
            params={"key": api_key},
        )

        if response.status_code != 200:
            raise GeminiFilesApiError(
                f"Failed to get file: {response.status_code}",
                response.status_code,
                response.text,
            )

        return GeminiFile.from_dict(response.json())


async def wait_for_file_active(
    name: str,
    max_wait_seconds: float = 120.0,
    poll_interval_seconds: float = 2.0,
) -> GeminiFile:
    """
    Wait for a file to finish processing.

    Files are processed asynchronously after upload. This function polls
    until the file reaches ACTIVE state or fails.

    Args:
        name: The file name (e.g., "files/abc123")
        max_wait_seconds: Maximum time to wait (default: 120s)
        poll_interval_seconds: Polling interval (default: 2s)

    Returns:
        The file metadata once active

    Raises:
        GeminiFilesApiError: If file processing fails or times out
    """
    elapsed = 0.0

    while elapsed < max_wait_seconds:
        file = await get_file(name)

        if file.state == "ACTIVE":
            logger.info(f"[gemini-files-api] File {name} is ready")
            return file

        if file.state == "FAILED":
            error_msg = file.error.get("message", "Unknown error") if file.error else "Unknown error"
            raise GeminiFilesApiError(
                f"File processing failed: {error_msg}",
                500,
                str(file.error),
            )

        logger.info(f"[gemini-files-api] File {name} is {file.state}, waiting...")
        await asyncio.sleep(poll_interval_seconds)
        elapsed += poll_interval_seconds

    raise GeminiFilesApiError(
        f"Timeout waiting for file {name} to become active after {max_wait_seconds}s",
        408,
    )


async def delete_file(name: str) -> None:
    """
    Delete a file from the Files API.

    Args:
        name: The file name (e.g., "files/abc123")
    """
    api_key = _get_api_key()

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.delete(
            f"{BASE_URL}/v1beta/{name}",
            params={"key": api_key},
        )

        if response.status_code != 200:
            raise GeminiFilesApiError(
                f"Failed to delete file: {response.status_code}",
                response.status_code,
                response.text,
            )


async def list_files(
    page_size: int = 100,
    page_token: str | None = None,
) -> tuple[list[GeminiFile], str | None]:
    """
    List all uploaded files.

    Args:
        page_size: Number of files per page (default: 100)
        page_token: Token for pagination

    Returns:
        Tuple of (list of files, next page token or None)
    """
    api_key = _get_api_key()

    params = {"key": api_key, "pageSize": str(page_size)}
    if page_token:
        params["pageToken"] = page_token

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{BASE_URL}/v1beta/files",
            params=params,
        )

        if response.status_code != 200:
            raise GeminiFilesApiError(
                f"Failed to list files: {response.status_code}",
                response.status_code,
                response.text,
            )

        data = response.json()
        files = [GeminiFile.from_dict(f) for f in data.get("files", [])]
        next_token = data.get("nextPageToken")

        return files, next_token


def is_gemini_file_uri(uri: str) -> bool:
    """Check if a URI is a Gemini Files API URI."""
    return uri.startswith("https://generativelanguage.googleapis.com/v1beta/files/")
