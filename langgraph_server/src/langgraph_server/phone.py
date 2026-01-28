from __future__ import annotations

import re
from typing import Optional

import phonenumbers
from phonenumbers import NumberParseException, PhoneNumberFormat


PHONE_CANDIDATE_RE = re.compile(r"(\+?\d[\d\s\-\(\)]{6,})")


def extract_phone_number(text: str, default_region: str | None = None) -> Optional[str]:
    match = PHONE_CANDIDATE_RE.search(text)
    if not match:
        return None
    candidate = match.group(1)

    try:
        parsed = phonenumbers.parse(candidate, default_region)
        if not phonenumbers.is_possible_number(parsed) or not phonenumbers.is_valid_number(parsed):
            return None
        return phonenumbers.format_number(parsed, PhoneNumberFormat.E164)
    except NumberParseException:
        return None
