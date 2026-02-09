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
import { KickboxService } from './kickbox.service';

const SIGNUP_BONUS_CREDITS = 30;
const SIGNUP_BONUS_CLAIMS = 'signupBonusClaims';

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
    private readonly kickbox: KickboxService,
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
      const unit = price.unit_amount ?? 0;
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
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: success,
      cancel_url: cancel,
      subscription_data: {
        metadata: {
          userId: input.userId,
          packId: pack.id,
          credits: String(pack.credits),
        },
      },
      allow_promotion_codes: true,
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
    if (session.mode === 'subscription' && session.subscription) {
      await this.handleSubscriptionCheckoutCompleted(session);
      return;
    }
    this.logger.debug('Ignoring non-subscription checkout', { sessionId: session.id, mode: session.mode });
  }

  private async handleSubscriptionCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!subscriptionId) {
      this.logger.error('Subscription ID missing on checkout.session.completed', { sessionId: session.id });
      return;
    }
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    const meta = subscription.metadata ?? {};
    const userId = meta.userId;
    const packId = (meta.packId ?? '') as SubscriptionTier;
    const creditsPerMonth = (Number(meta.credits) || PACKS.find((p) => p.id === packId)?.credits) ?? 0;

    if (!userId || !packId || !PACKS.some((p) => p.id === packId)) {
      this.logger.error('Subscription missing userId/packId metadata', {
        subscriptionId,
        metadata: subscription.metadata,
      });
      return;
    }

    const billingRef = this.db
      .collection('users')
      .doc(userId)
      .collection('settings')
      .doc(BILLING_DOC);

    const now = new Date();
    const nowTs = Timestamp.fromDate(now);
    const customerId = subscription.customer ? String(subscription.customer) : null;
    const periodEnd = subscription.items?.data?.[0]?.current_period_end ?? 0;
    const currentPeriodEnd = new Date(periodEnd * 1000);

    await this.db.runTransaction(async (tx) => {
      const billingSnap = await tx.get(billingRef);
      const current = billingSnap.exists
        ? (billingSnap.data() as { credits?: number })
        : {};
      const prev =
        typeof current.credits === 'number' && Number.isFinite(current.credits) ? current.credits : 0;
      const next = prev + creditsPerMonth;

      tx.set(billingRef, {
        credits: next,
        tier: packId,
        subscriptionId,
        customerId,
        subscriptionStatus: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
        currentPeriodEnd: Timestamp.fromDate(currentPeriodEnd),
        updatedAt: nowTs,
      }, { merge: true });
    });

    this.logger.log('Subscription checkout completed', {
      userId,
      packId,
      creditsGranted: creditsPerMonth,
      subscriptionId,
    });
  }

  async handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    const meta = subscription.metadata ?? {};
    const userId = meta.userId;
    const packId = (meta.packId ?? '') as SubscriptionTier;
    const creditsPerMonth = (Number(meta.credits) || PACKS.find((p) => p.id === packId)?.credits) ?? 0;

    if (!userId || !packId || !PACKS.some((p) => p.id === packId)) {
      this.logger.warn('Subscription created with missing metadata', {
        subscriptionId: subscription.id,
        metadata: subscription.metadata,
      });
      return;
    }

    const billingRef = this.db
      .collection('users')
      .doc(userId)
      .collection('settings')
      .doc(BILLING_DOC);

    const now = new Date();
    const nowTs = Timestamp.fromDate(now);
    const customerId = subscription.customer ? String(subscription.customer) : null;
    const periodEnd = subscription.items?.data?.[0]?.current_period_end ?? 0;
    const currentPeriodEnd = new Date(periodEnd * 1000);

    await this.db.runTransaction(async (tx) => {
      const billingSnap = await tx.get(billingRef);
      const current = billingSnap.exists ? (billingSnap.data() as { credits?: number }) : {};
      const prev =
        typeof current.credits === 'number' && Number.isFinite(current.credits) ? current.credits : 0;
      const next = prev + creditsPerMonth;

      tx.set(billingRef, {
        credits: next,
        tier: packId,
        subscriptionId: subscription.id,
        customerId,
        subscriptionStatus: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
        currentPeriodEnd: Timestamp.fromDate(currentPeriodEnd),
        updatedAt: nowTs,
      }, { merge: true });
    });

    this.logger.log('Subscription created', { userId, packId, subscriptionId: subscription.id });
  }

  async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const meta = subscription.metadata ?? {};
    const userId = meta.userId;
    if (!userId) {
      this.logger.warn('Subscription updated with missing userId', {
        subscriptionId: subscription.id,
      });
      return;
    }

    // Read from webhook payload; Stripe may send fields at top level
    const raw = subscription as unknown as { current_period_end?: number; cancel_at_period_end?: boolean };
    const periodEnd =
      raw.current_period_end ?? subscription.items?.data?.[0]?.current_period_end ?? 0;
    const cancelAtPeriodEnd = raw.cancel_at_period_end === true;

    // Debug: log exactly what Stripe sent so we can verify cancel_at_period_end when user cancels
    this.logger.log('customer.subscription.updated payload', {
      subscriptionId: subscription.id,
      'raw.cancel_at_period_end': raw.cancel_at_period_end,
      'raw.current_period_end': raw.current_period_end,
      cancelAtPeriodEnd,
    });
    this.logger.log('Subscription updated', {
      userId,
      subscriptionId: subscription.id,
      status: subscription.status,
      cancelAtPeriodEnd,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    });

    const billingRef = this.db
      .collection('users')
      .doc(userId)
      .collection('settings')
      .doc(BILLING_DOC);

    const packId = (meta.packId ?? '') as SubscriptionTier;
    const currentPeriodEnd = new Date(periodEnd * 1000);

    await billingRef.set(
      {
        tier: PACKS.some((p) => p.id === packId) ? packId : undefined,
        subscriptionStatus: subscription.status,
        cancelAtPeriodEnd,
        currentPeriodEnd: Timestamp.fromDate(currentPeriodEnd),
        updatedAt: Timestamp.fromDate(new Date()),
      },
      { merge: true },
    );
  }

  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const meta = subscription.metadata ?? {};
    const userId = meta.userId;
    if (!userId) {
      this.logger.warn('Subscription deleted with missing userId', {
        subscriptionId: subscription.id,
      });
      return;
    }

    const billingRef = this.db
      .collection('users')
      .doc(userId)
      .collection('settings')
      .doc(BILLING_DOC);

    await billingRef.set(
      {
        subscriptionStatus: 'canceled',
        subscriptionId: null,
        customerId: null,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        updatedAt: Timestamp.fromDate(new Date()),
      },
      { merge: true },
    );

    this.logger.log('Subscription deleted', { userId, subscriptionId: subscription.id });
  }

  async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const subRef = invoice.parent?.subscription_details?.subscription;
    if (invoice.billing_reason !== 'subscription_cycle' || !subRef) {
      return;
    }
    const subscriptionId = typeof subRef === 'string' ? subRef : subRef.id;
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    const meta = subscription.metadata ?? {};
    const userId = meta.userId;
    const packId = (meta.packId ?? '') as SubscriptionTier;
    const pack = PACKS.find((p) => p.id === packId);
    const creditsPerMonth = pack?.credits ?? Number(meta.credits) ?? 0;

    if (!userId || creditsPerMonth <= 0) {
      this.logger.warn('Invoice paid but cannot grant renewal credits', {
        subscriptionId,
        userId,
        packId,
      });
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
      const current = billingSnap.exists ? (billingSnap.data() as { credits?: number }) : {};
      const prev =
        typeof current.credits === 'number' && Number.isFinite(current.credits) ? current.credits : 0;
      const next = prev + creditsPerMonth;

      const periodEnd = subscription.items?.data?.[0]?.current_period_end ?? 0;
      tx.set(billingRef, {
        credits: next,
        tier: packId,
        subscriptionStatus: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
        currentPeriodEnd: Timestamp.fromDate(new Date(periodEnd * 1000)),
        updatedAt: nowTs,
      }, { merge: true });
    });

    this.logger.log('Renewal credits added', { userId, packId, credits: creditsPerMonth, subscriptionId });
  }

  /**
   * Grant signup bonus (30 credits) to new users.
   * Only grants if: email is verified in Firebase, email passes Kickbox verification, and email has not received bonus before (fraud prevention).
   */
  async grantSignupBonus(userId: string, email: string, emailVerified: boolean): Promise<{ granted: boolean; credits?: number; reason?: string }> {
    const normalized = email?.trim().toLowerCase();
    if (!normalized) {
      return { granted: false };
    }

    // Hard requirement: email must be verified in Firebase before granting credits
    if (!emailVerified) {
      this.logger.log('Signup bonus denied: email not verified', { userId, email: normalized.slice(0, 3) + '***' });
      return { granted: false, reason: 'email_not_verified' };
    }

    const claimsRef = this.db.collection(SIGNUP_BONUS_CLAIMS);
    const claimDoc = claimsRef.doc(normalized);

    // Check if this email has already received the bonus (fraud prevention: signup -> bonus -> delete -> repeat)
    const existing = await claimDoc.get();
    if (existing.exists) {
      this.logger.log('Signup bonus already claimed for email', { email: normalized.slice(0, 3) + '***' });
      return { granted: false };
    }

    // Verify email with Kickbox
    const verified = await this.kickbox.verify(normalized);
    if (!verified) {
      return { granted: false };
    }

    const billingRef = this.db
      .collection('users')
      .doc(userId)
      .collection('settings')
      .doc(BILLING_DOC);

    const now = new Date();
    const nowTs = Timestamp.fromDate(now);

    await this.db.runTransaction(async (tx) => {
      // All reads must come before any writes in Firestore transactions
      const [claimSnap, billingSnap] = await Promise.all([
        tx.get(claimDoc),
        tx.get(billingRef),
      ]);

      if (claimSnap.exists) {
        throw new Error('Signup bonus already claimed');
      }

      const current = billingSnap.exists ? (billingSnap.data() as { credits?: number }) : {};
      const prev =
        typeof current.credits === 'number' && Number.isFinite(current.credits) ? current.credits : 0;
      const next = prev + SIGNUP_BONUS_CREDITS;

      // All writes after reads
      tx.set(claimDoc, {
        userId,
        email: normalized,
        claimedAt: nowTs,
      });

      tx.set(billingRef, {
        credits: next,
        updatedAt: nowTs,
      }, { merge: true });
    });

    this.logger.log('Signup bonus granted', { userId, credits: SIGNUP_BONUS_CREDITS });
    return { granted: true, credits: SIGNUP_BONUS_CREDITS };
  }

  async createCustomerPortalSession(userId: string): Promise<{ url: string }> {
    const billingRef = this.db
      .collection('users')
      .doc(userId)
      .collection('settings')
      .doc(BILLING_DOC);
    const snap = await billingRef.get();
    const data = snap.exists ? (snap.data() as { customerId?: string }) : {};
    const customerId = data.customerId;
    if (!customerId) {
      throw new Error('No billing customer found. Subscribe to a plan first.');
    }
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.frontendUrl}/settings`,
    });
    return { url: session.url! };
  }
}
