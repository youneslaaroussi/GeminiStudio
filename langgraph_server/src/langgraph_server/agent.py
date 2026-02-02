from __future__ import annotations

import json
import logging
from typing import Literal

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import ToolMessage
from langgraph.graph import END, START, MessagesState, StateGraph

from .checkpoint import create_checkpointer
from .config import Settings, get_settings
from .prompts import get_system_prompt
from .tools import get_registered_tools, get_tools_by_name

logger = logging.getLogger(__name__)


def build_model(settings: Settings) -> ChatGoogleGenerativeAI:
    """Instantiate the Gemini chat model."""

    return ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        api_key=settings.google_api_key,
        convert_system_message_to_human=True,
        timeout=60,  # 60 second timeout per request
        max_retries=2,  # Only retry twice (3 total attempts) to avoid blocking server
    )


def create_graph(settings: Settings | None = None):
    resolved_settings = settings or get_settings()
    model = build_model(resolved_settings)
    tools = get_registered_tools()
    tools_by_name = get_tools_by_name()
    model_with_tools = model.bind_tools(tools)
    system_prompt_text = get_system_prompt(override=resolved_settings.system_prompt)
    system_message = SystemMessage(content=system_prompt_text)

    async def call_model(state: MessagesState, config: RunnableConfig):
        messages = [system_message] + list(state["messages"])
        response = await model_with_tools.ainvoke(messages, config=config)
        return {"messages": [response]}

    def call_tool(state: MessagesState, config: RunnableConfig):
        tool_outputs = []
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
        
        for tool_call in last_message.tool_calls:
            tool = tools_by_name.get(tool_call["name"])
            tool_name = tool_call["name"]
            logger.info("[AGENT] Executing tool: %s", tool_name)
            
            if not tool:
                observation: str = f"Requested tool '{tool_name}' is not available."
                logger.warning("[AGENT] Tool not found: %s", tool_name)
            else:
                try:
                    args = dict(tool_call.get("args") or {})
                    # SECURITY: Always override user_id/project_id/branch_id from trusted context
                    # Never trust values provided by the LLM (could be prompt injection)
                    if project_id:
                        args["project_id"] = project_id
                    if user_id:
                        args["user_id"] = user_id
                    if branch_id:
                        args["branch_id"] = branch_id
                    
                    logger.info("[AGENT] Tool args (with context): %s", str(args)[:500])
                    
                    if getattr(tool, "name", None) in ("renderVideo", "generateVeoVideo"):
                        args["_agent_context"] = {
                            "thread_id": thread_id,
                            "project_id": project_id,
                            "user_id": user_id,
                            "branch_id": branch_id,
                        }
                        result = tool.func(**args)
                    else:
                        result = tool.invoke(args, config=config)
                    observation = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
                    logger.info("[AGENT] Tool result: %s", observation[:500] if len(observation) > 500 else observation)
                except Exception as exc:  # pragma: no cover - surface tool exceptions
                    logger.exception("[AGENT] Tool execution failed: %s", tool_name)
                    observation = f"Tool '{tool_name}' failed: {exc}"
            tool_outputs.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))
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
