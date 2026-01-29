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
const crypto_1 = require("crypto");
const PACKS = [
    { id: 'starter', name: 'Starter', credits: 100, priceIdEnv: 'STRIPE_PRICE_STARTER' },
    { id: 'pro', name: 'Pro', credits: 500, priceIdEnv: 'STRIPE_PRICE_PRO' },
    { id: 'enterprise', name: 'Enterprise', credits: 2000, priceIdEnv: 'STRIPE_PRICE_ENTERPRISE' },
];
const BILLING_DOC = 'billing';
let CreditsBillingService = CreditsBillingService_1 = class CreditsBillingService {
    config;
    firebaseApp;
    logger = new common_1.Logger(CreditsBillingService_1.name);
    stripe;
    db;
    purchasesRef;
    webhookSecret;
    frontendUrl;
    constructor(config, firebaseApp) {
        this.config = config;
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
        const purchaseId = (0, crypto_1.randomUUID)();
        const now = new Date();
        await this.purchasesRef.doc(purchaseId).set({
            id: purchaseId,
            userId: input.userId,
            packId: pack.id,
            credits: pack.credits,
            stripeSessionId: session.id,
            stripeCustomerId: session.customer ? String(session.customer) : null,
            status: 'pending',
            createdAt: firestore_1.Timestamp.fromDate(now),
            updatedAt: firestore_1.Timestamp.fromDate(now),
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
        const nowTs = firestore_1.Timestamp.fromDate(now);
        await this.db.runTransaction(async (tx) => {
            const billingSnap = await tx.get(billingRef);
            const current = billingSnap.exists
                ? billingSnap.data()
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
};
exports.CreditsBillingService = CreditsBillingService;
exports.CreditsBillingService = CreditsBillingService = CreditsBillingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_2.Inject)('FIREBASE_ADMIN')),
    __metadata("design:paramtypes", [config_1.ConfigService, Object])
], CreditsBillingService);
//# sourceMappingURL=credits-billing.service.js.map