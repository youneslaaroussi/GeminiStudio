from __future__ import annotations

import asyncio
import json
import logging
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException, Request, status
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from .agent import graph
from .chat import build_dispatcher
from .config import Settings, get_settings
from .firebase import (
    fetch_chat_session,
    fetch_user_projects,
    update_chat_session_messages,
    update_chat_session_branch,
    update_chat_session_agent_status,
    create_branch_for_chat,
    get_telegram_chat_id_for_user,
    send_telegram_message,
)
from .credits import deduct_credits, get_credits_for_action, InsufficientCreditsError
from .schemas import HealthResponse, InvokeRequest, InvokeResponse, MessageEnvelope, TeleportRequest, TeleportResponse

router = APIRouter()

logger = logging.getLogger(__name__)

# Per-chat task registry: cancel previous agent run when a new teleport request arrives for the same chat
_teleport_tasks: dict[str, asyncio.Task] = {}
_teleport_lock = asyncio.Lock()


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
async def invoke(
    payload: InvokeRequest,
    settings: Settings = Depends(get_settings),
):
    configurable: dict[str, str] = {"thread_id": payload.thread_id}
    if settings.default_project_id:
        configurable.setdefault("project_id", settings.default_project_id)

    config: RunnableConfig = {"configurable": configurable}
    config["thread_id"] = payload.thread_id

    inputs = {"messages": _as_langchain_messages(payload.messages)}
    try:
        result = await graph.ainvoke(inputs, config=config)
    except Exception as exc:  # pragma: no cover - fastapi handles formatting
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    return InvokeResponse(thread_id=payload.thread_id, messages=_as_envelopes(result["messages"]))


