from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Optional

import firebase_admin
from firebase_admin import auth, credentials, firestore

from .config import Settings


def decode_automerge_state(base64_state: str) -> Optional[dict[str, Any]]:
    """
    Decode an Automerge state from base64 string to Python dict.
    """
    import json
    import logging
    logger = logging.getLogger(__name__)

    try:
        from automerge.core import Document, ROOT
    except ImportError:
        logger.warning("automerge package not installed, cannot decode project state")
        return None

    try:
        # Decode base64 to bytes
        binary = base64.b64decode(base64_state)

        # Load Automerge document from bytes
        doc = Document.load(binary)

        # Convert to Python dict by traversing the document
        result = automerge_doc_to_dict(doc, ROOT)

        # The project data is stored as JSON string in 'projectJSON' field
        if isinstance(result, dict) and 'projectJSON' in result:
            project_json_str = result['projectJSON']
            if isinstance(project_json_str, str):
                return json.loads(project_json_str)

        return result
    except Exception as e:
        logger.error(f"Failed to decode Automerge state: {e}")
        return None


def automerge_doc_to_dict(doc, obj_id) -> Any:
    """
    Recursively convert Automerge document to Python dict/list.
    
    automerge-py returns values as (val_type, val) where:
    - For scalars: val_type is tuple (ScalarType.X, actual_value), val is internal ref
    - For objects: val_type is ObjType.Map/List/Text, val is object ID to recurse
    """
    from automerge.core import ObjType

    obj_type = doc.object_type(obj_id)

    if obj_type == ObjType.Map:
        result = {}
        for key in doc.keys(obj_id):
            value = doc.get(obj_id, key)
            if value is not None:
                val_type, val = value
                if isinstance(val_type, tuple):
                    # Scalar value: val_type is (ScalarType.X, actual_value)
                    result[key] = val_type[1]
                elif val_type in (ObjType.Map, ObjType.List, ObjType.Text):
                    # Nested object: recurse using val as object ID
                    result[key] = automerge_doc_to_dict(doc, val)
        return result
    elif obj_type == ObjType.List:
        result = []
        length = doc.length(obj_id)
        for i in range(length):
            value = doc.get(obj_id, i)
            if value is not None:
                val_type, val = value
                if isinstance(val_type, tuple):
                    # Scalar value: val_type is (ScalarType.X, actual_value)
                    result.append(val_type[1])
                elif val_type in (ObjType.Map, ObjType.List, ObjType.Text):
                    # Nested object: recurse using val as object ID
                    result.append(automerge_doc_to_dict(doc, val))
        return result
    elif obj_type == ObjType.Text:
        return doc.text(obj_id)
    else:
        return None




def _service_account_path(settings: Settings) -> Optional[Path]:
    if settings.firebase_service_account_key:
        path = Path(settings.firebase_service_account_key).expanduser()
        if not path.exists():
            raise FileNotFoundError(f"Firebase service account file not found: {path}")
        return path
    return None


def initialize_firebase(settings: Settings) -> firebase_admin.App:
    if firebase_admin._apps:
        return firebase_admin.get_app()

    svc_path = _service_account_path(settings)
    if svc_path:
        cred = credentials.Certificate(str(svc_path))
        # Project ID is read from the service account JSON
        return firebase_admin.initialize_app(cred)

    # Fallback to application default credentials
    cred = credentials.ApplicationDefault()
    return firebase_admin.initialize_app(cred)


def lookup_email_by_phone(phone_number: str, settings: Settings) -> Optional[str]:
    initialize_firebase(settings)
    try:
        user_record = auth.get_user_by_phone_number(phone_number)
    except auth.UserNotFoundError:
        return None
    return user_record.email


def get_firestore_client(settings: Settings):
    """Get Firestore client, initializing Firebase if needed."""
    initialize_firebase(settings)
    return firestore.client()


