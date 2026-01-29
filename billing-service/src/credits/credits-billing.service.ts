import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import type { App } from 'firebase-admin/app';
import {
  getFirestore,
  Timestamp,
  type Firestore,
  type CollectionReference,
} from 'firebase-admin/firestore';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';

export type SubscriptionTier = 'starter' | 'pro' | 'enterprise';

interface PackConfig {
  id: SubscriptionTier;
  name: string;
  credits: number;
  priceIdEnv: string;
}

export interface CreditPack {
  id: string;
  name: string;
  credits: number;
  amountUsd: number;
  currency: string;
  priceId: string;
}

export interface CreateCheckoutInput {
  userId: string;
  packId: SubscriptionTier;
  successUrl?: string;
  cancelUrl?: string;
}

export type PurchaseStatus = 'pending' | 'completed' | 'failed';

export interface CreditPurchaseDoc {
  id: string;
  userId: string;
  packId: string;
  credits: number;
  stripeSessionId: string;
  stripeCustomerId?: string | null;
  status: PurchaseStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp | null;
}

const PACKS: PackConfig[] = [
  { id: 'starter', name: 'Starter', credits: 100, priceIdEnv: 'STRIPE_PRICE_STARTER' },
  { id: 'pro', name: 'Pro', credits: 500, priceIdEnv: 'STRIPE_PRICE_PRO' },
  { id: 'enterprise', name: 'Enterprise', credits: 2000, priceIdEnv: 'STRIPE_PRICE_ENTERPRISE' },
];

const BILLING_DOC = 'billing';

@Injectable()
export class CreditsBillingService {
  private readonly logger = new Logger(CreditsBillingService.name);
  private readonly stripe: Stripe;
  private readonly db: Firestore;
  private readonly purchasesRef: CollectionReference<CreditPurchaseDoc>;
  private readonly webhookSecret: string | null;
  private readonly frontendUrl: string;

  constructor(
    private readonly config: ConfigService,
    @Inject('FIREBASE_ADMIN') private readonly firebaseApp: App,
  ) {
    const secret = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secret) {
      this.logger.warn('STRIPE_SECRET_KEY not set; credit checkout will fail');
    }
    this.stripe = new Stripe(secret ?? '');
    this.db = getFirestore(this.firebaseApp);
    this.purchasesRef = this.db.collection('creditPurchases') as CollectionReference<CreditPurchaseDoc>;
    this.webhookSecret = this.config.get<string>('STRIPE_CREDITS_WEBHOOK_SECRET') ?? null;
    this.frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
  }

  private resolvePriceId(pack: PackConfig): string {
    const id = this.config.get<string>(pack.priceIdEnv);
    if (!id) {
      throw new Error(
        `CONFIG: ${pack.priceIdEnv} is required. Set Stripe price IDs for credit packs.`,
      );
    }
    return id;
  }

  async listPacks(): Promise<CreditPack[]> {
    const out: CreditPack[] = [];
    for (const pack of PACKS) {
      const priceId = this.resolvePriceId(pack);
      const price = await this.stripe.prices.retrieve(priceId);
      const unit = price.unit_amount;
      if (unit == null) {
        throw new Error(`Stripe price ${priceId} has no unit_amount`);
      }
      out.push({
        id: pack.id,
        name: pack.name,
        credits: pack.credits,
        amountUsd: unit / 100,
        currency: (price.currency ?? 'usd').toUpperCase(),
        priceId,
      });
    }
    return out;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<{ url: string; sessionId: string }> {
    const pack = PACKS.find((p) => p.id === input.packId);
    if (!pack) {
      throw new Error(`Unknown pack: ${input.packId}`);
    }
    const priceId = this.resolvePriceId(pack);

    const success =
      input.successUrl ??
      `${this.frontendUrl}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancel = input.cancelUrl ?? `${this.frontendUrl}/settings?billing=cancel`;

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      customer_creation: 'if_required',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: success,
      cancel_url: cancel,
      metadata: {
        userId: input.userId,
        packId: pack.id,
        credits: String(pack.credits),
      },
      allow_promotion_codes: true,
    });

    const purchaseId = randomUUID();
    const now = new Date();

    await this.purchasesRef.doc(purchaseId).set({
      id: purchaseId,
      userId: input.userId,
      packId: pack.id,
      credits: pack.credits,
      stripeSessionId: session.id,
      stripeCustomerId: session.customer ? String(session.customer) : null,
      status: 'pending',
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    });

    return {
      url: session.url!,
      sessionId: session.id,
    };
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new Error('STRIPE_CREDITS_WEBHOOK_SECRET is not set');
    }
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const meta = session.metadata ?? {};
    const userId = meta.userId;
    const packId = meta.packId;
    const credits = Number(meta.credits);

    if (!userId || !packId || !Number.isFinite(credits) || credits <= 0) {
      this.logger.error('Checkout session missing metadata', { sessionId: session.id });
      return;
    }

    const snap = await this.purchasesRef
      .where('stripeSessionId', '==', session.id)
      .limit(1)
      .get();

    if (snap.empty) {
      this.logger.warn('No purchase found for session', { sessionId: session.id });
      return;
    }

    const docRef = snap.docs[0].ref;
    const purchase = snap.docs[0].data();

    if (purchase.status === 'completed') {
      this.logger.log('Purchase already processed', { sessionId: session.id });
      return;
    }

    const billingRef = this.db
      .collection('users')
      .doc(userId)
      .collection('settings')
      .doc(BILLING_DOC);

    const now = new Date();
    const nowTs = Timestamp.fromDate(now);

    await this.db.runTransaction(async (tx) => {
      const billingSnap = await tx.get(billingRef);
      const current = billingSnap.exists
        ? (billingSnap.data() as { credits?: number; tier?: string })
        : {};
      const prev = typeof current.credits === 'number' && Number.isFinite(current.credits)
        ? current.credits
        : 0;
      const next = prev + credits;

      tx.set(billingRef, { credits: next, tier: packId, updatedAt: nowTs }, { merge: true });
      tx.update(docRef, {
        status: 'completed',
        updatedAt: nowTs,
        completedAt: nowTs,
        stripeCustomerId: session.customer ? String(session.customer) : purchase.stripeCustomerId,
      });
    });

    this.logger.log('Credits added', {
      userId,
      packId,
      credits,
      sessionId: session.id,
    });
  }
}
