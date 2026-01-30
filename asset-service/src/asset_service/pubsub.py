"""Pub/Sub event publishing for asset pipeline."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from google.cloud import pubsub_v1

from .config import get_settings

logger = logging.getLogger(__name__)

_publisher: pubsub_v1.PublisherClient | None = None


def _get_publisher() -> pubsub_v1.PublisherClient:
    """Get or create the publisher client."""
    global _publisher
    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    return _publisher


def publish_pipeline_event(
    event_type: str,
    user_id: str,
    project_id: str,
    asset_id: str,
    asset_name: str | None = None,
    steps_summary: list[dict[str, Any]] | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """
    Publish a pipeline event to Pub/Sub.

    Args:
        event_type: Event type (e.g., "pipeline.completed", "pipeline.failed")
        user_id: User ID
        project_id: Project ID
        asset_id: Asset ID
        asset_name: Asset name (optional)
        steps_summary: Summary of step results (optional)
        metadata: Additional metadata (optional)
    """
    settings = get_settings()
    topic_name = settings.pipeline_event_topic
    project = settings.google_project_id

    topic_path = f"projects/{project}/topics/{topic_name}"

    payload = {
        "type": event_type,
        "userId": user_id,
        "projectId": project_id,
        "assetId": asset_id,
        "assetName": asset_name,
        "stepsSummary": steps_summary or [],
        "metadata": metadata or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    try:
        publisher = _get_publisher()
        data = json.dumps(payload).encode("utf-8")
        future = publisher.publish(topic_path, data)
        message_id = future.result(timeout=10)
        logger.info(
            "[PIPELINE_PUBSUB] Published %s event for asset %s (message_id=%s)",
            event_type,
            asset_id,
            message_id,
        )
    except Exception as e:
        # Log but don't fail the pipeline if pub/sub fails
        logger.warning(
            "[PIPELINE_PUBSUB] Failed to publish %s event for asset %s: %s",
            event_type,
            asset_id,
            e,
        )