def fetch_chat_session(chat_id: str, settings: Settings) -> Optional[dict[str, Any]]:
    """
    Fetch a chat session from Firestore by chat_id.

    Chat sessions are stored at: users/{userId}/chatSessions/{chatId}
    Uses collection group query to find across all users.
    """
    import logging
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    logger.info(f"Firestore project: {db.project}")
    logger.info(f"Searching for chat_id: {chat_id}")

    # Use collection group query to search all chatSessions subcollections
    from google.cloud.firestore_v1.base_query import FieldFilter
    sessions_query = db.collection_group("chatSessions").where(filter=FieldFilter("id", "==", chat_id))
    results = list(sessions_query.stream())

    logger.info(f"Collection group query returned {len(results)} results")

    if results:
        session_doc = results[0]
        data = session_doc.to_dict()
        # Extract userId from the document path: users/{userId}/chatSessions/{chatId}
        path_parts = session_doc.reference.path.split("/")
        user_id = path_parts[1] if len(path_parts) >= 2 else None

        logger.info(f"Found session: {data.get('name')} for user: {user_id}")
        return {
            "id": data.get("id"),
            "name": data.get("name"),
            "userId": data.get("userId") or user_id,
            "currentMode": data.get("currentMode"),
            "messages": data.get("messages", []),
            "createdAt": data.get("createdAt"),
            "updatedAt": data.get("updatedAt"),
            "branchId": data.get("branchId"),
        }

    logger.warning(f"Session not found: {chat_id}")
    return None


def update_chat_session_messages(
    user_id: str,
    chat_id: str,
    messages: list[dict[str, Any]],
    settings: Settings
) -> bool:
    """
    Update a chat session's messages in Firestore.

    This is used by the agent to write responses back to the chat session
    for real-time UI updates.
    """
    import logging
    from datetime import datetime
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    try:
        session_ref = db.collection("users").document(user_id).collection("chatSessions").document(chat_id)
        session_ref.update({
            "messages": messages,
            "updatedAt": datetime.utcnow().isoformat() + "Z",
        })
        logger.info(f"Updated chat session {chat_id} with {len(messages)} messages")
        return True
    except Exception as e:
        logger.error(f"Failed to update chat session {chat_id}: {e}")
        return False


def update_chat_session_branch(
    user_id: str,
    chat_id: str,
    branch_id: str,
    settings: Settings,
) -> bool:
    """Set branchId on a chat session (direct mapping chat_id -> branch_id)."""
    import logging
    from datetime import datetime
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)
    try:
        session_ref = db.collection("users").document(user_id).collection("chatSessions").document(chat_id)
        session_ref.update({
            "branchId": branch_id,
            "updatedAt": datetime.utcnow().isoformat() + "Z",
        })
        logger.info(f"Set chat session {chat_id} branchId to {branch_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to update chat session branch {chat_id}: {e}")
        return False


def update_chat_session_agent_status(
    user_id: str,
    chat_id: str,
    status: str | None,
    settings: Settings,
) -> bool:
    """
    Update the agentStatus field on a chat session for live progress (e.g. "Thinking...", "Calling addClip...").
    Pass status=None or "" to clear.
    """
    import logging
    from datetime import datetime
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)
    try:
        session_ref = db.collection("users").document(user_id).collection("chatSessions").document(chat_id)
        session_ref.update({
            "agentStatus": status if status else None,
            "updatedAt": datetime.utcnow().isoformat() + "Z",
        })
        if status:
            logger.info(f"Updated chat session {chat_id} agentStatus: {status[:80]!r}")
        return True
    except Exception as e:
        logger.error(f"Failed to update chat session {chat_id} agentStatus: {e}")
        return False


def create_initial_automerge_state(name: str = "Untitled Project") -> str:
    """
    Create an initial Automerge state for a new empty project timeline.
    Returns a base64-encoded Automerge document.
    
    Args:
        name: The project name to use (defaults to "Untitled Project" for backwards compatibility)
    """
    import base64
    import json
    from automerge.core import Document, ROOT, ScalarType
    
    # Default empty project structure (matching frontend's defaultProject)
    default_project = {
        "name": name,
        "resolution": {"width": 1080, "height": 720},
        "fps": 30,
        "renderScale": 1,
        "background": "#000000",
        "layers": [],
        "transcriptions": {},
        "transitions": {},
    }
    
    # Create new Automerge document with projectJSON
    doc = Document()
    with doc.transaction() as tx:
        tx.put(ROOT, "projectJSON", ScalarType.Str, json.dumps(default_project))
    
    # Save to base64
    binary = doc.save()
    return base64.b64encode(binary).decode("utf-8")


