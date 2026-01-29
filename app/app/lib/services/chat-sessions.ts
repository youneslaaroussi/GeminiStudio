import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  FieldValue,
} from 'firebase/firestore';
import { db } from '@/app/lib/server/firebase';
import type { ChatMode, TimelineChatMessage } from '@/app/types/chat';

/**
 * Recursively remove undefined values from an object (Firestore doesn't support undefined)
 * Preserves Firestore FieldValue objects like serverTimestamp()
 */
function sanitizeForFirestore<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return null as T;
  }
  // Preserve Firestore FieldValue objects (like serverTimestamp())
  if (obj instanceof FieldValue) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore) as T;
  }
  if (typeof obj === 'object' && obj !== null) {
    // Check if it's a plain object (not a class instance like Date, etc.)
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      // Keep non-plain objects as-is (Date, FieldValue, etc.)
      return obj;
    }
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        sanitized[key] = sanitizeForFirestore(value);
      }
    }
    return sanitized as T;
  }
  return obj;
}

export interface SavedChatSession {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentMode: ChatMode;
  messages: TimelineChatMessage[];
  userId: string;
  /** Branch ID for this chat (direct chat_id → branch mapping). Set by langgraph server on first teleport. */
  branchId?: string;
}

export interface ChatSessionSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * Save a chat session to Firebase for a user
 */
export async function saveChatSession(
  userId: string,
  sessionId: string,
  name: string,
  mode: ChatMode,
  messages: TimelineChatMessage[]
): Promise<SavedChatSession> {
  const sessionRef = doc(db, 'users', userId, 'chatSessions', sessionId);

  const existingDoc = await getDoc(sessionRef);
  const now = new Date().toISOString();

  const sessionData: SavedChatSession = {
    id: sessionId,
    name,
    createdAt: existingDoc.exists() ? existingDoc.data().createdAt : now,
    updatedAt: now,
    currentMode: mode,
    messages,
    userId,
  };

  // Sanitize the data to remove undefined values (Firestore doesn't support them)
  const sanitizedData = sanitizeForFirestore({
    ...sessionData,
    // Store timestamps as Firestore timestamps for ordering
    _createdAt: existingDoc.exists()
      ? existingDoc.data()._createdAt
      : serverTimestamp(),
    _updatedAt: serverTimestamp(),
  });

  await setDoc(sessionRef, sanitizedData);

  return sessionData;
}

/**
 * Load a specific chat session
 */
export async function loadChatSession(
  userId: string,
  sessionId: string
): Promise<SavedChatSession | null> {
  const sessionRef = doc(db, 'users', userId, 'chatSessions', sessionId);
  const sessionDoc = await getDoc(sessionRef);

  if (!sessionDoc.exists()) {
    return null;
  }

  const data = sessionDoc.data();
  return {
    id: data.id,
    name: data.name,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    currentMode: data.currentMode,
    messages: data.messages || [],
    userId: data.userId,
    branchId: data.branchId,
  };
}

/**
 * List all chat sessions for a user (summaries only, without full messages)
 */
export async function listChatSessions(
  userId: string,
  maxResults: number = 50
): Promise<ChatSessionSummary[]> {
  const sessionsRef = collection(db, 'users', userId, 'chatSessions');
  const q = query(sessionsRef, orderBy('_updatedAt', 'desc'), limit(maxResults));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: data.id,
      name: data.name,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      messageCount: data.messages?.length || 0,
    };
  });
}

/**
 * Delete a chat session
 */
export async function deleteChatSession(
  userId: string,
  sessionId: string
): Promise<void> {
  const sessionRef = doc(db, 'users', userId, 'chatSessions', sessionId);
  await deleteDoc(sessionRef);
}

/**
 * Generate a default name for a chat session based on the first message
 */
export function generateSessionName(messages: TimelineChatMessage[]): string {
  if (!messages || messages.length === 0) {
    return `Chat ${new Date().toLocaleDateString()}`;
  }

  // Find the first user message
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (firstUserMessage && firstUserMessage.parts) {
    for (const part of firstUserMessage.parts) {
      if (part && typeof part === 'object' && 'text' in part && part.text) {
        // Truncate to first 50 chars
        const text = String(part.text).trim();
        if (text.length > 50) {
          return text.substring(0, 47) + '...';
        }
        return text;
      }
    }
  }

  return `Chat ${new Date().toLocaleDateString()}`;
}
