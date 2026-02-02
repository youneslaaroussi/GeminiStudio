"""Humanized, emoji status messages for agent progress (Thinking…, Calling X…).

Used by teleport (api.py) and Telegram (chat/telegram.py). Messages use _italic_
for Telegram Markdown where supported.
"""

THINKING_PLAIN = "Let me think about this… 🤔"
THINKING_TELEGRAM = "_Let me think about this…_ 🤔"

# Tool name -> (plain for Firebase/UI, telegram with italic + emoji)
TOOL_STATUS: dict[str, tuple[str, str]] = {
    "addClipToTimeline": ("Adding a clip to the timeline… 📎", "_Adding a clip to the timeline…_ 📎"),
    "addTransition": ("Adding a transition… ✨", "_Adding a transition…_ ✨"),
    "applyVideoEffectToClip": ("Applying a video effect… 🎬", "_Applying a video effect…_ 🎬"),
    "getVideoEffectJobStatus": ("Checking effect status… ⏳", "_Checking effect status…_ ⏳"),
    "deleteClipFromTimeline": ("Removing a clip from the timeline… 🗑️", "_Removing a clip from the timeline…_ 🗑️"),
    "removeTransition": ("Removing a transition… ↩️", "_Removing a transition…_ ↩️"),
    "generateImage": ("Creating an image… 🖼️", "_Creating an image…_ 🖼️"),
    "generateMusic": ("Creating music… 🎵", "_Creating music…_ 🎵"),
    "generateSpeech": ("Generating speech… 🎤", "_Generating speech…_ 🎤"),
    "generateVeoVideo": ("Generating video… 🎞️", "_Generating video…_ 🎞️"),
    "get_current_time_utc": ("Checking the time… 🕐", "_Checking the time…_ 🕐"),
    "getAssetMetadata": ("Fetching asset details… 📋", "_Fetching asset details…_ 📋"),
    "getTimelineState": ("Reading the timeline… 📐", "_Reading the timeline…_ 📐"),
    "listAssets": ("Listing assets… 📂", "_Listing assets…_ 📂"),
    "listProjectAssets": ("Fetching your project assets… 📂", "_Fetching your project assets…_ 📂"),
    "createEditPlan": ("Planning the edit… 📝", "_Planning the edit…_ 📝"),
    "searchAssets": ("Searching assets… 🔍", "_Searching assets…_ 🔍"),
    "setAssetNotes": ("Updating asset notes… 📌", "_Updating asset notes…_ 📌"),
    "setSceneConfig": ("Updating scene settings… ⚙️", "_Updating scene settings…_ ⚙️"),
    "search_product_docs": ("Searching the docs… 📚", "_Searching the docs…_ 📚"),
    "renderVideo": ("Rendering your video… 🎬", "_Rendering your video…_ 🎬"),
    "subscribeToAssetPipeline": ("Subscribing to pipeline… 📡", "_Subscribing to pipeline…_ 📡"),
    "lookup_weather_snapshot": ("Checking the weather… 🌤️", "_Checking the weather…_ 🌤️"),
}


def get_thinking_message(for_telegram: bool = False) -> str:
    return THINKING_TELEGRAM if for_telegram else THINKING_PLAIN


def get_tool_status_message(tool_name: str, for_telegram: bool = False) -> str:
    """Humanized status for a tool call. Falls back to generic message."""
    entry = TOOL_STATUS.get(tool_name)
    if entry:
        return entry[1] if for_telegram else entry[0]
    # Fallback: humanize the name (e.g. addClipToTimeline -> "Running addClipToTimeline…")
    base = tool_name.replace("_", " ").strip()
    if for_telegram:
        return f"_Working on {base}…_ ⚙️"
    return f"Working on {base}… ⚙️"