def ensure_main_branch_exists(
    user_id: str,
    project_id: str,
    settings: Settings,
) -> str:
    """
    Ensure the main branch exists for a project, creating it if needed.
    Returns the automerge state.
    """
    import uuid
    import logging
    from google.cloud.firestore_v1 import SERVER_TIMESTAMP
    logger = logging.getLogger(__name__)
    
    db = get_firestore_client(settings)
    
    main_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("branches")
        .document("main")
    )
    main_doc = main_ref.get()
    
    if main_doc.exists:
        main_data = main_doc.to_dict()
        automerge_state = main_data.get("automergeState")
        if automerge_state:
            return automerge_state
        # Main exists but has no automerge state - update it
        logger.info(f"Main branch exists but has no automerge state, initializing for project {project_id}")
    else:
        logger.info(f"Main branch not found, creating for project {project_id}")
    
    # Fetch project metadata to get the correct name
    project_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
    )
    project_doc = project_ref.get()
    project_name = "Untitled Project"
    if project_doc.exists:
        project_data = project_doc.to_dict()
        project_name = project_data.get("name", "Untitled Project") if project_data else "Untitled Project"
    
    # Create initial state with the correct project name
    automerge_state = create_initial_automerge_state(name=project_name)
    
    # Create or update main branch
    main_ref.set({
        "name": "Main",
        "createdAt": SERVER_TIMESTAMP,
        "createdBy": user_id,
        "commitId": str(uuid.uuid4()),
        "automergeState": automerge_state,
        "timestamp": SERVER_TIMESTAMP,
        "author": user_id,
    }, merge=True)
    
    logger.info(f"Initialized main branch for project {project_id} with name '{project_name}'")
    return automerge_state


def create_branch_for_chat(
    user_id: str,
    project_id: str,
    chat_id: str,
    settings: Settings,
) -> str:
    """
    Create a new branch for this chat session (from main).
    Returns the new branch_id. Each call creates a unique branch with timestamp suffix.
    If main doesn't exist, creates it first with an empty timeline.
    """
    import re
    import logging
    import uuid
    import time
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    # Firestore doc ID must not contain /
    safe_suffix = re.sub(r"[^a-zA-Z0-9]", "_", chat_id)[:60].strip("_") or "chat"
    # Add timestamp to ensure unique branch per /newchat
    timestamp = int(time.time())
    branch_id = f"chat_{safe_suffix}_{timestamp}"

    # Ensure main branch exists (create if needed)
    automerge_state = ensure_main_branch_exists(user_id, project_id, settings)
    
    # Get main branch data for metadata
    main_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("branches")
        .document("main")
    )
    main_doc = main_ref.get()
    main_data = main_doc.to_dict() or {}

    # Create new branch (copy of main)
    new_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
        .collection("branches")
        .document(branch_id)
    )
    new_ref.set({
        "name": f"Chat {chat_id[:20]}{'…' if len(chat_id) > 20 else ''}",
        "createdAt": main_data.get("createdAt"),
        "createdBy": user_id,
        "parentBranch": "main",
        "parentCommit": main_data.get("commitId"),
        "commitId": str(uuid.uuid4()),
        "automergeState": automerge_state,
        "timestamp": main_data.get("timestamp"),
        "author": user_id,
    })

    logger.info(f"Created branch {branch_id} for chat {chat_id} (project {project_id})")
    return branch_id


