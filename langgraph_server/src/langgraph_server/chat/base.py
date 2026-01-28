from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Iterable

from .types import IncomingMessage, OutgoingMessage


class ChatProvider(ABC):
    """Base class for chat providers that can ingest updates and emit responses."""

    name: str

    def __init__(self, name: str) -> None:
        self.name = name

    @abstractmethod
    async def parse_update(self, payload: Any) -> Iterable[IncomingMessage]:
        """Transform a raw webhook payload into normalized incoming messages."""

    @abstractmethod
    async def dispatch_responses(self, messages: Iterable[OutgoingMessage]) -> None:
        """Send messages back to the provider."""

    async def handle_update(self, payload: Any) -> Iterable[OutgoingMessage]:
        """Default handling: parse incoming messages and no-op."""
        _ = await self.parse_update(payload)
        return []
