from __future__ import annotations

import inspect
import json
import logging
from typing import Any, Literal

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.graph import END, START, MessagesState, StateGraph

from .api_key_provider import (
    get_current_key,
    init_api_key_provider,
    is_quota_exhausted,
    keys_count,
    reset_key_index_to_zero,
    rotate_next_key,
)
from .checkpoint import create_checkpointer
from .config import Settings, get_settings
from .prompts import get_system_prompt
from .tools import get_registered_tools, get_tools_by_name

logger = logging.getLogger(__name__)


def _build_media_message(result: dict[str, Any], source_tool: str | None = None) -> HumanMessage | None:
    """Build a HumanMessage with media content for injection after tool result.
    
    When previewTimeline/inspectAsset return _injectMedia: True, we inject the media as a
    HumanMessage so the model sees/hears it. LangChain's Google GenAI adapter supports
    multimodal HumanMessage (file_uri), so the model receives the video/audio/image.
    (The Next.js app uses a patched @ai-sdk/google that sends media inside the tool
    result instead; both approaches deliver the media to Gemini.)
    
    Returns HumanMessage with media, or None if not a media injection result.
    """
    if not result.get("_injectMedia") or not result.get("fileUri"):
        return None
    
    file_uri = result["fileUri"]
    mime_type = result.get("mimeType", "application/octet-stream")
    asset_name = result.get("assetName", "asset")
    start_offset = result.get("startOffset")
    end_offset = result.get("endOffset")
    preview_only = source_tool == "previewTimeline"
    
    # Build text description
    if preview_only:
        text = (
            f"INTERNAL PREVIEW for '{asset_name}'. "
            "This video is only for your self-review of the timeline. "
            "Do NOT call sendAttachment or share the file with the user unless they explicitly request it."
        )
    elif start_offset or end_offset:
        text = f"Here is the video segment ({start_offset or '0s'} - {end_offset or 'end'}) for '{asset_name}':"
    else:
        text = f"Here is the media '{asset_name}':"
    
    # Build content with file reference
    # For Gemini Files API, use media type with file_uri
    content: list[dict[str, Any]] = [
        {"type": "text", "text": text},
        {
            "type": "media",
            "mime_type": mime_type,
            "file_uri": file_uri,
        },
    ]
    
    # Add video metadata for time range if specified
    # Note: This may require langchain-google-genai support for videoMetadata
    if start_offset or end_offset:
        logger.info("[AGENT] Media injection with time range: %s - %s", start_offset, end_offset)
    if preview_only:
        logger.info("[AGENT] previewTimeline marked as internal-only media injection")
    
    return HumanMessage(content=content)


def build_model(settings: Settings, api_key: str, model_id: str | None = None) -> ChatGoogleGenerativeAI:
    """Instantiate the Gemini chat model with the given API key and optional model_id."""
    model = model_id or settings.gemini_model
    return ChatGoogleGenerativeAI(
        model=model,
        api_key=api_key,
        convert_system_message_to_human=True,
        timeout=60,  # 60 second timeout per request
        max_retries=2,  # Only retry twice (3 total attempts) to avoid blocking server
        thinking_level="high",
        include_thoughts=True,
    )


