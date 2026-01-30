"""Client for communicating with the asset service."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)


class AssetServiceError(Exception):
    """Error from the asset service."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


async def get_asset_from_service(
    user_id: str,
    project_id: str,
    asset_id: str,
) -> dict[str, Any]:
    """
    Get an asset from the asset service.

    Args:
        user_id: User ID
        project_id: Project ID
        asset_id: Asset ID

    Returns:
        Asset data dict
    """
    settings = get_settings()
    url = f"{settings.asset_service_url}/api/assets/{user_id}/{project_id}/{asset_id}"

    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=30.0)

        if not response.is_success:
            raise AssetServiceError(
                f"Failed to get asset ({response.status_code}): {response.text}",
                status_code=response.status_code,
            )

        return response.json()


async def upload_to_asset_service(
    user_id: str,
    project_id: str,
    file_content: bytes,
    filename: str,
    mime_type: str,
    source: str = "video-effect",
    run_pipeline: bool = True,
) -> dict[str, Any]:
    """
    Upload a file to the asset service.

    Args:
        user_id: User ID
        project_id: Project ID
        file_content: File content as bytes
        filename: Name of the file
        mime_type: MIME type of the file
        source: Source of the upload
        run_pipeline: Whether to run the pipeline on the uploaded file

    Returns:
        Upload response with asset data
    """
    settings = get_settings()
    url = f"{settings.asset_service_url}/api/assets/{user_id}/{project_id}/upload"

    async with httpx.AsyncClient() as client:
        files = {"file": (filename, file_content, mime_type)}
        data = {
            "source": source,
            "runPipeline": "true" if run_pipeline else "false",
        }

        response = await client.post(
            url,
            files=files,
            data=data,
            timeout=120.0,  # Longer timeout for uploads
        )

        if not response.is_success:
            raise AssetServiceError(
                f"Failed to upload asset ({response.status_code}): {response.text}",
                status_code=response.status_code,
            )

        return response.json()


async def download_remote_file(url: str) -> tuple[bytes, str]:
    """
    Download a file from a remote URL.

    Args:
        url: URL to download from

    Returns:
        Tuple of (file_content, mime_type)
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=120.0, follow_redirects=True)

        if not response.is_success:
            raise AssetServiceError(
                f"Failed to download file ({response.status_code})",
                status_code=response.status_code,
            )

        content = response.content
        mime_type = response.headers.get("content-type", "video/mp4")

        return content, mime_type
