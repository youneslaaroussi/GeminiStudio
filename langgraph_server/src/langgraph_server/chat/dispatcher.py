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
        
        # Check if this is a reaction update (provider-specific)
        # For now, providers handle reactions in handle_update, but we could add
        # a separate handle_reaction call here if needed
        responses = await provider.handle_update(payload)
        return list(responses)
    
    async def handle_reaction(self, provider_name: str, payload: Any) -> None:
        """Handle reactions to bot messages."""
        provider = self.get(provider_name)
        if not provider:
            raise ValueError(f"Provider '{provider_name}' is not registered.")
        await provider.handle_reaction(payload)
