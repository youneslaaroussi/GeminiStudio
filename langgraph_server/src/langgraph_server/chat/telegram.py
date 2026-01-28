from __future__ import annotations

from typing import Callable, Iterable, Optional

import httpx

from ..config import Settings
from ..firebase import lookup_email_by_phone
from ..phone import extract_phone_number
from .base import ChatProvider
from .types import IncomingMessage, OutgoingMessage


class TelegramProvider(ChatProvider):
    def __init__(
        self,
        settings: Settings,
        *,
        api_base_url: str | None = None,
        email_lookup: Callable[[str], Optional[str]] | None = None,
    ) -> None:
        super().__init__("telegram")
        self.settings = settings
        self.bot_token = settings.telegram_bot_token
        self.secret_token = settings.telegram_webhook_secret
        self.api_base_url = api_base_url or "https://api.telegram.org"
        self.email_lookup = email_lookup or (lambda phone: lookup_email_by_phone(phone, settings))
        if not self.bot_token:
            raise ValueError("Telegram bot token is not configured.")

    async def parse_update(self, payload: dict) -> Iterable[IncomingMessage]:
        message = payload.get("message") or payload.get("edited_message")
        if not message:
            return []
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id"))
        text = message.get("text")
        metadata = {
            "username": chat.get("username"),
            "first_name": chat.get("first_name"),
            "last_name": chat.get("last_name"),
        }

        return [
            IncomingMessage(
                provider=self.name,
                sender_id=chat_id,
                text=text,
                metadata=metadata,
            )
        ]

    async def handle_update(self, payload: dict) -> Iterable[OutgoingMessage]:
        messages = await self.parse_update(payload)
        responses: list[OutgoingMessage] = []
        for message in messages:
            response_text = await self._build_response(message)
            responses.append(
                OutgoingMessage(
                    provider=self.name,
                    recipient_id=message.sender_id,
                    text=response_text,
                )
            )
        await self.dispatch_responses(responses)
        return responses

    async def dispatch_responses(self, messages: Iterable[OutgoingMessage]) -> None:
        async with httpx.AsyncClient(base_url=f"{self.api_base_url}/bot{self.bot_token}") as client:
            for message in messages:
                payload = {
                    "chat_id": message.recipient_id,
                    "text": message.text,
                }
                response = await client.post("/sendMessage", json=payload, timeout=10.0)
                response.raise_for_status()

    async def _build_response(self, message: IncomingMessage) -> str:
        text = (message.text or "").strip()
        if not text:
            return "Please send a phone number so I can look up your account."

        phone = extract_phone_number(
            text,
            default_region=self.settings.default_phone_region,
        )
        if not phone:
            return "I couldn't find a valid phone number in your message. Please send it in international format (e.g. +15551234567)."

        email = self.email_lookup(phone)
        if not email:
            return "Sorry, I couldn't find an account associated with that phone number."

        return f"The email address linked to {phone} is {email}."
