"""Modular system prompts for the agent.

Prompt sections are stored as separate .txt files and composed in order.
Use USE_MODULAR_PROMPTS=true (default) to build the system prompt from these files;
set SYSTEM_PROMPT in env to override with a single custom prompt.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Order of prompt sections (filenames without .txt)
PROMPT_SECTION_ORDER = (
    "base",
    "render_and_defaults",
    "timeline_layers",
    "motion_canvas",
    "video_iteration",
    "video_effects",
    "narrative",
    "chapters_and_titles",
    "captions",
    "music_mood",
    "examples",
)


def _prompts_dir() -> Path:
    """Directory containing prompt .txt files (next to this __init__.py)."""
    return Path(__file__).resolve().parent


def _load_section(name: str) -> str:
    """Load a single prompt section by name (without .txt)."""
    path = _prompts_dir() / f"{name}.txt"
    if not path.exists():
        logger.warning("Prompt section not found: %s", path)
        return ""
    try:
        return path.read_text(encoding="utf-8").strip()
    except Exception as e:
        logger.warning("Failed to read prompt section %s: %s", name, e)
        return ""


def build_system_prompt(
    *,
    section_order: tuple[str, ...] | None = None,
    separator: str = "\n\n",
) -> str:
    """Build the full system prompt by loading and joining prompt sections in order.

    Args:
        section_order: Override default order of section names (without .txt).
        separator: String to join sections with.

    Returns:
        Composed system prompt string.
    """
    order = section_order or PROMPT_SECTION_ORDER
    parts = []
    for name in order:
        content = _load_section(name)
        if content:
            parts.append(content)
    return separator.join(parts)


def get_system_prompt(override: str | None = None, use_modular: bool = True) -> str:
    """Return the system prompt to use for the agent.

    Args:
        override: If set (e.g. from SYSTEM_PROMPT env), use this instead of modular prompts.
        use_modular: If True and override is None, build from prompt files; else use override or fallback.

    Returns:
        Final system prompt string.
    """
    if override and override.strip():
        return override.strip()
    if use_modular:
        return build_system_prompt()
    return ""


__all__ = [
    "PROMPT_SECTION_ORDER",
    "build_system_prompt",
    "get_system_prompt",
    "_load_section",
]