def create_graph(settings: Settings | None = None):
    resolved_settings = settings or get_settings()
    init_api_key_provider(resolved_settings)
    tools = get_registered_tools()
    tools_by_name = get_tools_by_name()
    system_prompt_text = get_system_prompt(override=resolved_settings.system_prompt)
    system_message = SystemMessage(content=system_prompt_text)
    n_keys = max(1, keys_count())

    chat_model_ids = resolved_settings.chat_model_ids

    async def call_model(state: MessagesState, config: RunnableConfig):
        messages = [system_message] + list(state["messages"])
        last_exc: BaseException | None = None
        for model_idx, model_id in enumerate(chat_model_ids):
            if model_idx > 0:
                logger.info("[AGENT] Trying model %s (fallback %d)", model_id, model_idx + 1)
            for attempt in range(n_keys):
                api_key = get_current_key()
                if not api_key:
                    raise RuntimeError("No Gemini API key configured (GOOGLE_API_KEY or GEMINI_API_KEYS)")
                model = build_model(resolved_settings, api_key, model_id=model_id)
                model_with_tools = model.bind_tools(tools)
                try:
                    response = await model_with_tools.ainvoke(messages, config=config)
                    return {"messages": [response]}
                except Exception as e:
                    last_exc = e
                    if is_quota_exhausted(e) and keys_count() > 1:
                        logger.warning("[AGENT] Quota exhausted (429), rotating to next API key: %s", e)
                        rotate_next_key()
                        continue
                    if model_idx < len(chat_model_ids) - 1:
                        logger.warning("[AGENT] Model %s failed: %s", model_id, e)
                    raise
        if last_exc is not None:
            reset_key_index_to_zero()
            raise last_exc
        return {"messages": []}

    def call_tool(state: MessagesState, config: RunnableConfig):
        tool_outputs: list[ToolMessage | HumanMessage] = []
        media_to_inject: list[HumanMessage] = []
        last_message = state["messages"][-1]

        # Extract context from runtime (passed via graph.stream(..., context={...}))
        # Falls back to reading directly from configurable (for ainvoke() calls)
        runtime = config.get("configurable", {}).get("__pregel_runtime")
        ctx = getattr(runtime, "context", None) or {}
        configurable = config.get("configurable", {})
        
        thread_id = ctx.get("thread_id") or configurable.get("thread_id")
        user_id = ctx.get("user_id") or configurable.get("user_id")
        project_id = ctx.get("project_id") or configurable.get("project_id")
        branch_id = ctx.get("branch_id") or configurable.get("branch_id")
        
        logger.info("[AGENT] call_tool: context = thread_id=%s, user_id=%s, project_id=%s, branch_id=%s",
                    thread_id, user_id, project_id, branch_id)
        
        # Sort tool calls so that state-reading tools (previewTimeline) always
        # run after state-writing tools (edit/add/delete).  This avoids a race
        # condition where a preview renders stale state because Gemini placed
        # the preview call before the edits in the same parallel batch.
        _DEFERRED_TOOLS = {"previewTimeline"}
        sorted_tool_calls = sorted(
            last_message.tool_calls,
            key=lambda tc: tc["name"] in _DEFERRED_TOOLS,
        )

        for tool_call in sorted_tool_calls:
            tool = tools_by_name.get(tool_call["name"])
            tool_name = tool_call["name"]
            logger.info("[AGENT] Executing tool: %s", tool_name)
            
            if not tool:
                observation: str = f"Requested tool '{tool_name}' is not available."
                logger.warning("[AGENT] Tool not found: %s", tool_name)
            else:
                try:
                    args = dict(tool_call.get("args") or {})
                    # SECURITY: Inject context from session only; never use LLM-provided user_id/project_id
                    args["_agent_context"] = {
                        "thread_id": thread_id,
                        "project_id": project_id,
                        "user_id": user_id,
                        "branch_id": branch_id,
                    }
                    logger.info("[AGENT] Tool args (with context): %s", str(args)[:500])
                    # Invoke the tool's function directly with full args so _agent_context
                    # is passed through. tool.invoke() validates args against the schema and
                    # strips keys not in the schema (e.g. _agent_context), so tools would
                    # get _agent_context=None when called via invoke().
                    if isinstance(tool, StructuredTool) and hasattr(tool, "func"):
                        sig = inspect.signature(tool.func)
                        allowed = {k for k in sig.parameters}
                        filtered = {k: v for k, v in args.items() if k in allowed}
                        result = tool.func(**filtered)
                    else:
                        result = tool.invoke(args, config=config)
                    
                    # Check if this result needs media injection (previewTimeline/inspectAsset)
                    # We inject media as HumanMessage; langchain-google-genai supports
                    # multimodal user messages (file_uri), so the model receives the media
                    if isinstance(result, dict) and result.get("_injectMedia"):
                        media_msg = _build_media_message(result, source_tool=tool_name)
                        if media_msg:
                            media_to_inject.append(media_msg)
                            logger.info("[AGENT] Media injection queued for: %s", result.get("assetName"))
                        # Return text-only observation for the ToolMessage
                        observation = result.get("message", "Asset loaded.")
                    else:
                        observation = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
                    logger.info("[AGENT] Tool result: %s", str(observation)[:500] if len(str(observation)) > 500 else observation)
                except Exception as exc:  # pragma: no cover - surface tool exceptions
                    logger.exception("[AGENT] Tool execution failed: %s", tool_name)
                    observation = f"Tool '{tool_name}' failed: {exc}"
            tool_outputs.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))
        
        # Append media messages after tool outputs so model sees them in next turn
        if media_to_inject:
            logger.info("[AGENT] Injecting %d media message(s)", len(media_to_inject))
            tool_outputs.extend(media_to_inject)
        
        return {"messages": tool_outputs}

    def should_continue(state: MessagesState) -> Literal["tool_node", END]:
        last_message = state["messages"][-1]
        if last_message.tool_calls:
            return "tool_node"
        return END

    workflow = StateGraph(MessagesState)
    workflow.add_node("model", call_model)
    workflow.add_node("tool_node", call_tool)
    workflow.add_edge(START, "model")
    workflow.add_conditional_edges("model", should_continue, ["tool_node", END])
    workflow.add_edge("tool_node", "model")

    # Connect checkpointer for conversation persistence
    checkpointer = create_checkpointer(resolved_settings)
    compiled = workflow.compile(checkpointer=checkpointer)

    if resolved_settings.default_project_id:
        compiled = compiled.with_config(
            configurable={
                "project_id": resolved_settings.default_project_id,
            }
        )

    return compiled


settings = get_settings()
graph = create_graph(settings)
