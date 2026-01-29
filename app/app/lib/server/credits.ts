/**
 * Server-side credits: deduct from Firestore billing doc.
 * Uses Firebase Admin Firestore. Call from API routes only.
 */

import { getAdminFirestore } from "@/app/lib/server/firebase-admin";

const BILLING_DOC = "billing";

export interface BillingData {
  credits: number;
  tier?: "starter" | "pro" | "enterprise";
  subscriptionStatus?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  customerId?: string;
}

/**
 * Read current billing data for a user. Use from API routes only.
 */
export async function getBilling(userId: string): Promise<BillingData> {
  const db = await getAdminFirestore();
  const ref = db.collection("users").doc(userId).collection("settings").doc(BILLING_DOC);
  const snap = await ref.get();
  if (!snap.exists) {
    return { credits: 0 };
  }
  const d = snap.data() as {
    credits?: number;
    tier?: "starter" | "pro" | "enterprise";
    subscriptionStatus?: string;
    currentPeriodEnd?: { toDate?: () => Date } | Date;
    cancelAtPeriodEnd?: boolean;
    customerId?: string;
  };
  let currentPeriodEnd: string | undefined;
  if (d.currentPeriodEnd) {
    const t = d.currentPeriodEnd as { toDate?: () => Date };
    currentPeriodEnd = typeof t.toDate === "function" ? t.toDate().toISOString() : undefined;
  }
  return {
    credits: typeof d.credits === "number" ? d.credits : 0,
    tier: d.tier,
    subscriptionStatus: d.subscriptionStatus,
    currentPeriodEnd,
    cancelAtPeriodEnd: d.cancelAtPeriodEnd === true,
    customerId: d.customerId,
  };
}

export interface DeductCreditsResult {
  previousBalance: number;
  newBalance: number;
  deducted: number;
}

/**
 * Deduct credits for the user. Runs in a Firestore transaction.
 * @throws Error if insufficient credits or transaction fails
 */
export async function deductCredits(
  userId: string,
  amount: number,
  _reason?: string
): Promise<DeductCreditsResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("deductCredits: amount must be a positive number");
  }

  const db = await getAdminFirestore();
  const ref = db.collection("users").doc(userId).collection("settings").doc(BILLING_DOC);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current =
      snap.exists && typeof (snap.data() as { credits?: number })?.credits === "number"
        ? (snap.data() as { credits: number }).credits
        : 0;

    if (current < amount) {
      throw new Error(
        `Insufficient credits: have ${current}, need ${amount}`
      );
    }

    const next = current - amount;
    const now = new Date().toISOString();
    tx.set(ref, { credits: next, updatedAt: now }, { merge: true });

    return { previousBalance: current, newBalance: next, deducted: amount };
  });

  return result;
}

export interface AddCreditsResult {
  previousBalance: number;
  newBalance: number;
  added: number;
}

/**
 * Add credits to the user's billing doc. Creates the doc if missing.
 * @throws Error if amount is invalid
 */
export async function addCredits(
  userId: string,
  amount: number,
  _reason?: string
): Promise<AddCreditsResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("addCredits: amount must be a positive number");
  }

  const db = await getAdminFirestore();
  const ref = db.collection("users").doc(userId).collection("settings").doc(BILLING_DOC);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current =
      snap.exists && typeof (snap.data() as { credits?: number })?.credits === "number"
        ? (snap.data() as { credits: number }).credits
        : 0;

    const next = current + amount;
    const now = new Date().toISOString();
    tx.set(ref, { credits: next, updatedAt: now }, { merge: true });

    return { previousBalance: current, newBalance: next, added: amount };
  });

  return result;
}
