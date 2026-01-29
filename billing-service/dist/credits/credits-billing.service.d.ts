import { ConfigService } from '@nestjs/config';
import type { App } from 'firebase-admin/app';
import { Timestamp } from 'firebase-admin/firestore';
import Stripe from 'stripe';
export type SubscriptionTier = 'starter' | 'pro' | 'enterprise';
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
export declare class CreditsBillingService {
    private readonly config;
    private readonly firebaseApp;
    private readonly logger;
    private readonly stripe;
    private readonly db;
    private readonly purchasesRef;
    private readonly webhookSecret;
    private readonly frontendUrl;
    constructor(config: ConfigService, firebaseApp: App);
    private resolvePriceId;
    listPacks(): Promise<CreditPack[]>;
    createCheckout(input: CreateCheckoutInput): Promise<{
        url: string;
        sessionId: string;
    }>;
    constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event;
    handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void>;
    private handleSubscriptionCheckoutCompleted;
    handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void>;
    handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void>;
    handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void>;
    handleInvoicePaid(invoice: Stripe.Invoice): Promise<void>;
    createCustomerPortalSession(userId: string): Promise<{
        url: string;
    }>;
}
