"""API routes for video effect definitions."""

from __future__ import annotations

from fastapi import APIRouter

from ...effects.definitions import get_effect_definitions_for_api

router = APIRouter()


@router.get("")
async def list_effects():
    """List all available video effects."""
    definitions = get_effect_definitions_for_api()
    return {"effects": definitions}
