import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
  type RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';
import { CreditsBillingService } from './credits-billing.service';
import { FirebaseAuthGuard, FIREBASE_USER } from '../auth/firebase-auth.guard';
import { SkipAuth } from '../auth/skip-auth.decorator';

class CreateCheckoutDto {
  packId!: 'starter' | 'pro' | 'enterprise';
  successUrl?: string;
  cancelUrl?: string;
}

@Controller('credits')
export class CreditsController {
  constructor(private readonly billing: CreditsBillingService) {}

  @Get('packs')
  @SkipAuth()
  listPacks() {
    return this.billing.listPacks();
  }

  @Post('checkout')
  @UseGuards(FirebaseAuthGuard)
  async createCheckout(
    @Req() req: Request & { [FIREBASE_USER]?: { uid: string } },
    @Body() body: CreateCheckoutDto,
  ) {
    const uid = req[FIREBASE_USER]?.uid;
    if (!uid) {
      throw new BadRequestException('Missing authenticated user');
    }
    if (!body.packId || !['starter', 'pro', 'enterprise'].includes(body.packId)) {
      throw new BadRequestException('packId must be one of: starter, pro, enterprise');
    }
    return this.billing.createCheckout({
      userId: uid,
      packId: body.packId,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
    });
  }

  @Post('portal')
  @UseGuards(FirebaseAuthGuard)
  async createPortalSession(
    @Req() req: Request & { [FIREBASE_USER]?: { uid: string } },
  ) {
    const uid = req[FIREBASE_USER]?.uid;
    if (!uid) {
      throw new BadRequestException('Missing authenticated user');
    }
    return this.billing.createCustomerPortalSession(uid);
  }

  @Post('webhook')
  @SkipAuth()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      throw new BadRequestException('Raw body required for webhook verification');
    }
    let event: Stripe.Event;
    try {
      event = this.billing.constructWebhookEvent(raw, signature);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid webhook';
      throw new BadRequestException(`Stripe webhook error: ${msg}`);
    }
    switch (event.type) {
      case 'checkout.session.completed':
        await this.billing.handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case 'customer.subscription.created':
        await this.billing.handleSubscriptionCreated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'customer.subscription.updated':
        await this.billing.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'customer.subscription.deleted':
        await this.billing.handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
      case 'invoice.paid':
        await this.billing.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      default:
        // Log unhandled events but don't fail
        break;
    }
    return { received: true };
  }
}
