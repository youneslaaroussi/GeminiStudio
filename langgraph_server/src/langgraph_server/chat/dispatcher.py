from __future__ import annotations

from typing import Any, Dict

from .base import ChatProvider
from .types import OutgoingMessage


class ChatDispatcher:
    def __init__(self) -> None:
        self._providers: Dict[str, ChatProvider] = {}

    def register(self, provider: ChatProvider) -> None:
        self._providers[provider.name] = provider

    def get(self, name: str) -> ChatProvider | None:
        return self._providers.get(name)

    async def handle_update(self, provider_name: str, payload: Any) -> list[OutgoingMessage]:
        provider = self.get(provider_name)
        if not provider:
            raise ValueError(f"Provider '{provider_name}' is not registered.")
        responses = await provider.handle_update(payload)
        return list(responses)
