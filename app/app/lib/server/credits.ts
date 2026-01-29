/**
 * Server-side credits: deduct from Firestore billing doc.
 * Uses Firebase Admin Firestore. Call from API routes only.
 */

import { getAdminFirestore } from "@/app/lib/server/firebase-admin";

const BILLING_DOC = "billing";

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
