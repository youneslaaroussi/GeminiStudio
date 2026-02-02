"""Shared test helpers (e.g. for building tool context)."""

from __future__ import annotations

import asyncio
import inspect

from langchain_core.tools import StructuredTool


def agent_context(
    user_id: str | None = "user-123",
    project_id: str | None = "proj-123",
    branch_id: str = "main",
) -> dict:
    """Build _agent_context dict for tools that expect it.

    Merge with other args: {**agent_context(), "asset_id": "x"}.
    """
    return {
        "_agent_context": {
            "user_id": user_id,
            "project_id": project_id,
            "branch_id": branch_id,
        }
    }


def invoke_with_context(tool, user_id: str | None = "user-123", project_id: str | None = "proj-123", branch_id: str = "main", **kwargs):
    """Invoke a tool with _agent_context passed through (bypasses schema stripping in .invoke())."""
    args = {**agent_context(user_id=user_id, project_id=project_id, branch_id=branch_id), **kwargs}
    if isinstance(tool, StructuredTool) and hasattr(tool, "func"):
        sig = inspect.signature(tool.func)
        allowed = {k for k in sig.parameters}
        filtered = {k: v for k, v in args.items() if k in allowed}
        return tool.func(**filtered)
    return tool.invoke(args)


async def ainvoke_with_context(
    tool, user_id: str | None = "user-123", project_id: str | None = "proj-123", branch_id: str = "main", thread_id: str | None = None, **kwargs
):
    """Async invoke a tool with _agent_context passed through (bypasses schema stripping in .ainvoke())."""
    ctx = {"user_id": user_id, "project_id": project_id, "branch_id": branch_id}
    if thread_id is not None:
        ctx["thread_id"] = thread_id
    args = {"_agent_context": ctx, **kwargs}
    if isinstance(tool, StructuredTool):
        fn = getattr(tool, "coroutine", None) or getattr(tool, "func", None)
        if fn is not None:
            sig = inspect.signature(fn)
            allowed = {k for k in sig.parameters}
            filtered = {k: v for k, v in args.items() if k in allowed}
            result = fn(**filtered)
            if asyncio.iscoroutine(result):
                return await result
            return result
    return await tool.ainvoke(args)
