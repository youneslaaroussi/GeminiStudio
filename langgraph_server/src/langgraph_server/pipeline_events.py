"""Pipeline event subscriber for asset processing completion notifications.

This module subscribes to pipeline completion events from the asset service
and notifies agents that have explicitly subscribed to specific assets.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Any, Dict, Optional, Set

from google.api_core.exceptions import NotFound
from google.cloud import pubsub_v1
from google.cloud.pubsub_v1.subscriber.message import Message
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from .config import Settings

logger = logging.getLogger(__name__)

# In-memory store for subscribed assets
# Key: asset_id, Value: set of subscription info dicts
_subscribed_assets: Dict[str, Dict[str, Any]] = {}
_subscription_lock = asyncio.Lock()


async def subscribe_to_asset_pipeline(
    asset_id: str,
    thread_id: str,
    user_id: str,
    project_id: str,
    asset_name: str | None = None,
    branch_id: str | None = None,
) -> None:
    """
    Register interest in an asset's pipeline completion.
    
    When the pipeline completes, the agent will be notified.
    
    Args:
        asset_id: Asset ID to watch
        thread_id: Thread ID for the agent conversation
        user_id: User ID
        project_id: Project ID
        asset_name: Optional asset name for display
        branch_id: Optional branch ID for timeline operations
    """
    async with _subscription_lock:
        _subscribed_assets[asset_id] = {
            "threadId": thread_id,
            "userId": user_id,
            "projectId": project_id,
            "branchId": branch_id,
            "assetName": asset_name,
            "subscribedAt": datetime.utcnow().isoformat() + "Z",
        }
    logger.info(
        "[PIPELINE_EVENTS] Agent subscribed to asset %s (thread=%s)",
        asset_id,
        thread_id,
    )


async def unsubscribe_from_asset_pipeline(asset_id: str) -> bool:
    """
    Unsubscribe from an asset's pipeline completion.
    
    Returns True if was subscribed, False otherwise.
    """
    async with _subscription_lock:
        if asset_id in _subscribed_assets:
            del _subscribed_assets[asset_id]
            logger.info("[PIPELINE_EVENTS] Unsubscribed from asset %s", asset_id)
            return True
    return False


async def get_subscribed_asset(asset_id: str) -> Dict[str, Any] | None:
    """Get subscription info for an asset, if subscribed."""
    async with _subscription_lock:
        return _subscribed_assets.get(asset_id)


class PipelineEventSubscriber:
    """Subscribes to pipeline events and dispatches notifications to subscribed agents."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._subscriber: Optional[pubsub_v1.SubscriberClient] = None
        self._streaming_future: Optional[pubsub_v1.subscriber.futures.StreamingPullFuture] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    async def start(self) -> None:
        """Start listening for pipeline events."""
        if self._streaming_future and not self._streaming_future.done():
            return

        subscription_name = self._settings.pipeline_event_subscription
        project_id = self._settings.google_project_id

        self._subscriber = pubsub_v1.SubscriberClient()
        subscription_path = self._subscriber.subscription_path(project_id, subscription_name)
        self._loop = asyncio.get_running_loop()

        def callback(message: Message) -> None:
            assert self._loop is not None
            asyncio.run_coroutine_threadsafe(self._handle_message(message), self._loop)

        try:
            self._streaming_future = self._subscriber.subscribe(subscription_path, callback)
        except NotFound:
            logger.error(
                "Pipeline event subscription '%s' not found in project '%s'.",
                subscription_name,
                project_id,
            )
            await self._cleanup()
            return

        logger.info(
            "Subscribed to pipeline events on %s (topic: %s)",
            subscription_path,
            self._settings.pipeline_event_topic,
        )

    async def stop(self) -> None:
        """Stop listening for pipeline events."""
        if self._streaming_future:
            self._streaming_future.cancel()
            try:
                self._streaming_future.result(timeout=5)
            except Exception:
                pass
            self._streaming_future = None
        await self._cleanup()

    async def _cleanup(self) -> None:
        """Clean up resources."""
        if self._subscriber:
            await asyncio.to_thread(self._subscriber.close)
            self._subscriber = None

    async def _handle_message(self, message: Message) -> None:
        """Handle an incoming pipeline event message."""
        try:
            raw = message.data.decode("utf-8")
        except Exception:
            logger.warning("Received non-text pipeline event payload; acking.")
            message.ack()
            return

        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Discarded malformed pipeline event payload: %s", raw[:120])
            message.ack()
            return

        try:
            await self._dispatch_event(event)
            message.ack()
        except Exception:
            logger.exception("Failed to process pipeline event; acking to avoid retry.")
            message.ack()

    async def _dispatch_event(self, event: Dict[str, Any]) -> None:
        """Dispatch a pipeline event to the appropriate agent if subscribed."""
        event_type = event.get("type")
        asset_id = event.get("assetId")
        user_id = event.get("userId")
        project_id = event.get("projectId")
        asset_name = event.get("assetName")
        steps_summary = event.get("stepsSummary", [])
        metadata = event.get("metadata", {})

        if not asset_id:
            logger.debug("Skipping pipeline event without assetId")
            return

        # Check if agent subscribed to this asset
        subscription = await get_subscribed_asset(asset_id)
        if not subscription:
            logger.debug(
                "Skipping pipeline event for asset %s - no subscription",
                asset_id,
            )
            return

        # Get agent context from subscription
        thread_id = subscription.get("threadId")
        if not thread_id:
            logger.warning("Subscription for asset %s has no threadId", asset_id)
            return

        # Remove subscription after processing (one-time notification)
        await unsubscribe_from_asset_pipeline(asset_id)

        # Build messages for the agent
        messages = self._build_messages(
            event_type=event_type,
            asset_id=asset_id,
            asset_name=asset_name or subscription.get("assetName"),
            steps_summary=steps_summary,
            metadata=metadata,
        )
        if not messages:
            return

        # Dispatch to agent
        configurable: Dict[str, str] = {"thread_id": thread_id}
        # Get user_id and project_id from subscription if not in event
        sub_user_id = user_id or subscription.get("userId")
        sub_project_id = project_id or subscription.get("projectId")
        sub_branch_id = subscription.get("branchId")
        if sub_project_id:
            configurable["project_id"] = sub_project_id
        if sub_user_id:
            configurable["user_id"] = sub_user_id
        if sub_branch_id:
            configurable["branch_id"] = sub_branch_id

        try:
            from .agent import graph
            from .firebase import (
                fetch_chat_session,
                update_chat_session_messages,
                send_telegram_message,
                get_telegram_chat_id_for_user,
            )

            result = await graph.ainvoke(
                {"messages": messages},
                config={"configurable": configurable},
            )
            logger.info(
                "[PIPELINE_EVENTS] Dispatched %s event to agent for asset %s (thread=%s)",
                event_type,
                asset_id,
                thread_id,
            )

            # Extract AI response and write to Firebase + Telegram
            if user_id and result.get("messages"):
                ai_response = None
                for msg in reversed(result["messages"]):
                    if isinstance(msg, AIMessage):
                        content = msg.content
                        if isinstance(content, str):
                            ai_response = content
                        elif isinstance(content, list):
                            ai_response = "".join(
                                block.get("text", "") if isinstance(block, dict) else str(block)
                                for block in content
                            )
                        break

                if ai_response:
                    # Fetch current messages and append
                    session = await asyncio.to_thread(
                        fetch_chat_session, thread_id, self._settings
                    )
                    current_messages = list(session.get("messages", [])) if session else []

                    new_message = {
                        "id": f"msg-{int(time.time() * 1000)}-pipeline",
                        "role": "assistant",
                        "parts": [{"type": "text", "text": ai_response}],
                        "createdAt": datetime.utcnow().isoformat() + "Z",
                    }
                    current_messages.append(new_message)

                    await asyncio.to_thread(
                        update_chat_session_messages,
                        user_id,
                        thread_id,
                        current_messages,
                        self._settings,
                    )
                    logger.info(
                        "[PIPELINE_EVENTS] Wrote pipeline notification to Firebase for thread %s",
                        thread_id,
                    )

                    # Send to Telegram if applicable
                    if thread_id.startswith("telegram-"):
                        telegram_chat_id = thread_id.replace("telegram-", "")
                        try:
                            await send_telegram_message(
                                telegram_chat_id, ai_response, self._settings
                            )
                            logger.info(
                                "[PIPELINE_EVENTS] Sent pipeline notification to Telegram chat %s",
                                telegram_chat_id,
                            )
                        except Exception as e:
                            logger.warning("[PIPELINE_EVENTS] Failed to send to Telegram: %s", e)
                    else:
                        # Check if user has Telegram linked
                        telegram_chat_id = await asyncio.to_thread(
                            get_telegram_chat_id_for_user, user_id, self._settings
                        )
                        if telegram_chat_id:
                            try:
                                await send_telegram_message(
                                    telegram_chat_id, ai_response, self._settings
                                )
                                logger.info(
                                    "[PIPELINE_EVENTS] Sent pipeline notification to linked Telegram %s",
                                    telegram_chat_id,
                                )
                            except Exception as e:
                                logger.warning("[PIPELINE_EVENTS] Failed to send to Telegram: %s", e)

        except Exception:
            logger.exception(
                "[PIPELINE_EVENTS] Failed to inject pipeline event into agent flow for thread %s",
                thread_id,
            )

    def _build_messages(
        self,
        event_type: str | None,
        asset_id: str,
        asset_name: str | None,
        steps_summary: list[Dict[str, Any]],
        metadata: Dict[str, Any],
    ) -> list:
        """Build messages for the agent based on event type."""
        display_name = asset_name or asset_id[:16]
        
        succeeded = sum(1 for s in steps_summary if s.get("status") == "succeeded")
        failed = sum(1 for s in steps_summary if s.get("status") == "failed")
        total = len(steps_summary)

        if event_type == "pipeline.completed":
            details = [
                f"Asset: {display_name}",
                "Status: completed",
                f"Steps: {succeeded}/{total} succeeded",
            ]
            if failed > 0:
                failed_names = [s.get("label", s.get("id")) for s in steps_summary if s.get("status") == "failed"]
                details.append(f"Failed steps: {', '.join(failed_names)}")
            
            # Include useful metadata
            meta_agent = metadata.get("agent", {})
            if meta_agent:
                details.append(f"Asset ID: {asset_id}")

            body = "Asset pipeline completed:\n" + "\n".join(f"- {item}" for item in details)

        elif event_type == "pipeline.failed":
            details = [
                f"Asset: {display_name}",
                "Status: failed",
                f"Steps: {failed}/{total} failed",
            ]
            failed_steps = [s for s in steps_summary if s.get("status") == "failed"]
            for fs in failed_steps[:3]:  # Show first 3 failures
                label = fs.get("label", fs.get("id"))
                error = fs.get("error", "Unknown error")
                details.append(f"  - {label}: {error[:100]}")

            body = "Asset pipeline failed:\n" + "\n".join(f"- {item}" for item in details)

        else:
            logger.debug("[PIPELINE_EVENTS] Ignoring unsupported event type: %s", event_type)
            return []

        system_prompt = (
            "Asset pipeline status update received. Craft a concise message for the user "
            "summarizing the outcome. If successful, mention that the asset is now ready "
            "to use and any metadata that was extracted. If failed, briefly explain what went wrong."
        )

        return [
            SystemMessage(content=system_prompt),
            HumanMessage(content=body),
        ]
