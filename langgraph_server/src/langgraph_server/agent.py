from __future__ import annotations

import json
from typing import Literal

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.messages import ToolMessage
from langgraph.graph import END, START, MessagesState, StateGraph

from .checkpoint import create_checkpointer
from .config import Settings, get_settings
from .tools import get_registered_tools, get_tools_by_name


def build_model(settings: Settings) -> ChatGoogleGenerativeAI:
    """Instantiate the Gemini chat model."""

    return ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        api_key=settings.google_api_key,
        convert_system_message_to_human=True,
    )


def create_graph(settings: Settings | None = None):
    resolved_settings = settings or get_settings()
    model = build_model(resolved_settings)
    tools = get_registered_tools()
    tools_by_name = get_tools_by_name()
    model_with_tools = model.bind_tools(tools)
    system_message = SystemMessage(content=resolved_settings.system_prompt)

    def call_model(state: MessagesState, config: RunnableConfig):
        messages = [system_message] + list(state["messages"])
        response = model_with_tools.invoke(messages, config=config)
        return {"messages": [response]}

    def call_tool(state: MessagesState, config: RunnableConfig):
        tool_outputs = []
        last_message = state["messages"][-1]
        for tool_call in last_message.tool_calls:
            tool = tools_by_name.get(tool_call["name"])
            if not tool:
                observation: str = f"Requested tool '{tool_call['name']}' is not available."
            else:
                try:
                    args = dict(tool_call.get("args") or {})
                    configurable = config.get("configurable", {})
                    project_id = configurable.get("project_id")
                    user_id = configurable.get("user_id")
                    if project_id and "project_id" not in args:
                        args["project_id"] = project_id
                    if user_id and "user_id" not in args:
                        args["user_id"] = user_id
                    result = tool.invoke(args, config=config)
                    observation = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
                except Exception as exc:  # pragma: no cover - surface tool exceptions
                    observation = f"Tool '{tool_call['name']}' failed: {exc}"
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
