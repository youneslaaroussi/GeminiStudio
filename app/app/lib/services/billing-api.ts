import { getAuthHeaders } from '@/app/lib/hooks/useAuthFetch';

const BASE = process.env.NEXT_PUBLIC_BILLING_SERVICE_URL ?? '';

export type PackId = 'starter' | 'pro' | 'enterprise';

export interface CreditPack {
  id: PackId;
  name: string;
  credits: number;
  amountUsd: number;
  currency: string;
  priceId: string;
}

export async function listPacks(): Promise<CreditPack[]> {
  if (!BASE) return [];
  const res = await fetch(`${BASE}/credits/packs`);
  if (!res.ok) throw new Error('Failed to fetch credit packs');
  return res.json();
}

export interface CreateCheckoutInput {
  packId: PackId;
  successUrl?: string;
  cancelUrl?: string;
}

export async function createCheckout(input: CreateCheckoutInput): Promise<{ url: string; sessionId: string }> {
  if (!BASE) throw new Error('Billing service URL not configured');
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE}/credits/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || 'Checkout failed');
  }
  return res.json();
}

/** Create a Stripe Customer Portal session for managing subscription and payment method. */
export async function createPortalSession(): Promise<{ url: string }> {
  if (!BASE) throw new Error('Billing service URL not configured');
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE}/credits/portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || 'Failed to open billing portal');
  }
  return res.json();
}
