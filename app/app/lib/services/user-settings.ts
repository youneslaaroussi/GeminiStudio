import { db } from '@/app/lib/server/firebase';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';

export interface TelegramIntegration {
  telegramChatId: string;
  telegramUsername?: string;
  linkedAt: string;
}

export interface UserIntegrations {
  telegram?: TelegramIntegration;
}

export interface PendingTelegramLink {
  code: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export interface TelegramLinkCode {
  code: string;
  userId: string;
  userEmail: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

/**
 * Generate a random 6-character alphanumeric code
 */
function generateLinkCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars (0, O, 1, I)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Get user's integrations
 */
export async function getUserIntegrations(userId: string): Promise<UserIntegrations> {
  const docRef = doc(db, 'users', userId, 'settings', 'integrations');
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    return docSnap.data() as UserIntegrations;
  }
  return {};
}

/**
 * Create a Telegram link code for the user
 * Code expires in 10 minutes
 */
export async function createTelegramLinkCode(userId: string, userEmail: string): Promise<string> {
  // Check for existing pending code and clean it up
  const pendingRef = doc(db, 'users', userId, 'settings', 'pendingTelegramLink');
  const pendingSnap = await getDoc(pendingRef);

  if (pendingSnap.exists()) {
    const pendingData = pendingSnap.data() as PendingTelegramLink;
    await deleteDoc(doc(db, 'telegramLinkCodes', pendingData.code));
  }

  const code = generateLinkCode();

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + 10 * 60 * 1000); // 10 minutes

  // Store the code in telegramLinkCodes for bot lookup
  const linkCode: TelegramLinkCode = {
    code,
    userId,
    userEmail,
    createdAt: now,
    expiresAt,
  };
  await setDoc(doc(db, 'telegramLinkCodes', code), linkCode);

  // Store reference in user's settings for client-side access
  const pendingLink: PendingTelegramLink = {
    code,
    createdAt: now,
    expiresAt,
  };
  await setDoc(pendingRef, pendingLink);

  return code;
}

/**
 * Unlink Telegram integration
 */
export async function unlinkTelegram(userId: string): Promise<void> {
  // Get current integration to find the telegram chat ID
  const integrations = await getUserIntegrations(userId);

  if (integrations.telegram?.telegramChatId) {
    await deleteDoc(doc(db, 'telegramIntegrations', integrations.telegram.telegramChatId));
  }

  // Update user's integrations to remove telegram
  const docRef = doc(db, 'users', userId, 'settings', 'integrations');
  await setDoc(docRef, { telegram: null }, { merge: true });
}

/**
 * Check if a link code is still pending (not yet used)
 */
export async function getPendingLinkCode(userId: string): Promise<string | null> {
  const pendingRef = doc(db, 'users', userId, 'settings', 'pendingTelegramLink');
  const pendingSnap = await getDoc(pendingRef);

  if (!pendingSnap.exists()) {
    return null;
  }

  const data = pendingSnap.data() as PendingTelegramLink;

  if (data.expiresAt.toMillis() < Date.now()) {
    await deleteDoc(pendingRef);
    await deleteDoc(doc(db, 'telegramLinkCodes', data.code));
    return null;
  }

  return data.code;
}
