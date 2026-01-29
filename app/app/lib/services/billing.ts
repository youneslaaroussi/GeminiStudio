import { db } from '@/app/lib/server/firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

export type SubscriptionTier = 'starter' | 'pro' | 'enterprise';

export interface BillingData {
  credits: number;
  tier?: SubscriptionTier;
  subscriptionStatus?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  customerId?: string;
}

export const SUBSCRIPTION_TIERS: Record<
  SubscriptionTier,
  { name: string; creditsPerMonth: number; priceMonthly: number }
> = {
  starter: { name: 'Starter', creditsPerMonth: 100, priceMonthly: 9 },
  pro: { name: 'Pro', creditsPerMonth: 500, priceMonthly: 29 },
  enterprise: { name: 'Enterprise', creditsPerMonth: 2000, priceMonthly: 99 },
};

const BILLING_DOC = 'billing';

/**
 * Get current billing data (credits, tier) from Firebase.
 * Returns { credits: 0 } when no doc exists.
 */
export async function getBilling(userId: string): Promise<BillingData> {
  const ref = doc(db, 'users', userId, 'settings', BILLING_DOC);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { credits: 0 };
  const d = snap.data() as {
    credits?: number;
    tier?: SubscriptionTier;
    subscriptionStatus?: string;
    currentPeriodEnd?: { toDate?: () => Date } | Date;
    cancelAtPeriodEnd?: boolean;
    customerId?: string;
  };
  let currentPeriodEnd: string | undefined;
  if (d.currentPeriodEnd) {
    const t = d.currentPeriodEnd as { toDate?: () => Date };
    currentPeriodEnd = typeof t.toDate === 'function' ? t.toDate().toISOString() : undefined;
  }
  return {
    credits: typeof d.credits === 'number' ? d.credits : 0,
    tier: d.tier && SUBSCRIPTION_TIERS[d.tier] ? d.tier : undefined,
    subscriptionStatus: d.subscriptionStatus,
    currentPeriodEnd,
    cancelAtPeriodEnd: d.cancelAtPeriodEnd === true,
    customerId: d.customerId,
  };
}

/**
 * Subscribe to billing doc changes (real-time credits from Firebase).
 */
export function subscribeToBilling(
  userId: string,
  callback: (data: BillingData) => void
): () => void {
  const ref = doc(db, 'users', userId, 'settings', BILLING_DOC);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        callback({ credits: 0 });
        return;
      }
      const d = snap.data() as {
        credits?: number;
        tier?: SubscriptionTier;
        subscriptionStatus?: string;
        currentPeriodEnd?: { toDate?: () => Date } | Date;
        cancelAtPeriodEnd?: boolean;
        customerId?: string;
      };
      let currentPeriodEnd: string | undefined;
      if (d.currentPeriodEnd) {
        const t = d.currentPeriodEnd as { toDate?: () => Date };
        currentPeriodEnd = typeof t.toDate === 'function' ? t.toDate().toISOString() : undefined;
      }
      callback({
        credits: typeof d.credits === 'number' ? d.credits : 0,
        tier: d.tier && SUBSCRIPTION_TIERS[d.tier] ? d.tier : undefined,
        subscriptionStatus: d.subscriptionStatus,
        currentPeriodEnd,
        cancelAtPeriodEnd: d.cancelAtPeriodEnd === true,
        customerId: d.customerId,
      });
    },
    (err) => {
      console.error('Billing subscription error:', err);
      callback({ credits: 0 });
    }
  );
}

/**
 * Set subscription tier and fill credits to tier's monthly amount.
 * Creates or updates users/{userId}/settings/billing.
 */
export async function setSubscriptionTier(
  userId: string,
  tier: SubscriptionTier
): Promise<void> {
  const { creditsPerMonth } = SUBSCRIPTION_TIERS[tier];
  const ref = doc(db, 'users', userId, 'settings', BILLING_DOC);
  await setDoc(ref, { credits: creditsPerMonth, tier }, { merge: true });
}
