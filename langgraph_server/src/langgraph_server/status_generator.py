"""Generate short status messages (Thinking…, Calling X…) using a small Gemini model.

When GEMINI_STATUS_MODEL is set (e.g. gemini-2.5-flash), calls the model with
thinking/tool context and returns a short, friendly message. Otherwise falls
back to static messages from agent_status.
"""

from __future__ import annotations

import logging
import re
from typing import Literal

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage

from .agent_status import get_thinking_message, get_tool_status_message
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
    """Single line, strip, cap length."""
    if not msg or not isinstance(msg, str):
        return ""
    msg = re.sub(r"\s+", " ", msg).strip()
    return msg[:80] if len(msg) > 80 else msg


async def generate_status_message(
    context: Literal["thinking", "tool"],
    tool_name: str | None = None,
    for_telegram: bool = False,
    settings: Settings | None = None,
) -> str:
    """Generate a short status message (LLM if configured, else static).

    Returns a single string suitable for Firebase (plain) or Telegram (caller
    can use the same or request for_telegram for italic hint; we use static
    for_telegram variant only when using fallback).
    """
    resolved = settings or get_settings()
    model = _build_status_model(resolved)

    if model is None:
        if context == "thinking":
            return get_thinking_message(for_telegram=for_telegram)
        return get_tool_status_message(tool_name or "tool", for_telegram=for_telegram)

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
        if msg:
            return msg
    except Exception as e:
        logger.debug("Status generator failed, using static message: %s", e)

    if context == "thinking":
        return get_thinking_message(for_telegram=for_telegram)
    return get_tool_status_message(tool_name or "tool", for_telegram=for_telegram)


async def generate_status_message_pair(
    context: Literal["thinking", "tool"],
    tool_name: str | None = None,
    settings: Settings | None = None,
) -> tuple[str, str]:
    """Return (plain, telegram) status message. Use when you need both (e.g. Firebase + Telegram)."""
    resolved = settings or get_settings()
    model = _build_status_model(resolved)

    if model is None:
        plain = get_thinking_message(False) if context == "thinking" else get_tool_status_message(tool_name or "tool", False)
        telegram = get_thinking_message(True) if context == "thinking" else get_tool_status_message(tool_name or "tool", True)
        return (plain, telegram)

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
        if msg:
            return (msg, msg)
    except Exception as e:
        logger.debug("Status generator failed, using static message: %s", e)

    plain = get_thinking_message(False) if context == "thinking" else get_tool_status_message(tool_name or "tool", False)
    telegram = get_thinking_message(True) if context == "thinking" else get_tool_status_message(tool_name or "tool", True)
    return (plain, telegram)