def fetch_project(project_id: str, settings: Settings) -> Optional[dict[str, Any]]:
    """
    Fetch a project from Firestore by project_id.

    Projects are stored at: projects/{projectId}
    """
    import logging
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    logger.info(f"Fetching project: {project_id}")

    project_ref = db.collection("projects").document(project_id)
    project_doc = project_ref.get()

    if project_doc.exists:
        data = project_doc.to_dict()
        logger.info(f"Found project: {data.get('name', 'Untitled')}")
        return data

    logger.warning(f"Project not found: {project_id}")
    return None


def verify_telegram_link_code(code: str, telegram_chat_id: str, telegram_username: str | None, settings: Settings) -> dict[str, Any] | None:
    """
    Verify a Telegram link code and create the integration.

    1. Look up the code in telegramLinkCodes collection
    2. Check if it's not expired
    3. Create the integration in users/{userId}/settings/integrations
    4. Create reverse lookup in telegramIntegrations/{telegramChatId}
    5. Delete the used code

    Returns the user info if successful, None otherwise.
    """
    import logging
    from datetime import datetime
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    # Look up the code
    code_ref = db.collection("telegramLinkCodes").document(code.upper())
    code_doc = code_ref.get()

    if not code_doc.exists:
        logger.warning(f"Link code not found: {code}")
        return None

    code_data = code_doc.to_dict()

    # Check expiry
    expires_at = code_data.get("expiresAt")
    if expires_at:
        if hasattr(expires_at, "timestamp"):
            expiry_timestamp = expires_at.timestamp()
        else:
            expiry_timestamp = expires_at
        import time
        if expiry_timestamp < time.time():
            logger.warning(f"Link code expired: {code}")
            code_ref.delete()
            return None

    user_id = code_data.get("userId")
    user_email = code_data.get("userEmail")

    if not user_id:
        logger.error(f"Link code has no userId: {code}")
        return None

    # Create the integration record
    now = datetime.utcnow().isoformat() + "Z"
    integration_data = {
        "telegram": {
            "telegramChatId": telegram_chat_id,
            "telegramUsername": telegram_username,
            "linkedAt": now,
        }
    }

    # Save to user's settings
    user_integrations_ref = db.collection("users").document(user_id).collection("settings").document("integrations")
    user_integrations_ref.set(integration_data, merge=True)

    # Create reverse lookup for quick telegram -> user mapping
    reverse_lookup_ref = db.collection("telegramIntegrations").document(telegram_chat_id)
    reverse_lookup_ref.set({
        "userId": user_id,
        "userEmail": user_email,
        "telegramUsername": telegram_username,
        "linkedAt": now,
    })

    # Delete the used code
    code_ref.delete()

    logger.info(f"Successfully linked Telegram {telegram_chat_id} to user {user_id}")

    return {
        "userId": user_id,
        "userEmail": user_email,
    }


def get_user_by_telegram_chat_id(telegram_chat_id: str, settings: Settings) -> dict[str, Any] | None:
    """
    Look up a Firebase user by their Telegram chat ID.

    Returns user info if found, None otherwise.
    """
    import logging
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    # Look up in reverse mapping
    lookup_ref = db.collection("telegramIntegrations").document(telegram_chat_id)
    lookup_doc = lookup_ref.get()

    if not lookup_doc.exists:
        logger.info(f"No user found for Telegram chat ID: {telegram_chat_id}")
        return None

    data = lookup_doc.to_dict()
    return {
        "userId": data.get("userId"),
        "userEmail": data.get("userEmail"),
        "telegramUsername": data.get("telegramUsername"),
    }


def get_or_create_telegram_chat_session(user_id: str, telegram_chat_id: str, settings: Settings) -> dict[str, Any]:
    """
    Get or create a chat session for Telegram conversations.
    Uses telegram_chat_id as the session ID for consistency.
    """
    import logging
    from datetime import datetime
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    session_id = f"telegram-{telegram_chat_id}"
    session_ref = db.collection("users").document(user_id).collection("chatSessions").document(session_id)
    session_doc = session_ref.get()

    if session_doc.exists:
        data = session_doc.to_dict()
        data["id"] = session_id
        return data

    # Create new session
    now = datetime.utcnow().isoformat() + "Z"
    new_session = {
        "id": session_id,
        "name": "Telegram Chat",
        "currentMode": "agent",
        "messages": [],
        "createdAt": now,
        "updatedAt": now,
        "source": "telegram",
        "telegramChatId": telegram_chat_id,
    }
    session_ref.set(new_session)
    logger.info(f"Created new Telegram chat session: {session_id}")
    return new_session


