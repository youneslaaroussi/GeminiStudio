from __future__ import annotations

import json
from typing import Any, Iterable, Mapping, Sequence, cast

from google.cloud import storage
from google.cloud.exceptions import NotFound
from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)
from langgraph.checkpoint.memory import InMemorySaver

try:  # Postgres saver is optional; requires langgraph-checkpoint extras.
    from langgraph.checkpoint.postgres import PostgresSaver  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    PostgresSaver = None  # type: ignore[assignment]
from langchain_core.runnables import RunnableConfig
from datetime import datetime, timezone

from .config import Settings


class GCSCheckpointSaver(BaseCheckpointSaver):
    """Store checkpoints in a Google Cloud Storage bucket."""

    def __init__(
        self,
        bucket_name: str,
        *,
        prefix: str = "langgraph/checkpoints",
    ) -> None:
        super().__init__()
        self.client = storage.Client()
        self.bucket = self.client.bucket(bucket_name)
        self.prefix = prefix.strip("/")

    def _serialize(self, data: Any) -> bytes:
        """Serialize data using the serde protocol."""
        type_str, payload = self.serde.dumps_typed(data)
        # Store type and payload together as JSON
        return json.dumps({"t": type_str, "d": payload.decode("latin-1")}).encode()

    def _deserialize(self, data: bytes) -> Any:
        """Deserialize data using the serde protocol."""
        wrapper = json.loads(data.decode())
        return self.serde.loads_typed((wrapper["t"], wrapper["d"].encode("latin-1")))

    def _thread_key(self, config: RunnableConfig) -> str:
        configurable = config.get("configurable") or {}
        thread_id = configurable.get("thread_id")
        if not thread_id:
            raise ValueError("thread_id missing from RunnableConfig.configurable")
        namespace = configurable.get("checkpoint_ns", "")
        ns_segment = f"{namespace}/" if namespace else ""
        return f"{self.prefix}/{thread_id}/{ns_segment}"

    def _checkpoint_path(self, config: RunnableConfig, checkpoint_id: str) -> str:
        return f"{self._thread_key(config)}checkpoints/{checkpoint_id}.json"

    def _writes_path(self, config: RunnableConfig, checkpoint_id: str) -> str:
        return f"{self._thread_key(config)}writes/{checkpoint_id}.json"

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: Mapping[str, str | int],
    ) -> RunnableConfig:
        data = {
            "checkpoint": checkpoint,
            "metadata": metadata or {},
            "new_versions": dict(new_versions) if new_versions else {},
            "written_at": datetime.now(timezone.utc).isoformat(),
        }
        payload = self._serialize(data)
        blob = self.bucket.blob(self._checkpoint_path(config, checkpoint["id"]))
        blob.upload_from_string(payload)
        # Return updated config with checkpoint_id
        return {
            "configurable": {
                **(config.get("configurable") or {}),
                "checkpoint_id": checkpoint["id"],
            }
        }

    async def aput(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: Mapping[str, str | int],
    ) -> RunnableConfig:
        return self.put(config, checkpoint, metadata, new_versions)

    def put_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        # Get checkpoint_id from config if available
        configurable = config.get("configurable") or {}
        checkpoint_id = configurable.get("checkpoint_id") or task_id
        data = {
            "writes": list(writes),
            "task_id": task_id,
            "task_path": task_path,
            "checkpoint_id": checkpoint_id,
            "written_at": datetime.now(timezone.utc).isoformat(),
        }
        payload = self._serialize(data)
        blob = self.bucket.blob(self._writes_path(config, checkpoint_id))
        blob.upload_from_string(payload)

    async def aput_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        self.put_writes(config, writes, task_id, task_path)

    def get_tuple(
        self,
        config: RunnableConfig,
        /,
        *,
        checkpoint: Checkpoint | None = None,
        configured_id: str | None = None,
    ) -> CheckpointTuple | None:
        checkpoint_id = checkpoint["id"] if checkpoint else configured_id
        if not checkpoint_id:
            return None
        try:
            blob = self.bucket.blob(self._checkpoint_path(config, checkpoint_id))
            payload = blob.download_as_bytes()
            record = self._deserialize(payload)
        except NotFound:
            return None

        checkpoint_value: Checkpoint = record["checkpoint"]
        metadata = cast(CheckpointMetadata, record.get("metadata") or {})

        try:
            writes_blob = self.bucket.blob(self._writes_path(config, checkpoint_id))
            writes_payload = writes_blob.download_as_bytes()
            writes_record = self._deserialize(writes_payload)
            writes = tuple(writes_record.get("writes", ()))
        except NotFound:
            writes = ()

        pending = list(writes) if writes else None
        return CheckpointTuple(config=config, checkpoint=checkpoint_value, metadata=metadata, pending_writes=pending)

    async def aget_tuple(
        self,
        config: RunnableConfig,
        /,
        *,
        checkpoint: Checkpoint | None = None,
        configured_id: str | None = None,
    ) -> CheckpointTuple | None:
        return self.get_tuple(config, checkpoint=checkpoint, configured_id=configured_id)

    def list(
        self,
        config: RunnableConfig,
        /,
        *,
        limit: int | None = None,
        before: str | None = None,
    ) -> Iterable[CheckpointTuple]:
        prefix = self._thread_key(config) + "checkpoints/"
        blobs = list(self.bucket.list_blobs(prefix=prefix))
        # Sort newest first to align with LangGraph expectations
        blobs.sort(key=lambda b: b.updated or b.time_created, reverse=True)
        results: list[CheckpointTuple] = []
        for blob in blobs:
            checkpoint_id = blob.name.rsplit("/", 1)[-1].removesuffix(".json")
            if before and checkpoint_id >= before:
                continue
            payload = blob.download_as_bytes()
            record = self._deserialize(payload)
            checkpoint_value: Checkpoint = record["checkpoint"]
            metadata = cast(CheckpointMetadata, record.get("metadata") or {})
            writes_blob = self.bucket.blob(self._writes_path(config, checkpoint_id))
            try:
                writes_payload = writes_blob.download_as_bytes()
                writes_record = self._deserialize(writes_payload)
                writes = tuple(writes_record.get("writes", ()))
            except NotFound:
                writes = ()
            pending = list(writes) if writes else None
            results.append(
                CheckpointTuple(
                    config=config,
                    checkpoint=checkpoint_value,
                    metadata=metadata,
                    pending_writes=pending,
                )
            )
            if limit and len(results) >= limit:
                break
        return results

    async def alist(
        self,
        config: RunnableConfig,
        /,
        *,
        limit: int | None = None,
        before: str | None = None,
    ) -> Iterable[CheckpointTuple]:
        return self.list(config, limit=limit, before=before)


def create_checkpointer(settings: Settings) -> BaseCheckpointSaver:
    """Build a checkpointer based on configuration."""

    backend = settings.checkpointer_backend
    if backend == "memory":
        return InMemorySaver()

    if backend == "postgres":
        if PostgresSaver is None:
            raise RuntimeError(
                "Postgres checkpointer requested but 'langgraph.checkpoint.postgres' is unavailable. "
                "Install the langgraph checkpoint Postgres extra, e.g. `pip install \"langgraph-checkpoint[postgres]\"`."
            )
        if not settings.database_url:
            raise ValueError("DATABASE_URL must be set when CHECKPOINTER_BACKEND=postgres")
        saver = PostgresSaver.from_conn_string(settings.database_url)
        saver.setup()
        return saver

    return GCSCheckpointSaver(bucket_name=settings.google_cloud_storage_bucket)