@router.post("/teleport", response_model=TeleportResponse)
async def teleport(
    payload: TeleportRequest,
    settings: Settings = Depends(get_settings),
):
    """
    Teleport endpoint to continue a chat session from the cloud.

    Loads the chat session from Firebase and logs session details.
    """
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
    from rich import box

    console = Console()

    console.print(Panel.fit(
        f"[bold cyan]Teleport Request[/bold cyan]\n[dim]chat_id: {payload.chat_id}[/dim]",
        border_style="cyan"
    ))

    # Fetch the chat session from Firebase
    try:
        session = fetch_chat_session(payload.chat_id, settings)
    except Exception as exc:
        console.print(f"[bold red]Failed to fetch chat session:[/bold red] {exc}")
        return TeleportResponse(
            success=False,
            chat_id=payload.chat_id,
            message=f"Failed to fetch session: {str(exc)}"
        )

    if not session:
        console.print(f"[bold yellow]Chat session not found:[/bold yellow] {payload.chat_id}")
        return TeleportResponse(
            success=False,
            chat_id=payload.chat_id,
            message="Chat session not found"
        )

    # === SESSION INFO ===
    session_table = Table(title="Session Info", box=box.ROUNDED, show_header=False)
    session_table.add_column("Field", style="cyan")
    session_table.add_column("Value", style="white")
    session_table.add_row("ID", session.get("id", ""))
    session_table.add_row("Name", session.get("name", ""))
    session_table.add_row("User ID", session.get("userId", ""))
    session_table.add_row("Mode", session.get("currentMode", ""))
    session_table.add_row("Created", session.get("createdAt", ""))
    session_table.add_row("Updated", session.get("updatedAt", ""))
    session_table.add_row("Messages", str(len(session.get("messages", []))))
    console.print(session_table)

    # === MESSAGES ===
    messages = session.get("messages", [])
    if messages:
        msg_table = Table(title="Messages", box=box.ROUNDED)
        msg_table.add_column("#", style="dim", width=3)
        msg_table.add_column("Role", style="cyan", width=10)
        msg_table.add_column("Content", style="white", max_width=80)

        for i, msg in enumerate(messages):
            role = msg.get("role", "unknown")
            parts = msg.get("parts", [])
            preview = ""
            for part in parts:
                if isinstance(part, dict) and part.get("type") == "text":
                    preview = part.get("text", "")[:100]
                    break
                elif isinstance(part, str):
                    preview = part[:100]
                    break

            role_style = "green" if role == "user" else "blue" if role == "assistant" else "yellow"
            msg_table.add_row(
                str(i + 1),
                f"[{role_style}]{role}[/{role_style}]",
                preview + ("..." if len(preview) >= 100 else "")
            )
        console.print(msg_table)

    # === USER PROJECTS & CHAT -> BRANCH MAPPING ===
    user_id = session.get("userId")
    first_project_id = None
    project_context = None
    branch_id = session.get("branchId")
    if user_id:
        try:
            projects = fetch_user_projects(user_id, settings)
            if projects:
                first_project_id = projects[0].get("id")
                # New conversation: ensure this chat has a dedicated branch (direct chat_id -> branch mapping)
                if not branch_id and first_project_id:
                    try:
                        branch_id = create_branch_for_chat(user_id, first_project_id, payload.chat_id, settings)
                        update_chat_session_branch(user_id, payload.chat_id, branch_id, settings)
                        session["branchId"] = branch_id
                        console.print(f"[bold green]Created branch for chat:[/bold green] {branch_id}")
                    except Exception as e:
                        console.print(f"[yellow]Could not create branch for chat:[/yellow] {e}")
                        branch_id = "main"
                elif not branch_id:
                    branch_id = "main"
            if branch_id and first_project_id:
                # Fetch project data for this session's branch only (agent must only use this branch)
                projects = fetch_user_projects(user_id, settings, branch_id=branch_id, project_id=first_project_id)
            else:
                projects = fetch_user_projects(user_id, settings)
            if projects:
                proj_table = Table(title=f"User Projects ({len(projects)})", box=box.ROUNDED)
                proj_table.add_column("ID", style="dim", max_width=20)
                proj_table.add_column("Name", style="cyan")
                proj_table.add_column("Branch", style="magenta")
                proj_table.add_column("Synced", style="green")

                for proj in projects:
                    branch_info = proj.get("_branch", {})
                    proj_table.add_row(
                        proj.get("id", "")[:20],
                        proj.get("name", "Untitled"),
                        branch_info.get("branchId", "-"),
                        "Yes" if branch_info.get("hasAutomergeState") else "No"
                    )
                console.print(proj_table)

                # Show first project details
                if projects:
                    first_proj = projects[0]
                    first_project_id = first_proj.get("id")
                    branch_info = first_proj.get("_branch", {})
                    project_data = first_proj.get("_projectData", {})

                    # Build project context for the agent
                    if project_data:
                        layers = project_data.get("layers", [])
                        resolution = project_data.get("resolution", {})

                        # Collect all media assets from clips
                        assets_info = []
                        for layer in layers:
                            for clip in layer.get("clips", []):
                                asset_name = clip.get('name', 'Untitled')
                                asset_type = clip.get('type', 'unknown')
                                duration = clip.get('duration', 0)
                                src = clip.get('src', '')
                                asset_id = clip.get('assetId', '')
                                assets_info.append(f"- {asset_name} (type: {asset_type}, duration: {duration}s, id: {asset_id[:8] if asset_id else 'N/A'}...)")

                        # Build track summary
                        tracks_info = []
                        for layer in layers:
                            clip_count = len(layer.get("clips", []))
                            tracks_info.append(f"- {layer.get('name', 'Track')}: {clip_count} clip(s)")

                        project_context = f"""Current Project: {first_proj.get('name', 'Untitled')}
Project ID: {first_project_id}
Resolution: {resolution.get('width', '?')}x{resolution.get('height', '?')} @ {project_data.get('fps', '?')}fps

Timeline Tracks ({len(layers)}):
{chr(10).join(tracks_info) if tracks_info else 'No tracks'}

Media Assets in Project ({len(assets_info)}):
{chr(10).join(assets_info) if assets_info else 'No media assets yet'}"""

                    if branch_info:
                        detail_table = Table(
                            title=f"Project: {first_proj.get('name', 'Untitled')}",
                            box=box.ROUNDED,
                            show_header=False
                        )
                        detail_table.add_column("Field", style="cyan")
                        detail_table.add_column("Value", style="white")
                        detail_table.add_row("Project ID", first_proj.get("id", ""))
                        detail_table.add_row("Owner", first_proj.get("owner", ""))
                        detail_table.add_row("Branch", branch_info.get("branchId", "-"))
                        detail_table.add_row("Commit ID", (branch_info.get("commitId", "-")[:20] + "...") if branch_info.get("commitId") else "-")
                        detail_table.add_row("Last Sync", str(branch_info.get("timestamp", "-")))
                        console.print(detail_table)

                    # Show decoded project data
                    if project_data:
                        # Resolution
                        resolution = project_data.get("resolution", {})
                        if resolution:
                            console.print(f"[cyan]Resolution:[/cyan] {resolution.get('width', '?')}x{resolution.get('height', '?')} @ {project_data.get('fps', '?')}fps")

                        # Tracks/Layers
                        layers = project_data.get("layers", [])
                        if layers:
                            track_table = Table(title=f"Timeline Tracks ({len(layers)})", box=box.ROUNDED)
                            track_table.add_column("Name", style="cyan")
                            track_table.add_column("Type", style="magenta")
                            track_table.add_column("Clips", style="green", justify="right")
                            track_table.add_column("Visible", style="yellow")

                            for layer in layers:
                                clips = layer.get("clips", [])
                                track_table.add_row(
                                    layer.get("name", layer.get("id", ""))[:30],
                                    layer.get("type", "unknown"),
                                    str(len(clips)),
                                    "Yes" if layer.get("visible", True) else "No"
                                )
                            console.print(track_table)

                            # Show clips for first track with clips
                            for layer in layers:
                                clips = layer.get("clips", [])
                                if clips:
                                    clip_table = Table(title=f"Clips in '{layer.get('name', 'Track')}'", box=box.ROUNDED)
                                    clip_table.add_column("ID", style="dim", max_width=15)
                                    clip_table.add_column("Asset", style="cyan", max_width=20)
                                    clip_table.add_column("Start", style="green", justify="right")
                                    clip_table.add_column("Duration", style="yellow", justify="right")

                                    for clip in clips[:5]:  # Limit to first 5
                                        clip_table.add_row(
                                            clip.get("id", "")[:15],
                                            clip.get("assetId", "")[:20] or "-",
                                            f"{clip.get('start', 0)}",
                                            f"{clip.get('duration', 0)}"
                                        )
                                    if len(clips) > 5:
                                        clip_table.add_row("...", f"+{len(clips) - 5} more", "", "")
                                    console.print(clip_table)
                                    break  # Only show first track's clips

                        # Assets
                        assets = project_data.get("assets", [])
                        if assets:
                            asset_table = Table(title=f"Assets ({len(assets)})", box=box.ROUNDED)
                            asset_table.add_column("ID", style="dim", max_width=15)
                            asset_table.add_column("Name", style="cyan", max_width=25)
                            asset_table.add_column("Type", style="magenta")
                            asset_table.add_column("Source", style="dim", max_width=30)

                            for asset in assets[:10]:  # Limit to first 10
                                asset_table.add_row(
                                    asset.get("id", "")[:15],
                                    asset.get("name", "")[:25],
                                    asset.get("type", "unknown"),
                                    (asset.get("src", "") or "")[:30]
                                )
                            if len(assets) > 10:
                                asset_table.add_row("...", f"+{len(assets) - 10} more", "", "")
                            console.print(asset_table)
                    else:
                        console.print("[dim]Could not decode project data[/dim]")
            else:
                console.print("[dim]No projects found for user[/dim]")
        except Exception as exc:
            console.print(f"[yellow]Could not fetch projects:[/yellow] {exc}")

    # Deduct credits before invoking (chat action)
    if user_id:
        cost = get_credits_for_action("chat")
        try:
            deduct_credits(user_id, cost, "chat", settings)
        except InsufficientCreditsError as e:
            console.print(f"[bold red]Insufficient credits:[/bold red] {e}")
            return TeleportResponse(
                success=False,
                chat_id=payload.chat_id,
                message=f"Insufficient credits. You need {e.required} R‑Credits. Add credits in Settings to continue.",
            )

    # === INVOKE AGENT ===
    console.print(Panel.fit(
        "[bold cyan]Invoking Agent[/bold cyan]",
        border_style="cyan"
    ))

    # Convert Firebase messages to LangChain messages
    langchain_messages = []
    for msg in session.get("messages", []):
        role = msg.get("role", "user")
        # Extract text from parts
        text_parts = []
        for part in msg.get("parts", []):
            if isinstance(part, dict) and part.get("type") == "text":
                text_parts.append(part.get("text", ""))
        content = "\n".join(text_parts) if text_parts else ""

        if role == "user":
            langchain_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            langchain_messages.append(AIMessage(content=content))

    console.print(f"[dim]Converted {len(langchain_messages)} messages for agent[/dim]")

    # Add project context as a system message if available
    if project_context:
        langchain_messages.insert(0, SystemMessage(content=f"[Project Context]\n{project_context}"))
        console.print(f"[dim]Added project context to agent[/dim]")

    # Invoke the graph with the chat_id as thread_id for persistence
    thread_id = payload.thread_id or payload.chat_id

    config: RunnableConfig = {
        "configurable": {
            "thread_id": thread_id,
            "user_id": session.get("userId"),
            "project_id": first_project_id,
            "branch_id": branch_id,
        },
        "thread_id": thread_id,
    }

    import time
    from datetime import datetime

    current_messages = list(session.get("messages", []))

    def extract_text_from_content(content) -> str:
        """Extract text from AI message content (string or list format)."""
        if isinstance(content, str):
            return content
        elif isinstance(content, list):
            text_parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif isinstance(block, str):
                    text_parts.append(block)
            return "\n".join(text_parts)
        return ""

    is_telegram_session = session.get("source") == "telegram" or payload.chat_id.startswith("telegram-")
    telegram_chat_id = None
    if not is_telegram_session:
        telegram_chat_id = get_telegram_chat_id_for_user(session.get("userId"), settings)

    async def send_to_telegram_async(text: str):
        if telegram_chat_id:
            await send_telegram_message(telegram_chat_id, text, settings)

    async def set_agent_status(status: str | None):
        if session.get("userId"):
            update_chat_session_agent_status(
                session["userId"], payload.chat_id, status, settings
            )
        if status and telegram_chat_id:
            try:
                await send_to_telegram_async(status)
            except Exception as e:
                console.print(f"[yellow]Failed to send status to Telegram: {e}[/yellow]")

    async def write_message_to_firebase(text: str):
        if not text or not session.get("userId"):
            return
        nonlocal current_messages
        new_message = {
            "id": f"msg-{int(time.time() * 1000)}-agent",
            "role": "assistant",
            "parts": [{"type": "text", "text": text}],
            "createdAt": datetime.utcnow().isoformat() + "Z",
        }
        current_messages = current_messages + [new_message]
        update_chat_session_messages(
            user_id=session["userId"],
            chat_id=payload.chat_id,
            messages=current_messages,
            settings=settings
        )
        console.print(f"[dim]Wrote to Firebase: {text[:50]}...[/dim]")
        if telegram_chat_id:
            try:
                await send_to_telegram_async(text)
                console.print(f"[dim]Sent to Telegram: {telegram_chat_id}[/dim]")
            except Exception as e:
                console.print(f"[yellow]Failed to send to Telegram: {e}[/yellow]")

    async def run_teleport_agent() -> TeleportResponse:
        """Run the graph stream; can be cancelled when a new teleport arrives for the same chat."""
        try:
            last_response = None
            agent_context = {
                "thread_id": thread_id,
                "user_id": session.get("userId"),
                "project_id": first_project_id,
                "branch_id": branch_id,
            }
            await set_agent_status("Thinking...")
            try:
                async for event in graph.astream(
                    {"messages": langchain_messages},
                    config=config,
                    stream_mode="values",
                    context=agent_context,
                ):
                    messages = event.get("messages", [])
                    if not messages:
                        continue
                    last_msg = messages[-1]
                    if isinstance(last_msg, AIMessage):
                        if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
                            for tc in last_msg.tool_calls:
                                name = tc.get("name", "tool")
                                console.print(f"[yellow]Tool Call:[/yellow] {name}({tc.get('args', {})})")
                                await set_agent_status(f"Calling {name}...")
                        else:
                            await set_agent_status(None)
                            text = extract_text_from_content(last_msg.content)
                            if text:
                                console.print(f"[green]AI:[/green] {text[:200]}{'...' if len(text) > 200 else ''}")
                                await write_message_to_firebase(text)
                                last_response = text
                    elif isinstance(last_msg, ToolMessage):
                        content = last_msg.content
                        preview = content[:150] if isinstance(content, str) else str(content)[:150]
                        console.print(f"[cyan]Tool Result:[/cyan] {preview}{'...' if len(str(content)) > 150 else ''}")
            finally:
                await set_agent_status(None)
            console.print(Panel.fit(
                f"[bold green]Agent Complete[/bold green]\n\n{last_response[:500] if last_response else 'No response'}{'...' if last_response and len(last_response) > 500 else ''}",
                border_style="green"
            ))
            return TeleportResponse(
                success=True,
                chat_id=payload.chat_id,
                message=last_response or "Agent completed without response"
            )
        except asyncio.CancelledError:
            if session.get("userId"):
                update_chat_session_agent_status(
                    session["userId"], payload.chat_id, None, settings
                )
            logger.info("Teleport run cancelled for chat_id=%s", payload.chat_id)
            raise
        except Exception as exc:
            console.print(f"[bold red]Agent failed:[/bold red] {exc}")
            if session.get("userId"):
                update_chat_session_agent_status(
                    session["userId"], payload.chat_id, None, settings
                )
            return TeleportResponse(
                success=False,
                chat_id=payload.chat_id,
                message=f"Agent failed: {str(exc)}"
            )

    chat_key = payload.chat_id
    async with _teleport_lock:
        if chat_key in _teleport_tasks:
            old_task = _teleport_tasks[chat_key]
            old_task.cancel()
            try:
                await old_task
            except asyncio.CancelledError:
                pass
        task = asyncio.create_task(run_teleport_agent())
        _teleport_tasks[chat_key] = task

    try:
        return await task
    except asyncio.CancelledError:
        return TeleportResponse(
            success=False,
            chat_id=payload.chat_id,
            message="Run cancelled (new message or stop)."
        )
    finally:
        async with _teleport_lock:
            if _teleport_tasks.get(chat_key) is task:
                del _teleport_tasks[chat_key]


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
