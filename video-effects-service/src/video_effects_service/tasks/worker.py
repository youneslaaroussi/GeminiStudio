"""Background worker for polling video effect jobs."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .queue import TaskQueue, get_task_queue

logger = logging.getLogger(__name__)


class VideoEffectsWorker:
    """Background worker that polls video effect jobs from Redis queue."""

    def __init__(self, queue: TaskQueue):
        self.queue = queue
        self.running = False
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the worker loop."""
        if self.running:
            logger.warning("Worker already running")
            return

        self.running = True
        self._task = asyncio.create_task(self._run())
        logger.info("Video effects worker started")

    async def stop(self) -> None:
        """Stop the worker loop."""
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Video effects worker stopped")

    async def _run(self) -> None:
        """Main worker loop."""
        while self.running:
            try:
                task = await self.queue.dequeue(timeout=5)
                if task is None:
                    continue

                await self._process_task(task)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception(f"Worker error: {e}")
                await asyncio.sleep(1)

    async def _process_task(self, task: dict[str, Any]) -> None:
        """Process a single poll task."""
        from ..service import poll_job

        job_id = task["job_id"]
        logger.info(f"Processing poll task for job {job_id}")

        try:
            await self.queue.update_task_status(job_id, "running")

            # Poll the job
            job = await poll_job(job_id)

            if job is None:
                logger.warning(f"Job {job_id} not found")
                await self.queue.update_task_status(job_id, "failed", "Job not found")
                return

            status = job.get("status", "")

            if status == "completed" or status == "error":
                # Job is done, no need to re-poll
                await self.queue.update_task_status(job_id, "completed")
                logger.info(f"Job {job_id} finished with status: {status}")
            elif status == "completing":
                # Job is being completed by another worker, re-check shortly
                await asyncio.sleep(2)
                await self.queue.enqueue_poll(job_id)
                logger.debug(f"Job {job_id} is completing, will re-check")
            else:
                # Job still running, re-enqueue for polling
                await asyncio.sleep(3)  # Wait before re-polling
                await self.queue.enqueue_poll(job_id)
                logger.info(f"Re-enqueued job {job_id} for polling (status: {status})")

        except Exception as e:
            logger.exception(f"Failed to poll job {job_id}: {e}")
            await self.queue.update_task_status(job_id, "failed", str(e))


_worker: VideoEffectsWorker | None = None


async def start_worker() -> VideoEffectsWorker:
    """Start the global video effects worker."""
    global _worker

    if _worker is None:
        queue = await get_task_queue()
        _worker = VideoEffectsWorker(queue)
        await _worker.start()

    return _worker


async def stop_worker() -> None:
    """Stop the global video effects worker."""
    global _worker

    if _worker is not None:
        await _worker.stop()
        _worker = None
