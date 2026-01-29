'use client';

import { useCallback, useEffect, useState } from 'react';
import { getBilling, subscribeToBilling, type BillingData } from '@/app/lib/services/billing';

const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Credits from Firebase billing. Subscribes in real time, supports manual refresh
 * and auto-refresh every 5 minutes.
 */
export function useCredits(userId: string | undefined) {
  const [billing, setBilling] = useState<BillingData>({ credits: 0 });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await getBilling(userId);
      setBilling(data);
    } catch (e) {
      console.error('Credits refresh failed:', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const unsub = subscribeToBilling(userId, setBilling);
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const t = setInterval(refresh, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [userId, refresh]);

  return { credits: billing.credits, tier: billing.tier, refresh, loading };
}
