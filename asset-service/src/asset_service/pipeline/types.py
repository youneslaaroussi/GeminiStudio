"""Pipeline type definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Awaitable, Protocol


class AssetType(str, Enum):
    """Asset type classification."""

    VIDEO = "video"
    AUDIO = "audio"
    IMAGE = "image"
    OTHER = "other"


class StepStatus(str, Enum):
    """Pipeline step status."""

    IDLE = "idle"
    RUNNING = "running"
    WAITING = "waiting"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass
class StoredAsset:
    """Asset information from storage."""

    id: str
    name: str
    file_name: str
    mime_type: str
    size: int
    uploaded_at: str = ""
    gcs_uri: str | None = None
    object_name: str | None = None
    signed_url: str | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    source: str = "api"
    # Transcode-related fields
    transcoded: bool = False
    original_gcs_uri: str | None = None
    original_object_name: str | None = None
    original_signed_url: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> StoredAsset:
        """Create from dictionary."""
        return cls(
            id=data["id"],
            name=data["name"],
            file_name=data.get("fileName", data.get("file_name", "")),
            mime_type=data.get("mimeType", data.get("mime_type", "")),
            size=data.get("size", 0),
            uploaded_at=data.get("uploadedAt", data.get("uploaded_at", "")),
            gcs_uri=data.get("gcsUri", data.get("gcs_uri")),
            object_name=data.get("objectName", data.get("object_name")),
            signed_url=data.get("signedUrl", data.get("signed_url")),
            width=data.get("width"),
            height=data.get("height"),
            duration=data.get("duration"),
            source=data.get("source", "api"),
            transcoded=data.get("transcoded", False),
            original_gcs_uri=data.get("originalGcsUri", data.get("original_gcs_uri")),
            original_object_name=data.get("originalObjectName", data.get("original_object_name")),
            original_signed_url=data.get("originalSignedUrl", data.get("original_signed_url")),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary (camelCase for Firestore compatibility)."""
        result = {
            "id": self.id,
            "name": self.name,
            "fileName": self.file_name,
            "mimeType": self.mime_type,
            "size": self.size,
            "uploadedAt": self.uploaded_at,
            "gcsUri": self.gcs_uri,
            "objectName": self.object_name,
            "signedUrl": self.signed_url,
            "width": self.width,
            "height": self.height,
            "duration": self.duration,
            "source": self.source,
            "transcoded": self.transcoded,
        }
        if self.original_gcs_uri:
            result["originalGcsUri"] = self.original_gcs_uri
        if self.original_object_name:
            result["originalObjectName"] = self.original_object_name
        if self.original_signed_url:
            result["originalSignedUrl"] = self.original_signed_url
        return result


@dataclass
class PipelineStepState:
    """State of a single pipeline step."""

    id: str
    label: str
    status: StepStatus = StepStatus.IDLE
    metadata: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    started_at: str | None = None
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PipelineStepState:
        """Create from dictionary."""
        return cls(
            id=data["id"],
            label=data["label"],
            status=StepStatus(data.get("status", "idle")),
            metadata=data.get("metadata", {}),
            error=data.get("error"),
            started_at=data.get("startedAt", data.get("started_at")),
            updated_at=data.get("updatedAt", data.get("updated_at", datetime.utcnow().isoformat() + "Z")),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary (camelCase for Firestore compatibility)."""
        result = {
            "id": self.id,
            "label": self.label,
            "status": self.status.value,
            "metadata": self.metadata,
            "updatedAt": self.updated_at,
        }
        if self.error:
            result["error"] = self.error
        if self.started_at:
            result["startedAt"] = self.started_at
        return result


@dataclass
class PipelineContext:
    """Context passed to pipeline step runners."""

    asset: StoredAsset
    asset_path: str
    asset_type: AssetType
    step_state: PipelineStepState
    user_id: str
    project_id: str
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class PipelineResult:
    """Result returned from a pipeline step."""

    status: StepStatus
    metadata: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class PipelineStep(Protocol):
    """Protocol for pipeline steps."""

    id: str
    label: str
    description: str
    auto_start: bool
    supported_types: list[AssetType] | None

    async def run(self, context: PipelineContext) -> PipelineResult:
        """Execute the pipeline step."""
        ...
