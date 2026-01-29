import { type RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { CreditsBillingService } from './credits-billing.service';
import { FIREBASE_USER } from '../auth/firebase-auth.guard';
declare class CreateCheckoutDto {
    packId: 'starter' | 'pro' | 'enterprise';
    successUrl?: string;
    cancelUrl?: string;
}
export declare class CreditsController {
    private readonly billing;
    constructor(billing: CreditsBillingService);
    listPacks(): Promise<import("./credits-billing.service").CreditPack[]>;
    createCheckout(req: Request & {
        [FIREBASE_USER]?: {
            uid: string;
        };
    }, body: CreateCheckoutDto): Promise<{
        url: string;
        sessionId: string;
    }>;
    handleWebhook(req: RawBodyRequest<Request>, signature: string): Promise<{
        received: boolean;
    }>;
}
export {};
