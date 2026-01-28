from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass(slots=True)
class IncomingMessage:
    provider: str
    sender_id: str
    text: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class OutgoingMessage:
    provider: str
    recipient_id: str
    text: str
    metadata: Dict[str, Any] = field(default_factory=dict)

