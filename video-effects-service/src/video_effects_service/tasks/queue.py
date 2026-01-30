"""Redis-based task queue for video effect job polling."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import redis.asyncio as redis

from ..config import get_settings

logger = logging.getLogger(__name__)

POLL_QUEUE = "video_effects_poll"
TASK_STATUS_PREFIX = "vfx_task_status:"


class TaskQueue:
    """Simple Redis-based task queue for polling jobs."""

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client

    async def enqueue_poll(self, job_id: str) -> None:
        """
        Enqueue a job for status polling.

        Args:
            job_id: The video effect job ID to poll
        """
        now = datetime.utcnow().isoformat() + "Z"

        task = {
            "job_id": job_id,
            "enqueued_at": now,
        }

        # Store task status
        await self.redis.set(
            f"{TASK_STATUS_PREFIX}{job_id}",
            json.dumps({"status": "pending", "enqueued_at": now}),
            ex=60 * 60 * 24,  # Expire after 24 hours
        )

        # Push to queue
        await self.redis.lpush(POLL_QUEUE, json.dumps(task))

        logger.info(f"Enqueued job {job_id} for polling")

    async def dequeue(self, timeout: int = 5) -> dict[str, Any] | None:
        """
        Dequeue a task from the queue.

        Returns None if no task is available within timeout.
        """
        result = await self.redis.brpop(POLL_QUEUE, timeout=timeout)
        if result is None:
            return None

        _, task_json = result
        return json.loads(task_json)

    async def update_task_status(
        self,
        job_id: str,
        status: str,
        error: str | None = None,
    ) -> None:
        """Update the status of a task."""
        data = {
            "status": status,
            "updated_at": datetime.utcnow().isoformat() + "Z",
        }
        if error:
            data["error"] = error

        await self.redis.set(
            f"{TASK_STATUS_PREFIX}{job_id}",
            json.dumps(data),
            ex=60 * 60 * 24,
        )

    async def get_task_status(self, job_id: str) -> dict[str, Any] | None:
        """Get the status of a task."""
        data = await self.redis.get(f"{TASK_STATUS_PREFIX}{job_id}")
        if data is None:
            return None
        return json.loads(data)


_task_queue: TaskQueue | None = None


async def get_task_queue() -> TaskQueue:
    """Get or create the global task queue instance."""
    global _task_queue

    if _task_queue is None:
        settings = get_settings()
        client = redis.from_url(settings.redis_url, decode_responses=True)
        _task_queue = TaskQueue(client)

    return _task_queue


async def close_task_queue() -> None:
    """Close the task queue connection."""
    global _task_queue

    if _task_queue is not None:
        await _task_queue.redis.close()
        _task_queue = None
