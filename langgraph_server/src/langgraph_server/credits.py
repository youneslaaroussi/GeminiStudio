"""Credits config and server-side deduction. Mirrors app/lib/credits-config."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from google.cloud.firestore_v1 import transactional

from .config import Settings
from .firebase import get_firestore_client

logger = logging.getLogger(__name__)

BILLING_DOC = "billing"

CREDITS_PER_ACTION: dict[str, int] = {
    "chat": 3,
    "veo_generation": 10,
    "render": 5,
    "lyria_generation": 8,
    "tts": 2,
    "image_generation": 4,
    "live_voice_chat": 3,
}


def get_credits_for_action(action: str) -> int:
    return CREDITS_PER_ACTION.get(action, 0)


class InsufficientCreditsError(Exception):
    def __init__(self, message: str, required: int, current: int) -> None:
        super().__init__(message)
        self.required = required
        self.current = current


def deduct_credits(
    user_id: str,
    amount: int,
    reason: str,
    settings: Settings,
) -> None:
    """Deduct credits from user's billing doc. Raises InsufficientCreditsError if insufficient."""
    if not isinstance(amount, int) or amount <= 0:
        raise ValueError("deduct_credits: amount must be a positive integer")

    db = get_firestore_client(settings)
    ref = db.collection("users").document(user_id).collection("settings").document(BILLING_DOC)

    @transactional
    def _run(transaction: Any) -> None:
        snapshot = ref.get(transaction=transaction)
        current = 0
        if snapshot.exists:
            data = snapshot.to_dict() or {}
            c = data.get("credits")
            if isinstance(c, (int, float)):
                current = int(c)

        if current < amount:
            raise InsufficientCreditsError(
                f"Insufficient credits: have {current}, need {amount}",
                required=amount,
                current=current,
            )

        next_credits = current - amount
        transaction.set(ref, {"credits": next_credits, "updatedAt": datetime.utcnow().isoformat() + "Z"}, merge=True)

    transaction = db.transaction()
    _run(transaction)
    logger.info("Deducted %s credits for user %s (action=%s)", amount, user_id, reason)