def get_telegram_chat_id_for_user(user_id: str, settings: Settings) -> str | None:
    """Get the Telegram chat ID for a user if they have linked Telegram."""
    import logging
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    integrations_ref = db.collection("users").document(user_id).collection("settings").document("integrations")
    integrations_doc = integrations_ref.get()

    if not integrations_doc.exists:
        return None

    data = integrations_doc.to_dict()
    telegram = data.get("telegram")
    if telegram:
        return telegram.get("telegramChatId")
    return None


def create_project(user_id: str, name: str, settings: Settings) -> dict[str, Any]:
    """Create a new project for a user."""
    import logging
    import uuid
    import time
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    project_id = str(uuid.uuid4())
    now = int(time.time() * 1000)

    project_data = {
        "name": name,
        "currentBranch": "main",
        "lastModified": now,
        "owner": user_id,
        "collaborators": [],
        "isPublic": False,
    }

    project_ref = db.collection("users").document(user_id).collection("projects").document(project_id)
    project_ref.set(project_data)

    logger.info(f"Created project {project_id} for user {user_id}")

    return {
        "id": project_id,
        "name": name,
        "lastModified": now,
    }


def update_project_name(
    user_id: str,
    project_id: str,
    name: str,
    settings: Settings,
) -> None:
    """Update a project's display name in Firestore metadata."""
    import time

    db = get_firestore_client(settings)
    project_ref = (
        db.collection("users")
        .document(user_id)
        .collection("projects")
        .document(project_id)
    )
    project_ref.update({
        "name": name,
        "lastModified": int(time.time() * 1000),
    })


