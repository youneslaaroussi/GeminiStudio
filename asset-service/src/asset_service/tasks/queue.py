"""Redis-based task queue for background pipeline processing."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any

import redis.asyncio as redis

from ..config import get_settings

logger = logging.getLogger(__name__)

PIPELINE_QUEUE = "pipeline_tasks"
TASK_STATUS_PREFIX = "task_status:"


class TaskQueue:
    """Simple Redis-based task queue."""

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client

    async def enqueue_pipeline(
        self,
        user_id: str,
        project_id: str,
        asset_id: str,
        asset_data: dict[str, Any],
        asset_path: str,
    ) -> str:
        """
        Enqueue a pipeline task for background processing.

        Returns the task ID.
        """
        task_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"

        task = {
            "id": task_id,
            "type": "pipeline",
            "payload": {
                "user_id": user_id,
                "project_id": project_id,
                "asset_id": asset_id,
                "asset_data": asset_data,
                "asset_path": asset_path,
            },
            "status": "pending",
            "created_at": now,
        }

        # Store task status
        await self.redis.set(
            f"{TASK_STATUS_PREFIX}{task_id}",
            json.dumps({"status": "pending", "created_at": now}),
            ex=60 * 60 * 24,  # Expire after 24 hours
        )

        # Push to queue
        await self.redis.lpush(PIPELINE_QUEUE, json.dumps(task))

        logger.info(f"Enqueued pipeline task {task_id} for asset {asset_id}")
        return task_id

    async def enqueue_step(
        self,
        user_id: str,
        project_id: str,
        asset_id: str,
        asset_data: dict[str, Any],
        step_id: str,
        params: dict[str, Any] | None = None,
    ) -> str:
        """
        Enqueue a single pipeline step for background processing.

        Returns the task ID.
        """
        task_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"

        task = {
            "id": task_id,
            "type": "step",
            "payload": {
                "user_id": user_id,
                "project_id": project_id,
                "asset_id": asset_id,
                "asset_data": asset_data,
                "step_id": step_id,
                "params": params or {},
            },
            "status": "pending",
            "created_at": now,
        }

        # Store task status
        await self.redis.set(
            f"{TASK_STATUS_PREFIX}{task_id}",
            json.dumps({"status": "pending", "created_at": now}),
            ex=60 * 60 * 24,
        )

        # Push to queue
        await self.redis.lpush(PIPELINE_QUEUE, json.dumps(task))

        logger.info(f"Enqueued step task {task_id} for asset {asset_id}, step {step_id}")
        return task_id

    async def dequeue(self, timeout: int = 5) -> dict[str, Any] | None:
        """
        Dequeue a task from the queue.

        Returns None if no task is available within timeout.
        """
        result = await self.redis.brpop(PIPELINE_QUEUE, timeout=timeout)
        if result is None:
            return None

        _, task_json = result
        return json.loads(task_json)

    async def update_task_status(
        self,
        task_id: str,
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
            f"{TASK_STATUS_PREFIX}{task_id}",
            json.dumps(data),
            ex=60 * 60 * 24,
        )

    async def get_task_status(self, task_id: str) -> dict[str, Any] | None:
        """Get the status of a task."""
        data = await self.redis.get(f"{TASK_STATUS_PREFIX}{task_id}")
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
