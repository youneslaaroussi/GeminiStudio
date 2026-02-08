"""Generate a project title from conversation context using a small Gemini model.

The model may reject (accepted=False) if there is not enough context (e.g. user said "hi").
Caller should retry on subsequent messages until accepted.
"""

from __future__ import annotations

import json
import logging
import re
from typing import TypedDict

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage

from .api_key_provider import (
    get_current_key,
    is_quota_exhausted,
    keys_count,
    rotate_next_key,
)
from .config import Settings, get_settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You suggest a short project title for a video editing app based on the user's message(s).

Rules:
- If the message has enough substance to derive a project topic (e.g. "make a travel vlog about Japan", "edit my interview clip"), respond with JSON only: {"accepted": true, "title": "Short Title Here"}. Keep title under 50 characters, no quotes in the title.
- If the message is too vague (e.g. "hi", "hello", "thanks", "ok"), respond with JSON only: {"accepted": false, "reason": "Not enough context"}.
- Output only valid JSON, no markdown or extra text."""


class TitleResult(TypedDict, total=False):
    accepted: bool
    title: str
    reason: str


def _build_title_model(settings: Settings, api_key: str) -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model=settings.gemini_title_model or "gemini-2.0-flash",
        api_key=api_key,
        timeout=15,
        max_retries=1,
    )


async def generate_project_title(
    context: str,
    settings: Settings | None = None,
) -> TitleResult:
    """Call the title model with conversation context. Returns accepted + title or reason."""
    resolved = settings or get_settings()
    if not get_current_key():
        return TitleResult(accepted=False, reason="Title model not configured")
    text = (context or "").strip()
    if not text:
        return TitleResult(accepted=False, reason="Empty context")
    n_keys = max(1, keys_count())
    last_exc: BaseException | None = None
    for _ in range(n_keys):
        api_key = get_current_key()
        if not api_key:
            return TitleResult(accepted=False, reason="Title model not configured")
        model = _build_title_model(resolved, api_key)
        try:
            prompt = f"{SYSTEM_PROMPT}\n\nConversation context:\n\n{text}"
            response = await model.ainvoke([HumanMessage(content=prompt)])
            content = getattr(response, "content", None)
            if isinstance(content, str):
                raw = content
            elif isinstance(content, list) and content:
                part = content[0]
                raw = part.get("text", str(part)) if isinstance(part, dict) else str(part)
            else:
                raw = str(content) if content else ""
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw).strip()
            if not raw:
                return TitleResult(accepted=False, reason="No response from model")
            parsed = json.loads(raw)
            accepted = parsed.get("accepted") is True
            title = (parsed.get("title") or "").strip()[:100]
            reason = (parsed.get("reason") or "").strip()
            if accepted and title:
                return TitleResult(accepted=True, title=title)
            return TitleResult(accepted=False, reason=reason or "Not enough context")
        except json.JSONDecodeError as e:
            logger.debug("Title model returned invalid JSON: %s", e)
            return TitleResult(accepted=False, reason="Invalid model response")
        except Exception as e:
            last_exc = e
            if is_quota_exhausted(e) and keys_count() > 1:
                logger.debug("Title model 429, rotating key: %s", e)
                rotate_next_key()
                continue
            logger.debug("Title model call failed: %s", e)
            return TitleResult(accepted=False, reason="Title generation failed")
    return TitleResult(accepted=False, reason="Title generation failed")
