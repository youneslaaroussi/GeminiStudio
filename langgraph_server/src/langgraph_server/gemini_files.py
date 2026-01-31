"""Gemini File API utilities for uploading media files."""

from __future__ import annotations

import asyncio
import io
import logging
import time
from typing import NamedTuple

from google import genai

from .config import Settings, get_settings

logger = logging.getLogger(__name__)


class UploadedFile(NamedTuple):
    """Result of uploading a file to Gemini."""
    uri: str
    name: str
    mime_type: str


def _get_client(settings: Settings | None = None) -> genai.Client:
    """Get a Gemini API client."""
    resolved = settings or get_settings()
    return genai.Client(api_key=resolved.google_api_key)


def upload_file_sync(
    data: bytes,
    mime_type: str,
    *,
    display_name: str | None = None,
    settings: Settings | None = None,
    timeout: float = 120.0,
) -> UploadedFile:
    """
    Upload a file to Gemini File API synchronously.
    
    Args:
        data: File content as bytes
        mime_type: MIME type of the file (e.g., "video/mp4", "image/jpeg")
        display_name: Optional display name for the file
        settings: Optional settings (uses default if not provided)
        timeout: Max seconds to wait for processing
    
    Returns:
        UploadedFile with uri, name, and mime_type
    """
    client = _get_client(settings)
    
    # Create a file-like object from bytes
    file_obj = io.BytesIO(data)
    
    # Upload to Gemini
    logger.info("[GEMINI_FILES] Uploading file (%d bytes, %s)", len(data), mime_type)
    
    uploaded = client.files.upload(
        file=file_obj,
        config={
            "mime_type": mime_type,
            "display_name": display_name or f"upload-{int(time.time())}",
        },
    )
    
    # Wait for processing to complete (videos may take a while)
    # State can be: PROCESSING, ACTIVE, FAILED
    start_time = time.time()
    while uploaded.state.name != "ACTIVE":
        elapsed = time.time() - start_time
        
        if uploaded.state.name == "FAILED":
            # Try to get error details
            error_msg = "Unknown error"
            if hasattr(uploaded, 'error') and uploaded.error:
                error_msg = str(uploaded.error)
            logger.error(
                "[GEMINI_FILES] File processing FAILED: name=%s, error=%s",
                uploaded.name,
                error_msg,
            )
            raise RuntimeError(
                f"Gemini file processing failed: {uploaded.name} - {error_msg}"
            )
        
        if elapsed > timeout:
            raise TimeoutError(
                f"Gemini file processing timed out after {timeout}s "
                f"(state={uploaded.state.name}, name={uploaded.name})"
            )
        
        logger.info(
            "[GEMINI_FILES] Waiting for file to become ACTIVE (state=%s, elapsed=%.1fs)",
            uploaded.state.name,
            elapsed,
        )
        time.sleep(2)
        uploaded = client.files.get(name=uploaded.name)
    
    logger.info(
        "[GEMINI_FILES] Upload complete: uri=%s, state=%s",
        uploaded.uri,
        uploaded.state.name,
    )
    
    return UploadedFile(
        uri=uploaded.uri,
        name=uploaded.name,
        mime_type=mime_type,
    )


async def upload_file(
    data: bytes,
    mime_type: str,
    *,
    display_name: str | None = None,
    settings: Settings | None = None,
    timeout: float = 120.0,
) -> UploadedFile:
    """
    Upload a file to Gemini File API asynchronously.
    
    Runs the sync upload in a thread pool to avoid blocking the event loop.
    
    Args:
        data: File content as bytes
        mime_type: MIME type of the file (e.g., "video/mp4", "image/jpeg")
        display_name: Optional display name for the file
        settings: Optional settings (uses default if not provided)
        timeout: Max seconds to wait for processing
    
    Returns:
        UploadedFile with uri, name, and mime_type
    """
    return await asyncio.to_thread(
        upload_file_sync,
        data,
        mime_type,
        display_name=display_name,
        settings=settings,
        timeout=timeout,
    )


def delete_file(name: str, *, settings: Settings | None = None) -> bool:
    """
    Delete a file from Gemini File API.
    
    Args:
        name: The file name (from UploadedFile.name)
        settings: Optional settings
    
    Returns:
        True if deleted successfully, False otherwise
    """
    try:
        client = _get_client(settings)
        client.files.delete(name=name)
        logger.info("[GEMINI_FILES] Deleted file: %s", name)
        return True
    except Exception as e:
        logger.warning("[GEMINI_FILES] Failed to delete file %s: %s", name, e)
        return False
