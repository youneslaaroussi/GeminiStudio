from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class MessageEnvelope(BaseModel):
    """Serializable message payload."""

    role: Literal["user", "assistant", "system", "tool"]
    content: str
    tool_call_id: str | None = None


class InvokeRequest(BaseModel):
    thread_id: str = Field(..., description="Unique identifier for persistent thread state")
    messages: list[MessageEnvelope]


class InvokeResponse(BaseModel):
    messages: list[MessageEnvelope]
    thread_id: str


class HealthResponse(BaseModel):
    status: str = "ok"
