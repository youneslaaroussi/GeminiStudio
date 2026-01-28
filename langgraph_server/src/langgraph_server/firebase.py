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
    """
    from automerge.core import ObjType

    obj_type = doc.object_type(obj_id)

    if obj_type == ObjType.Map:
        result = {}
        for key in doc.keys(obj_id):
            value = doc.get(obj_id, key)
            if value is not None:
                val_type, val = value
                if val_type in (ObjType.Map, ObjType.List, ObjType.Text):
                    # It's a nested object, recurse
                    result[key] = automerge_doc_to_dict(doc, val)
                else:
                    result[key] = val
        return result
    elif obj_type == ObjType.List:
        result = []
        length = doc.length(obj_id)
        for i in range(length):
            value = doc.get(obj_id, i)
            if value is not None:
                val_type, val = value
                if val_type in (ObjType.Map, ObjType.List, ObjType.Text):
                    result.append(automerge_doc_to_dict(doc, val))
                else:
                    result.append(val)
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


async def send_telegram_message(chat_id: str, text: str, settings: Settings) -> bool:
    """Send a message to a Telegram chat."""
    import httpx
    import logging
    logger = logging.getLogger(__name__)

    if not settings.telegram_bot_token:
        logger.warning("Telegram bot token not configured")
        return False

    api_url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"

    async with httpx.AsyncClient() as client:
        response = await client.post(
            api_url,
            json={"chat_id": chat_id, "text": text},
            timeout=10.0
        )
        if response.status_code == 200:
            logger.info(f"Sent Telegram message to {chat_id}")
            return True
        else:
            logger.error(f"Failed to send Telegram message: {response.text}")
            return False


def fetch_user_projects(user_id: str, settings: Settings) -> list[dict[str, Any]]:
    """
    Fetch all projects for a user.

    Projects metadata are stored at: users/{userId}/projects
    Project data (Automerge) is stored at: users/{userId}/projects/{projectId}/branches/{branchId}
    """
    import logging
    logger = logging.getLogger(__name__)

    db = get_firestore_client(settings)

    logger.info(f"Fetching projects for user: {user_id}")

    # Projects are stored under users/{userId}/projects
    projects_ref = db.collection("users").document(user_id).collection("projects")
    results = list(projects_ref.stream())

    projects = []
    for doc in results:
        data = doc.to_dict()
        data["id"] = doc.id

        # Try to fetch the main branch data (Automerge state)
        branch_id = data.get("currentBranch", "main")
        branch_ref = db.collection("users").document(user_id).collection("projects").document(doc.id).collection("branches").document(branch_id)
        branch_doc = branch_ref.get()

        if branch_doc.exists:
            branch_data = branch_doc.to_dict()
            data["_branch"] = {
                "branchId": branch_id,
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
