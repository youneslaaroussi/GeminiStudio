from __future__ import annotations

from .dispatcher import ChatDispatcher
from .telegram import TelegramProvider
from ..config import Settings

_dispatcher: ChatDispatcher | None = None


def build_dispatcher(settings: Settings) -> ChatDispatcher:
    """Build and cache a singleton ChatDispatcher with registered providers."""
    global _dispatcher
    if _dispatcher is not None:
        return _dispatcher
    dispatcher = ChatDispatcher()
    if settings.telegram_bot_token:
        dispatcher.register(
            TelegramProvider(
                settings,
                api_base_url=settings.telegram_api_base_url,
            )
        )
    _dispatcher = dispatcher
    return dispatcher


__all__ = [
    "ChatDispatcher",
    "build_dispatcher",
]
