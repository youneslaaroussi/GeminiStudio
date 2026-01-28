from __future__ import annotations

import json
import logging
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException, Request, status
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from .agent import graph
from .chat import build_dispatcher
from .config import Settings, get_settings
from .schemas import HealthResponse, InvokeRequest, InvokeResponse, MessageEnvelope, TeleportRequest, TeleportResponse

router = APIRouter()

logger = logging.getLogger(__name__)


def _coerce_content(value) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def _as_langchain_messages(raw: Iterable[MessageEnvelope]) -> list:
    messages = []
    for envelope in raw:
        if envelope.role == "user":
            messages.append(HumanMessage(content=envelope.content))
        elif envelope.role == "assistant":
            messages.append(AIMessage(content=envelope.content))
        elif envelope.role == "tool":
            if not envelope.tool_call_id:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="tool messages must include tool_call_id",
                )
            messages.append(ToolMessage(content=envelope.content, tool_call_id=envelope.tool_call_id))
        else:
            messages.append(SystemMessage(content=envelope.content))
    return messages


def _as_envelopes(messages: Iterable) -> list[MessageEnvelope]:
    envelopes: list[MessageEnvelope] = []
    for message in messages:
        role = "assistant"
        if isinstance(message, HumanMessage):
            role = "user"
        elif isinstance(message, SystemMessage):
            role = "system"
        elif isinstance(message, ToolMessage):
            role = "tool"
            envelopes.append(
                MessageEnvelope(role=role, content=_coerce_content(message.content), tool_call_id=message.tool_call_id)
            )
            continue
        envelopes.append(MessageEnvelope(role=role, content=_coerce_content(message.content)))
    return envelopes


@router.get("/healthz", response_model=HealthResponse)
def healthcheck() -> HealthResponse:
    return HealthResponse()


@router.post("/invoke", response_model=InvokeResponse)
def invoke(
    payload: InvokeRequest,
    settings: Settings = Depends(get_settings),
):
    configurable: dict[str, str] = {"thread_id": payload.thread_id}
    if settings.default_project_id:
        configurable.setdefault("project_id", settings.default_project_id)

    config: RunnableConfig = {"configurable": configurable}

    inputs = {"messages": _as_langchain_messages(payload.messages)}
    try:
        result = graph.invoke(inputs, config=config)
    except Exception as exc:  # pragma: no cover - fastapi handles formatting
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    return InvokeResponse(thread_id=payload.thread_id, messages=_as_envelopes(result["messages"]))


@router.post("/teleport", response_model=TeleportResponse)
def teleport(payload: TeleportRequest):
    """
    Teleport endpoint to continue a chat session from the cloud.

    For now, this just logs the chat_id and returns success.
    In the future, this will load the chat session and initialize
    the LangGraph agent with the conversation history.
    """
    logger.info(f"Teleport requested for chat_id: {payload.chat_id}")

    # TODO: In the future, implement actual teleport logic:
    # 1. Fetch the chat session from Firebase using chat_id
    # 2. Convert messages to LangChain format
    # 3. Initialize the agent with the conversation history
    # 4. Return thread_id for continuing the conversation

    return TeleportResponse(
        success=True,
        chat_id=payload.chat_id,
        message="Teleport successful (stub implementation)"
    )


@router.post("/providers/telegram/webhook")
async def telegram_webhook(request: Request, settings: Settings = Depends(get_settings)):
    if not settings.telegram_bot_token:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Telegram provider is not configured.")

    secret_header = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
    if settings.telegram_webhook_secret and secret_header != settings.telegram_webhook_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook secret.")

    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload.") from exc

    dispatcher = build_dispatcher(settings)
    try:
        await dispatcher.handle_update("telegram", payload)
    except Exception as exc:
        logger.exception("Telegram handler failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    return {"ok": True}
