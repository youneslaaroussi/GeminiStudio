from __future__ import annotations

import json
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException, status
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from .agent import graph
from .config import Settings, get_settings
from .schemas import HealthResponse, InvokeRequest, InvokeResponse, MessageEnvelope

router = APIRouter()


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
    _settings: Settings = Depends(get_settings),
):
    config: RunnableConfig = {"configurable": {"thread_id": payload.thread_id}}

    inputs = {"messages": _as_langchain_messages(payload.messages)}
    try:
        result = graph.invoke(inputs, config=config)
    except Exception as exc:  # pragma: no cover - fastapi handles formatting
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    return InvokeResponse(thread_id=payload.thread_id, messages=_as_envelopes(result["messages"]))
