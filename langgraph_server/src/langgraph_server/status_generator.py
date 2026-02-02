"""Generate short status messages (Thinking…, Calling X…) using the status Gemini model.

Always uses GEMINI_STATUS_MODEL (default gemini-2.5-flash). No fallbacks: if the model
is unavailable or the call fails, returns an empty string.
"""

from __future__ import annotations

import logging
import re
from typing import Literal

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage

from .config import Settings, get_settings

logger = logging.getLogger(__name__)

_STATUS_PROMPT_THINKING = """You are generating a one-line status message for a video-editing assistant. The agent is thinking about the user's request. Generate exactly one short, friendly line (under 60 chars) with one emoji. Output only the message, no quotes or markdown."""

_STATUS_PROMPT_TOOL = """You are generating a one-line status message for a video-editing assistant. The agent is calling the tool: {tool_name}. Generate exactly one short, friendly line (under 60 chars) with one emoji. Output only the message, no quotes or markdown."""


def _build_status_model(settings: Settings) -> ChatGoogleGenerativeAI | None:
    if not settings.gemini_status_model or not settings.google_api_key:
        return None
    return ChatGoogleGenerativeAI(
        model=settings.gemini_status_model,
        api_key=settings.google_api_key,
        timeout=15,
        max_retries=1,
    )


def _sanitize(msg: str) -> str:
    if not msg or not isinstance(msg, str):
        return ""
    msg = re.sub(r"\s+", " ", msg).strip()
    return msg[:80] if len(msg) > 80 else msg


async def _call_model(
    context: Literal["thinking", "tool"],
    tool_name: str | None,
    settings: Settings,
) -> str | None:
    model = _build_status_model(settings)
    if not model:
        logger.warning("GEMINI_STATUS_MODEL not set; status messages will be empty")
        return None
    try:
        if context == "thinking":
            prompt = _STATUS_PROMPT_THINKING
        else:
            prompt = _STATUS_PROMPT_TOOL.format(tool_name=tool_name or "tool")
        response = await model.ainvoke([HumanMessage(content=prompt)])
        content = getattr(response, "content", None)
        if isinstance(content, str):
            text = content
        elif isinstance(content, list) and content:
            part = content[0]
            text = part.get("text", str(part)) if isinstance(part, dict) else str(part)
        else:
            text = str(content) if content else ""
        msg = _sanitize(text)
        return msg if msg else None
    except Exception as e:
        logger.debug("Status model call failed: %s", e)
        return None


async def generate_status_message(
    context: Literal["thinking", "tool"],
    tool_name: str | None = None,
    for_telegram: bool = False,
    settings: Settings | None = None,
) -> str:
    """Generate a short status message using the status model. Returns empty string if model unavailable or call fails."""
    resolved = settings or get_settings()
    msg = await _call_model(context, tool_name, resolved)
    return msg or ""


async def generate_status_message_pair(
    context: Literal["thinking", "tool"],
    tool_name: str | None = None,
    settings: Settings | None = None,
) -> tuple[str, str]:
    """Return (plain, telegram) status message. Same text for both. Empty strings if model unavailable or call fails."""
    resolved = settings or get_settings()
    msg = await _call_model(context, tool_name, resolved)
    return (msg or "", msg or "")
