'use client';

import { useCallback, useEffect, useState } from 'react';
import { getAuthHeaders } from '@/app/lib/hooks/useAuthFetch';
import { subscribeToBilling, type BillingData } from '@/app/lib/services/billing';

const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Credits from Firebase billing. Subscribes in real time, supports manual refresh
 * (via GET /api/credits) and auto-refresh every 5 minutes.
 */
export function useCredits(userId: string | undefined) {
  const [billing, setBilling] = useState<BillingData>({ credits: 0 });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/credits', { headers });
      if (!res.ok) {
        throw new Error(res.status === 401 ? 'Unauthorized' : 'Failed to load credits');
      }
      const data: BillingData = await res.json();
      setBilling(data);
    } catch (e) {
      console.error('Credits refresh failed:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    const unsub = subscribeToBilling(userId, setBilling);
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    const t = setInterval(refresh, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { credits: billing.credits, tier: billing.tier, refresh, loading };
}
