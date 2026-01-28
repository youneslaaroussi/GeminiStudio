from __future__ import annotations

from .dispatcher import ChatDispatcher
from .telegram import TelegramProvider
from ..config import Settings


def build_dispatcher(settings: Settings) -> ChatDispatcher:
    dispatcher = ChatDispatcher()
    if settings.telegram_bot_token:
        dispatcher.register(
            TelegramProvider(
                settings,
                api_base_url=settings.telegram_api_base_url,
            )
        )
    return dispatcher


__all__ = [
    "ChatDispatcher",
    "build_dispatcher",
]
