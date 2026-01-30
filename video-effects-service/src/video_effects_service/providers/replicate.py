"""Replicate API provider for video effects."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

API_BASE_URL = "https://api.replicate.com/v1"


class ReplicateProviderError(Exception):
    """Error from the Replicate provider."""

    def __init__(self, message: str, cause: Exception | None = None):
        super().__init__(message)
        self.cause = cause


def _get_headers() -> dict[str, str]:
    """Get headers for Replicate API requests."""
    settings = get_settings()
    if not settings.replicate_api_token:
        raise ReplicateProviderError(
            "REPLICATE_API_TOKEN is not configured in the environment"
        )
    return {
        "Authorization": f"Bearer {settings.replicate_api_token}",
        "Content-Type": "application/json",
    }


async def create_prediction(
    version: str,
    input_data: dict[str, Any],
) -> dict[str, Any]:
    """
    Create a new prediction on Replicate.

    Args:
        version: Model version string (e.g., "owner/model:version_id")
        input_data: Input parameters for the model

    Returns:
        Prediction response from Replicate API
    """
    # Extract version ID from full version string if needed
    version_id = version.split(":")[-1] if ":" in version else version

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{API_BASE_URL}/predictions",
            headers=_get_headers(),
            json={
                "version": version_id,
                "input": input_data,
            },
            timeout=30.0,
        )

        if not response.is_success:
            raise ReplicateProviderError(
                f"Failed to create prediction ({response.status_code}): {response.text}"
            )

        return response.json()


async def get_prediction(prediction_id: str) -> dict[str, Any]:
    """
    Get the status of a prediction.

    Args:
        prediction_id: The prediction ID

    Returns:
        Prediction response from Replicate API
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{API_BASE_URL}/predictions/{prediction_id}",
            headers=_get_headers(),
            timeout=30.0,
        )

        if not response.is_success:
            raise ReplicateProviderError(
                f"Failed to get prediction ({response.status_code}): {response.text}"
            )

        return response.json()


def map_replicate_status(status: str) -> str:
    """
    Map Replicate status to our job status.

    Replicate statuses: starting, processing, succeeded, failed, canceled
    Our statuses: pending, running, completed, error
    """
    if status in ("starting", "processing"):
        return "running"
    if status == "succeeded":
        return "completed"
    if status in ("failed", "canceled"):
        return "error"
    return "pending"
