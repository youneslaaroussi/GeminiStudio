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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditsController = void 0;
const common_1 = require("@nestjs/common");
const credits_billing_service_1 = require("./credits-billing.service");
const firebase_auth_guard_1 = require("../auth/firebase-auth.guard");
const skip_auth_decorator_1 = require("../auth/skip-auth.decorator");
class CreateCheckoutDto {
    packId;
    successUrl;
    cancelUrl;
}
let CreditsController = class CreditsController {
    billing;
    constructor(billing) {
        this.billing = billing;
    }
    listPacks() {
        return this.billing.listPacks();
    }
    async createCheckout(req, body) {
        const uid = req[firebase_auth_guard_1.FIREBASE_USER]?.uid;
        if (!uid) {
            throw new common_1.BadRequestException('Missing authenticated user');
        }
        if (!body.packId || !['starter', 'pro', 'enterprise'].includes(body.packId)) {
            throw new common_1.BadRequestException('packId must be one of: starter, pro, enterprise');
        }
        return this.billing.createCheckout({
            userId: uid,
            packId: body.packId,
            successUrl: body.successUrl,
            cancelUrl: body.cancelUrl,
        });
    }
    async claimSignupBonus(req) {
        const uid = req[firebase_auth_guard_1.FIREBASE_USER]?.uid;
        const email = req[firebase_auth_guard_1.FIREBASE_USER]?.email;
        if (!uid || !email) {
            throw new common_1.BadRequestException('Missing authenticated user or email');
        }
        return this.billing.grantSignupBonus(uid, email);
    }
    async createPortalSession(req) {
        const uid = req[firebase_auth_guard_1.FIREBASE_USER]?.uid;
        if (!uid) {
            throw new common_1.BadRequestException('Missing authenticated user');
        }
        return this.billing.createCustomerPortalSession(uid);
    }
    async handleWebhook(req, signature) {
        if (!signature) {
            throw new common_1.BadRequestException('Missing stripe-signature header');
        }
        const raw = req.rawBody;
        if (!raw || !Buffer.isBuffer(raw)) {
            throw new common_1.BadRequestException('Raw body required for webhook verification');
        }
        let event;
        try {
            event = this.billing.constructWebhookEvent(raw, signature);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : 'Invalid webhook';
            throw new common_1.BadRequestException(`Stripe webhook error: ${msg}`);
        }
        switch (event.type) {
            case 'checkout.session.completed':
                await this.billing.handleCheckoutCompleted(event.data.object);
                break;
            case 'customer.subscription.created':
                await this.billing.handleSubscriptionCreated(event.data.object);
                break;
            case 'customer.subscription.updated':
                await this.billing.handleSubscriptionUpdated(event.data.object);
                break;
            case 'customer.subscription.deleted':
                await this.billing.handleSubscriptionDeleted(event.data.object);
                break;
            case 'invoice.paid':
                await this.billing.handleInvoicePaid(event.data.object);
                break;
            default:
                break;
        }
        return { received: true };
    }
};
exports.CreditsController = CreditsController;
__decorate([
    (0, common_1.Get)('packs'),
    (0, skip_auth_decorator_1.SkipAuth)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CreditsController.prototype, "listPacks", null);
__decorate([
    (0, common_1.Post)('checkout'),
    (0, common_1.UseGuards)(firebase_auth_guard_1.FirebaseAuthGuard),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, CreateCheckoutDto]),
    __metadata("design:returntype", Promise)
], CreditsController.prototype, "createCheckout", null);
__decorate([
    (0, common_1.Post)('signup-bonus'),
    (0, common_1.UseGuards)(firebase_auth_guard_1.FirebaseAuthGuard),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CreditsController.prototype, "claimSignupBonus", null);
__decorate([
    (0, common_1.Post)('portal'),
    (0, common_1.UseGuards)(firebase_auth_guard_1.FirebaseAuthGuard),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CreditsController.prototype, "createPortalSession", null);
__decorate([
    (0, common_1.Post)('webhook'),
    (0, skip_auth_decorator_1.SkipAuth)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)('stripe-signature')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CreditsController.prototype, "handleWebhook", null);
exports.CreditsController = CreditsController = __decorate([
    (0, common_1.Controller)('credits'),
    __metadata("design:paramtypes", [credits_billing_service_1.CreditsBillingService])
], CreditsController);
//# sourceMappingURL=credits.controller.js.map