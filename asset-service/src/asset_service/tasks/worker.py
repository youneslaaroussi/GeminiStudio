"""Background worker for processing pipeline tasks."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import threading
from typing import Any

from ..config import get_settings
from ..pipeline.registry import run_auto_steps, run_step
from ..pipeline.steps.transcode import run_transcode_for_asset
from ..pipeline.types import StoredAsset
from ..storage.firestore import get_asset
from ..storage.gcs import download_from_gcs
from .queue import TaskQueue, get_task_queue

logger = logging.getLogger(__name__)

# Global shutdown event for signaling threads to stop
_shutdown_event = threading.Event()


def is_shutting_down() -> bool:
    """Check if the service is shutting down."""
    return _shutdown_event.is_set()


def signal_shutdown() -> None:
    """Signal all workers to shut down."""
    _shutdown_event.set()


def reset_shutdown() -> None:
    """Reset the shutdown signal (for testing)."""
    _shutdown_event.clear()


class PipelineWorker:
    """Background worker that processes pipeline tasks from Redis queue."""

    def __init__(self, queue: TaskQueue):
        self.queue = queue
        self.running = False
        self._task: asyncio.Task | None = None
        self._shutdown_event = asyncio.Event()

    async def start(self) -> None:
        """Start the worker loop."""
        if self.running:
            logger.warning("Worker already running")
            return

        self.running = True
        self._shutdown_event.clear()
        reset_shutdown()  # Reset thread shutdown event
        self._task = asyncio.create_task(self._run())
        logger.info("Pipeline worker started")

    async def stop(self) -> None:
        """Stop the worker loop gracefully."""
        logger.info("Stopping pipeline worker...")
        self.running = False
        self._shutdown_event.set()
        signal_shutdown()  # Signal threads to stop
        
        if self._task:
            self._task.cancel()
            try:
                # Give it a short timeout to finish gracefully
                await asyncio.wait_for(asyncio.shield(self._task), timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
            except Exception as e:
                logger.warning(f"Error waiting for worker task: {e}")
        logger.info("Pipeline worker stopped")

    async def _run(self) -> None:
        """Main worker loop."""
        while self.running:
            try:
                # Use shorter timeout and check shutdown more frequently
                task = await self._dequeue_with_shutdown_check(timeout=1)
                if task is None:
                    continue

                if not self.running:
                    break

                await self._process_task(task)

            except asyncio.CancelledError:
                logger.info("Worker loop cancelled")
                break
            except Exception as e:
                logger.exception(f"Worker error: {e}")
                if self.running:
                    await asyncio.sleep(1)

    async def _dequeue_with_shutdown_check(self, timeout: int = 1) -> dict[str, Any] | None:
        """Dequeue with cancellation support."""
        try:
            # Wrap dequeue in wait_for to make it cancellable
            return await asyncio.wait_for(
                self.queue.dequeue(timeout=timeout),
                timeout=timeout + 1  # Slightly longer than Redis timeout
            )
        except asyncio.TimeoutError:
            return None
        except asyncio.CancelledError:
            raise

    async def _process_task(self, task: dict[str, Any]) -> None:
        """Process a single task."""
        task_id = task["id"]
        task_type = task["type"]
        payload = task["payload"]

        logger.info(f"Processing task {task_id} (type: {task_type})")

        try:
            await self.queue.update_task_status(task_id, "running")

            if task_type == "pipeline":
                await self._process_pipeline_task(payload)
            elif task_type == "transcode":
                await self._process_transcode_task(payload)
            elif task_type == "step":
                await self._process_step_task(payload)
            else:
                raise ValueError(f"Unknown task type: {task_type}")

            if not is_shutting_down():
                await self.queue.update_task_status(task_id, "completed")
                logger.info(f"Task {task_id} completed")

        except asyncio.CancelledError:
            logger.info(f"Task {task_id} cancelled due to shutdown")
            raise
        except Exception as e:
            logger.exception(f"Task {task_id} failed: {e}")
            if not is_shutting_down():
                await self.queue.update_task_status(task_id, "failed", str(e))

    async def _process_pipeline_task(self, payload: dict[str, Any]) -> None:
        """Process a full pipeline task."""
        user_id = payload["user_id"]
        project_id = payload["project_id"]
        asset_data = payload["asset_data"]
        asset_path = payload.get("asset_path")
        agent_metadata = payload.get("agent_metadata")

        asset = StoredAsset.from_dict(asset_data)

        # If no local path provided, download from GCS
        temp_path = None
        if not asset_path or not os.path.exists(asset_path):
            if is_shutting_down():
                raise asyncio.CancelledError("Shutdown in progress")
                
            gcs_uri = asset_data.get("gcsUri")
            if gcs_uri:
                settings = get_settings()
                # Run blocking GCS download in thread pool
                content = await asyncio.to_thread(download_from_gcs, gcs_uri, settings)
                suffix = os.path.splitext(asset.file_name)[1] or ""
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                    tmp.write(content)
                    temp_path = tmp.name
                asset_path = temp_path

        if not asset_path:
            raise ValueError("No asset file available for pipeline processing")

        if is_shutting_down():
            raise asyncio.CancelledError("Shutdown in progress")

        try:
            await run_auto_steps(
                user_id, project_id, asset, asset_path, agent_metadata
            )
        finally:
            # Clean up temp file
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

    async def _process_step_task(self, payload: dict[str, Any]) -> None:
        """Process a single step task."""
        user_id = payload["user_id"]
        project_id = payload["project_id"]
        asset_data = payload["asset_data"]
        step_id = payload["step_id"]
        params = payload.get("params", {})

        asset = StoredAsset.from_dict(asset_data)
        settings = get_settings()

        # Download asset from GCS in thread pool
        temp_path = None
        gcs_uri = asset_data.get("gcsUri")

        if gcs_uri:
            if is_shutting_down():
                raise asyncio.CancelledError("Shutdown in progress")
            content = await asyncio.to_thread(download_from_gcs, gcs_uri, settings)
            suffix = os.path.splitext(asset.file_name)[1] or ""
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(content)
                temp_path = tmp.name

        if not temp_path:
            raise ValueError("No asset file available for step processing")

        if is_shutting_down():
            raise asyncio.CancelledError("Shutdown in progress")

        try:
            # Run step directly in current event loop (no nested asyncio.run)
            await run_step(user_id, project_id, asset, temp_path, step_id, params)
        finally:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

    async def _process_transcode_task(self, payload: dict[str, Any]) -> None:
        """Process an on-demand transcode task."""
        user_id = payload["user_id"]
        project_id = payload["project_id"]
        asset_id = payload["asset_id"]
        params = payload.get("params", {})
        trigger_pipeline_after = payload.get("trigger_pipeline_after", False)

        from ..pipeline.types import StepStatus
        from ..pubsub import publish_pipeline_event

        result = await run_transcode_for_asset(user_id, project_id, asset_id, params)

        if result.status == StepStatus.SUCCEEDED:
            # Fetch fresh asset data after transcode
            settings = get_settings()
            fresh_asset = await asyncio.to_thread(
                get_asset, user_id, project_id, asset_id, settings
            )
            asset_name = fresh_asset.get("name") if fresh_asset else None

            # Publish transcode.completed event so consumers can act on the asset
            # before the full pipeline finishes
            publish_pipeline_event(
                event_type="transcode.completed",
                user_id=user_id,
                project_id=project_id,
                asset_id=asset_id,
                asset_name=asset_name,
                metadata={
                    "agent": payload.get("agent_metadata") or {},
                    "transcodeResult": result.metadata or {},
                },
            )
            logger.info(f"Published transcode.completed event for asset {asset_id}")

            # Queue pipeline if requested
            if trigger_pipeline_after and fresh_asset:
                await self.queue.enqueue_pipeline(
                    user_id=user_id,
                    project_id=project_id,
                    asset_id=asset_id,
                    asset_data=fresh_asset,
                    asset_path="",
                    agent_metadata=payload.get("agent_metadata"),
                )
                logger.info(f"Queued pipeline for asset {asset_id} after transcode")


_worker: PipelineWorker | None = None


async def start_worker() -> PipelineWorker:
    """Start the global pipeline worker."""
    global _worker

    if _worker is None:
        queue = await get_task_queue()
        _worker = PipelineWorker(queue)
        await _worker.start()

    return _worker


async def stop_worker() -> None:
    """Stop the global pipeline worker."""
    global _worker

    if _worker is not None:
        await _worker.stop()
        _worker = None
