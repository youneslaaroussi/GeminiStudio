"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var CreditsBillingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditsBillingService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const common_2 = require("@nestjs/common");
const firestore_1 = require("firebase-admin/firestore");
const stripe_1 = __importDefault(require("stripe"));
const kickbox_service_1 = require("./kickbox.service");
const SIGNUP_BONUS_CREDITS = 30;
const SIGNUP_BONUS_CLAIMS = 'signupBonusClaims';
const PACKS = [
    { id: 'starter', name: 'Starter', credits: 100, priceIdEnv: 'STRIPE_PRICE_STARTER' },
    { id: 'pro', name: 'Pro', credits: 500, priceIdEnv: 'STRIPE_PRICE_PRO' },
    { id: 'enterprise', name: 'Enterprise', credits: 2000, priceIdEnv: 'STRIPE_PRICE_ENTERPRISE' },
];
const BILLING_DOC = 'billing';
let CreditsBillingService = CreditsBillingService_1 = class CreditsBillingService {
    config;
    kickbox;
    firebaseApp;
    logger = new common_1.Logger(CreditsBillingService_1.name);
    stripe;
    db;
    purchasesRef;
    webhookSecret;
    frontendUrl;
    constructor(config, kickbox, firebaseApp) {
        this.config = config;
        this.kickbox = kickbox;
        this.firebaseApp = firebaseApp;
        const secret = this.config.get('STRIPE_SECRET_KEY');
        if (!secret) {
            this.logger.warn('STRIPE_SECRET_KEY not set; credit checkout will fail');
        }
        this.stripe = new stripe_1.default(secret ?? '');
        this.db = (0, firestore_1.getFirestore)(this.firebaseApp);
        this.purchasesRef = this.db.collection('creditPurchases');
        this.webhookSecret = this.config.get('STRIPE_CREDITS_WEBHOOK_SECRET') ?? null;
        this.frontendUrl = this.config.get('FRONTEND_URL') ?? 'http://localhost:3000';
    }
    resolvePriceId(pack) {
        const id = this.config.get(pack.priceIdEnv);
        if (!id) {
            throw new Error(`CONFIG: ${pack.priceIdEnv} is required. Set Stripe price IDs for credit packs.`);
        }
        return id;
    }
    async listPacks() {
        const out = [];
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
    async createCheckout(input) {
        const pack = PACKS.find((p) => p.id === input.packId);
        if (!pack) {
            throw new Error(`Unknown pack: ${input.packId}`);
        }
        const priceId = this.resolvePriceId(pack);
        const success = input.successUrl ??
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
            url: session.url,
            sessionId: session.id,
        };
    }
    constructWebhookEvent(rawBody, signature) {
        if (!this.webhookSecret) {
            throw new Error('STRIPE_CREDITS_WEBHOOK_SECRET is not set');
        }
        return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    }
    async handleCheckoutCompleted(session) {
        if (session.mode === 'subscription' && session.subscription) {
            await this.handleSubscriptionCheckoutCompleted(session);
            return;
        }
        this.logger.debug('Ignoring non-subscription checkout', { sessionId: session.id, mode: session.mode });
    }
    async handleSubscriptionCheckoutCompleted(session) {
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (!subscriptionId) {
            this.logger.error('Subscription ID missing on checkout.session.completed', { sessionId: session.id });
            return;
        }
        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
        const meta = subscription.metadata ?? {};
        const userId = meta.userId;
        const packId = (meta.packId ?? '');
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
        const nowTs = firestore_1.Timestamp.fromDate(now);
        const customerId = subscription.customer ? String(subscription.customer) : null;
        const periodEnd = subscription.items?.data?.[0]?.current_period_end ?? 0;
        const currentPeriodEnd = new Date(periodEnd * 1000);
        await this.db.runTransaction(async (tx) => {
            const billingSnap = await tx.get(billingRef);
            const current = billingSnap.exists
                ? billingSnap.data()
                : {};
            const prev = typeof current.credits === 'number' && Number.isFinite(current.credits) ? current.credits : 0;
            const next = prev + creditsPerMonth;
            tx.set(billingRef, {
                credits: next,
                tier: packId,
                subscriptionId,
                customerId,
                subscriptionStatus: subscription.status,
                cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
                currentPeriodEnd: firestore_1.Timestamp.fromDate(currentPeriodEnd),
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
    async handleSubscriptionCreated(subscription) {
        const meta = subscription.metadata ?? {};
        const userId = meta.userId;
        const packId = (meta.packId ?? '');
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
        const nowTs = firestore_1.Timestamp.fromDate(now);
        const customerId = subscription.customer ? String(subscription.customer) : null;
        const periodEnd = subscription.items?.data?.[0]?.current_period_end ?? 0;
        const currentPeriodEnd = new Date(periodEnd * 1000);
        await this.db.runTransaction(async (tx) => {
            const billingSnap = await tx.get(billingRef);
            const current = billingSnap.exists ? billingSnap.data() : {};
            const prev = typeof current.credits === 'number' && Number.isFinite(current.credits) ? current.credits : 0;
            const next = prev + creditsPerMonth;
            tx.set(billingRef, {
                credits: next,
                tier: packId,
                subscriptionId: subscription.id,
                customerId,
                subscriptionStatus: subscription.status,
                cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
                currentPeriodEnd: firestore_1.Timestamp.fromDate(currentPeriodEnd),
                updatedAt: nowTs,
            }, { merge: true });
        });
        this.logger.log('Subscription created', { userId, packId, subscriptionId: subscription.id });
    }
    async handleSubscriptionUpdated(subscription) {
        const meta = subscription.metadata ?? {};
        const userId = meta.userId;
        if (!userId) {
            this.logger.warn('Subscription updated with missing userId', {
                subscriptionId: subscription.id,
            });
            return;
        }
        const raw = subscription;
        const periodEnd = raw.current_period_end ?? subscription.items?.data?.[0]?.current_period_end ?? 0;
        const cancelAtPeriodEnd = raw.cancel_at_period_end === true;
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
        const packId = (meta.packId ?? '');
        const currentPeriodEnd = new Date(periodEnd * 1000);
        await billingRef.set({
            tier: PACKS.some((p) => p.id === packId) ? packId : undefined,
            subscriptionStatus: subscription.status,
            cancelAtPeriodEnd,
            currentPeriodEnd: firestore_1.Timestamp.fromDate(currentPeriodEnd),
            updatedAt: firestore_1.Timestamp.fromDate(new Date()),
        }, { merge: true });
    }
    async handleSubscriptionDeleted(subscription) {
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
        await billingRef.set({
            subscriptionStatus: 'canceled',
            subscriptionId: null,
            customerId: null,
            cancelAtPeriodEnd: false,
            currentPeriodEnd: null,
            updatedAt: firestore_1.Timestamp.fromDate(new Date()),
        }, { merge: true });
        this.logger.log('Subscription deleted', { userId, subscriptionId: subscription.id });
    }
    async handleInvoicePaid(invoice) {
        const subRef = invoice.parent?.subscription_details?.subscription;
        if (invoice.billing_reason !== 'subscription_cycle' || !subRef) {
            return;
        }
        const subscriptionId = typeof subRef === 'string' ? subRef : subRef.id;
        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
        const meta = subscription.metadata ?? {};
        const userId = meta.userId;
        const packId = (meta.packId ?? '');
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
        const nowTs = firestore_1.Timestamp.fromDate(now);
        await this.db.runTransaction(async (tx) => {
            const billingSnap = await tx.get(billingRef);
            const current = billingSnap.exists ? billingSnap.data() : {};
            const prev = typeof current.credits === 'number' && Number.isFinite(current.credits) ? current.credits : 0;
            const next = prev + creditsPerMonth;
            const periodEnd = subscription.items?.data?.[0]?.current_period_end ?? 0;
            tx.set(billingRef, {
                credits: next,
                tier: packId,
                subscriptionStatus: subscription.status,
                cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
                currentPeriodEnd: firestore_1.Timestamp.fromDate(new Date(periodEnd * 1000)),
                updatedAt: nowTs,
            }, { merge: true });
        });
        this.logger.log('Renewal credits added', { userId, packId, credits: creditsPerMonth, subscriptionId });
    }
    async grantSignupBonus(userId, email) {
        const normalized = email?.trim().toLowerCase();
        if (!normalized) {
            return { granted: false };
        }
        const claimsRef = this.db.collection(SIGNUP_BONUS_CLAIMS);
        const claimDoc = claimsRef.doc(normalized);
        const existing = await claimDoc.get();
        if (existing.exists) {
            this.logger.log('Signup bonus already claimed for email', { email: normalized.slice(0, 3) + '***' });
            return { granted: false };
        }
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
        const nowTs = firestore_1.Timestamp.fromDate(now);
        await this.db.runTransaction(async (tx) => {
            const [claimSnap, billingSnap] = await Promise.all([
                tx.get(claimDoc),
                tx.get(billingRef),
            ]);
            if (claimSnap.exists) {
                throw new Error('Signup bonus already claimed');
            }
            const current = billingSnap.exists ? billingSnap.data() : {};
            const prev = typeof current.credits === 'number' && Number.isFinite(current.credits) ? current.credits : 0;
            const next = prev + SIGNUP_BONUS_CREDITS;
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
    async createCustomerPortalSession(userId) {
        const billingRef = this.db
            .collection('users')
            .doc(userId)
            .collection('settings')
            .doc(BILLING_DOC);
        const snap = await billingRef.get();
        const data = snap.exists ? snap.data() : {};
        const customerId = data.customerId;
        if (!customerId) {
            throw new Error('No billing customer found. Subscribe to a plan first.');
        }
        const session = await this.stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${this.frontendUrl}/settings`,
        });
        return { url: session.url };
    }
};
exports.CreditsBillingService = CreditsBillingService;
exports.CreditsBillingService = CreditsBillingService = CreditsBillingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_2.Inject)('FIREBASE_ADMIN')),
    __metadata("design:paramtypes", [config_1.ConfigService,
        kickbox_service_1.KickboxService, Object])
], CreditsBillingService);
//# sourceMappingURL=credits-billing.service.js.map