def _extract_media_url(text: str, base_url: str | None = None) -> tuple[str | None, str | None]:
    """Extract media URL from text. Returns (url, media_type) or (None, None).
    
    Args:
        text: The text to search for media URLs
        base_url: Optional base URL to prepend to relative URLs (e.g., "https://app.example.com")
    """
    import re
    import logging
    logger = logging.getLogger(__name__)

    url = None

    # 1. Markdown [text](url) – supports both absolute and relative URLs
    md = re.search(r'\[([^\]]*)\]\((https?://[^\)]+|/api/assets/[^\)]+)\)', text)
    if md:
        url = md.group(2)
        logger.debug(f"[MEDIA_EXTRACT] Found markdown URL: {url[:80]}...")

    # 2. Raw absolute URL with media extension
    if not url:
        raw = re.search(
            r'(https?://[^\s\)]+\.(?:mp4|webm|mov|avi|mkv|gif|mp3|wav|ogg|m4a|aac|jpg|jpeg|png|webp)(?:\?[^\s\)]*)?)',
            text,
            re.IGNORECASE,
        )
        if raw:
            url = raw.group(1)
            logger.info(f"[MEDIA_EXTRACT] Found raw absolute URL: ...{url[-50:]}")

    # 3. Raw relative proxy URL (/api/assets/...)
    if not url:
        proxy = re.search(
            r'(/api/assets/[a-f0-9-]+/file/[^\s\)]+\.(?:mp4|webm|mov|avi|mkv|gif|mp3|wav|ogg|m4a|aac|jpg|jpeg|png|webp)(?:\?[^\s\)]*)?)',
            text,
            re.IGNORECASE,
        )
        if proxy:
            url = proxy.group(1)
            logger.info(f"[MEDIA_EXTRACT] Found proxy URL: {url[:80]}...")
            # Convert relative proxy URL to absolute if base_url provided
            if base_url:
                url = base_url.rstrip('/') + url
                logger.info(f"[MEDIA_EXTRACT] Converted to absolute: {url[:80]}...")

    if not url:
        logger.info(f"[MEDIA_EXTRACT] No media URL found in text ({len(text)} chars)")
        return None, None

    lower = url.lower().split('?')[0]
    if any(lower.endswith(ext) for ext in ['.mp4', '.webm', '.mov', '.avi', '.mkv']):
        return url, 'video'
    if lower.endswith('.gif'):
        return url, 'animation'
    if any(lower.endswith(ext) for ext in ['.mp3', '.wav', '.ogg', '.m4a', '.aac']):
        return url, 'audio'
    if any(lower.endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.webp']):
        return url, 'photo'

    logger.debug(f"[MEDIA_EXTRACT] URL found but extension not recognized: {lower[-30:]}")
    return None, None


def _convert_to_telegram_markdown(text: str) -> str:
    """Convert standard Markdown to Telegram MarkdownV2 format."""
    try:
        import telegramify_markdown
        from telegramify_markdown import customize
        
        # Configure for cleaner output
        customize.strict_markdown = True  # Treat __text__ as bold (Telegram style)
        customize.cite_expandable = False  # Keep quotes simple
        
        return telegramify_markdown.markdownify(
            text,
            max_line_length=None,
            normalize_whitespace=False,
        )
    except ImportError:
        # Fallback: basic escaping for MarkdownV2
        import re
        # Escape special characters that aren't part of formatting
        escape_chars = r'_[]()~`>#+-=|{}.!'
        result = text
        for char in escape_chars:
            result = result.replace(char, f'\\{char}')
        return result
    except Exception:
        # If conversion fails, return original text (will be sent as plain)
        return text


async def send_telegram_message(
    chat_id: str, text: str, settings: Settings, *, italic: bool = False
) -> bool | dict:
    """Send a message to a Telegram chat. Auto-detects and embeds media URLs.
    
    Converts standard Markdown to Telegram MarkdownV2 format before sending.
    If italic=True, wraps the message in MarkdownV2 italics (_..._).
    
    Returns:
        bool: True if sent successfully, False otherwise (for backwards compatibility)
        dict: If successful, returns {"success": True, "message_id": <id>} for new code
    """
    import httpx
    import logging
    logger = logging.getLogger(__name__)

    if not settings.telegram_bot_token:
        logger.warning("Telegram bot token not configured")
        return False

    telegram_base_url = f"https://api.telegram.org/bot{settings.telegram_bot_token}"
    
    # Check if message contains a media URL (pass public_app_url to convert relative proxy URLs)
    media_url, media_type = _extract_media_url(text, base_url=settings.public_app_url)
    logger.info(f"[TELEGRAM] Media detection: url_found={media_url is not None}, type={media_type}, text_preview={text[:150]}...")
    
    async with httpx.AsyncClient() as client:
        if media_url and media_type:
            # Remove markdown [text](url) or raw URL from caption
            import re
            # Handle both absolute URLs and relative proxy URLs in markdown
            caption = re.sub(r'\[[^\]]*\]\((https?://[^\)]+|/api/assets/[^\)]+)\)', '', text)
            # Remove raw absolute URLs
            caption = re.sub(r'https?://[^\s\)]+\.(?:mp4|webm|mov|avi|mkv|gif|mp3|wav|ogg|m4a|aac|jpg|jpeg|png|webp)(?:\?[^\s\)]*)?', '', caption, flags=re.IGNORECASE)
            # Remove raw relative proxy URLs
            caption = re.sub(r'/api/assets/[^\s\)]+\.(?:mp4|webm|mov|avi|mkv|gif|mp3|wav|ogg|m4a|aac|jpg|jpeg|png|webp)(?:\?[^\s\)]*)?', '', caption, flags=re.IGNORECASE)
            caption = re.sub(r'\s+', ' ', caption).strip().strip('.:')
            
            # Convert caption to MarkdownV2
            if caption:
                caption = _convert_to_telegram_markdown(caption)
                if italic:
                    caption = "_" + caption + "_"
            
            if media_type == 'video':
                endpoint = f"{telegram_base_url}/sendVideo"
                payload = {"chat_id": chat_id, "video": media_url, "caption": caption[:1024] if caption else None, "parse_mode": "MarkdownV2"}
            elif media_type == 'animation':
                endpoint = f"{telegram_base_url}/sendAnimation"
                payload = {"chat_id": chat_id, "animation": media_url, "caption": caption[:1024] if caption else None, "parse_mode": "MarkdownV2"}
            elif media_type == 'audio':
                endpoint = f"{telegram_base_url}/sendAudio"
                payload = {"chat_id": chat_id, "audio": media_url, "caption": caption[:1024] if caption else None, "parse_mode": "MarkdownV2"}
            elif media_type == 'photo':
                endpoint = f"{telegram_base_url}/sendPhoto"
                payload = {"chat_id": chat_id, "photo": media_url, "caption": caption[:1024] if caption else None, "parse_mode": "MarkdownV2"}
            else:
                endpoint = f"{telegram_base_url}/sendMessage"
                formatted_text = _convert_to_telegram_markdown(text)
                if italic:
                    formatted_text = "_" + formatted_text + "_"
                payload = {"chat_id": chat_id, "text": formatted_text, "parse_mode": "MarkdownV2"}
            
            # Remove None values
            payload = {k: v for k, v in payload.items() if v is not None}
            
            logger.info(f"[TELEGRAM] Sending {media_type} to {chat_id}, url_length={len(media_url)}")
            response = await client.post(endpoint, json=payload, timeout=60.0)  # Longer timeout for media
            if response.status_code == 200:
                result = response.json().get("result", {})
                message_id = result.get("message_id")
                logger.info(f"[TELEGRAM] Sent {media_type} to {chat_id}, message_id={message_id}")
                return {"success": True, "message_id": message_id} if message_id else True
            else:
                logger.warning(f"[TELEGRAM] Failed to send {media_type} (status={response.status_code}): {response.text[:500]}")
                # Fall back to plain text without parse_mode
                payload.pop("parse_mode", None)
                if "caption" in payload and caption:
                    # Use original caption without markdown conversion
                    original_caption = re.sub(r'\[[^\]]*\]\(https?://[^\)]+\)', '', text)
                    original_caption = re.sub(r'https?://[^\s\)]+\.(?:mp4|webm|mov|avi|mkv|gif|mp3|wav|ogg|m4a|aac|jpg|jpeg|png|webp)(?:\?[^\s\)]*)?', '', original_caption, flags=re.IGNORECASE)
                    original_caption = re.sub(r'\s+', ' ', original_caption).strip().strip('.:')
                    payload["caption"] = original_caption[:1024] if original_caption else None
                    payload = {k: v for k, v in payload.items() if v is not None}
                logger.info(f"[TELEGRAM] Retrying {media_type} without MarkdownV2")
                response = await client.post(endpoint, json=payload, timeout=60.0)
                if response.status_code == 200:
                    result = response.json().get("result", {})
                    message_id = result.get("message_id")
                    logger.info(f"[TELEGRAM] Sent {media_type} (plain) to {chat_id}, message_id={message_id}")
                    return {"success": True, "message_id": message_id} if message_id else True
                logger.warning(f"[TELEGRAM] Media send failed again (status={response.status_code}): {response.text[:300]}, falling back to text")
                # Fall through to text message
        
        # Send as text message with MarkdownV2
        formatted_text = _convert_to_telegram_markdown(text)
        if italic:
            formatted_text = "_" + formatted_text + "_"
        response = await client.post(
            f"{telegram_base_url}/sendMessage",
            json={"chat_id": chat_id, "text": formatted_text, "parse_mode": "MarkdownV2"},
            timeout=10.0
        )
        if response.status_code == 200:
            result = response.json().get("result", {})
            message_id = result.get("message_id")
            logger.info(f"Sent Telegram message to {chat_id}, message_id={message_id}")
            return {"success": True, "message_id": message_id} if message_id else True
        else:
            # Fallback to plain text if MarkdownV2 fails
            logger.warning(f"MarkdownV2 failed, trying plain text: {response.text}")
            response = await client.post(
                f"{telegram_base_url}/sendMessage",
                json={"chat_id": chat_id, "text": text},
                timeout=10.0
            )
            if response.status_code == 200:
                result = response.json().get("result", {})
                message_id = result.get("message_id")
                logger.info(f"Sent Telegram message (plain) to {chat_id}, message_id={message_id}")
                return {"success": True, "message_id": message_id} if message_id else True
            else:
                logger.error(f"Failed to send Telegram message: {response.text}")
                return False


def fetch_user_projects(
    user_id: str,
    settings: Settings,
    branch_id: str | None = None,
    project_id: str | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch projects for a user.

    Projects metadata are stored at: users/{userId}/projects
    Project data (Automerge) is stored at: users/{userId}/projects/{projectId}/branches/{branchId}

    When branch_id and project_id are provided, returns only that project using that branch's data
    (enforces chat_id -> branch mapping so the agent only sees that branch).
    """
    import logging
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    logger.info(f"Fetching projects for user: {user_id}" + (f" (branch={branch_id}, project={project_id})" if branch_id and project_id else ""))

    # Projects are stored under users/{userId}/projects
    projects_ref = db.collection("users").document(user_id).collection("projects")
    if project_id:
        # Single project
        proj_ref = projects_ref.document(project_id)
        proj_doc = proj_ref.get()
        results = [proj_doc] if proj_doc.exists else []
    else:
        results = list(projects_ref.stream())

    projects = []
    for doc in results:
        if not doc.exists:
            continue
        data = doc.to_dict()
        doc_id = doc.reference.id
        data["id"] = doc_id

        # Use session branch when provided (chat_id -> branch mapping)
        use_branch_id = branch_id if branch_id else data.get("currentBranch", "main")
        branch_ref = (
            db.collection("users")
            .document(user_id)
            .collection("projects")
            .document(doc_id)
            .collection("branches")
            .document(use_branch_id)
        )
        branch_doc = branch_ref.get()

        if branch_doc.exists:
            branch_data = branch_doc.to_dict()
            data["_branch"] = {
                "branchId": use_branch_id,
                "commitId": branch_data.get("commitId"),
                "timestamp": branch_data.get("timestamp"),
                "author": branch_data.get("author"),
                "hasAutomergeState": "automergeState" in branch_data,
                "automergeStateSize": len(branch_data.get("automergeState", "")) if branch_data.get("automergeState") else 0,
            }

            # Decode Automerge state if present
            if branch_data.get("automergeState"):
                try:
                    project_data = decode_automerge_state(branch_data["automergeState"])
                    if project_data:
                        data["_projectData"] = project_data
                except Exception as e:
                    logger.warning(f"Failed to decode Automerge state: {e}")

        projects.append(data)

    logger.info(f"Found {len(projects)} projects for user")
    return projects


def save_message_feedback(
    user_id: str,
    provider: str,
    message_id: str,
    reaction: str,
    session_id: str | None = None,
    settings: Settings | None = None,
) -> bool:
    """Save user feedback (emoji reaction) on a bot message to Firestore.
    
    Args:
        user_id: The user ID who reacted
        provider: The chat provider (e.g., 'telegram')
        message_id: The bot message ID that was reacted to
        reaction: The emoji reaction
        session_id: Optional session ID for context
        settings: Settings object for Firebase access
    
    Returns:
        True if saved successfully, False otherwise
    """
    import logging
    from datetime import datetime
    logger = logging.getLogger(__name__)

    if not settings:
        logger.error("Settings required for save_message_feedback")
        return False

    db = get_firestore_client(settings)

    try:
        feedback_data = {
            "userId": user_id,
            "provider": provider,
            "messageId": message_id,
            "reaction": reaction,
            "sessionId": session_id,
            "createdAt": datetime.utcnow().isoformat() + "Z",
        }
        
        # Save to feedback collection
        feedback_ref = db.collection("messageFeedback").document()
        feedback_ref.set(feedback_data)
        
        logger.info(f"Saved feedback: user={user_id}, provider={provider}, reaction={reaction}, message={message_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to save feedback: {e}")
        return False
