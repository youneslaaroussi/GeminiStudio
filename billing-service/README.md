# Billing Service

NestJS microservice for R-Credits billing via Stripe. Handles credit pack listing, Stripe Checkout sessions, and webhooks. Credits are stored in Firestore at `users/{userId}/settings/billing`.

## Setup

1. **Environment**

   Copy `.env.example` to `.env` and set:

   - `FIREBASE_SERVICE_ACCOUNT_KEY`: Path to Firebase service account JSON or inline JSON string.
   - `STRIPE_SECRET_KEY`: Stripe secret key (e.g. `sk_test_...`).
   - `STRIPE_CREDITS_WEBHOOK_SECRET`: Webhook signing secret for `POST /credits/webhook` (e.g. `whsec_...`).
   - `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`: Stripe Price IDs for the three packs.

2. **Stripe**

   - Create three Products (e.g. "Starter", "Pro", "Enterprise") with **recurring** Prices (monthly subscription) in the Dashboard.
   - Create a Webhook endpoint: `https://<billing-service-host>/credits/webhook` and subscribe to: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`.

3. **Local webhooks (Stripe CLI)**

   Forward Stripe events to your local billing service and get a signing secret for `.env`:

   ```bash
   stripe listen --forward-to localhost:3100/credits/webhook
   ```

   Use the printed `whsec_...` value as `STRIPE_CREDITS_WEBHOOK_SECRET` in `.env`. Leave the CLI running while testing checkout.

4. **Run**

   ```bash
   pnpm install
   pnpm run start:dev
   ```

   Default port: `3100`. Override with `PORT`. For local checkout testing, run `stripe listen --forward-to localhost:3100/credits/webhook` in another terminal and set `STRIPE_CREDITS_WEBHOOK_SECRET` to the CLI’s secret.

## API

- `GET /credits/packs` — List credit packs (id, name, credits, amount, currency, priceId). No auth.
- `POST /credits/checkout` — Create Stripe Checkout session (subscription mode). Body: `{ packId, successUrl?, cancelUrl? }`. Requires `Authorization: Bearer <Firebase ID token>`.
- `POST /credits/portal` — Create Stripe Customer Portal session (manage subscription, payment method). Requires `Authorization: Bearer <Firebase ID token>`.
- `POST /credits/webhook` — Stripe webhook. Expects `stripe-signature` header and raw body. No auth. Handles: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`.

## Firestore

- **Read/write (client):** `users/{userId}/settings/billing` — `{ credits, tier?, subscriptionId?, customerId?, subscriptionStatus?, currentPeriodEnd?, updatedAt? }`. Used by the app for balance, tier, and subscription management.

## Frontend

Set `NEXT_PUBLIC_BILLING_SERVICE_URL` (e.g. `http://localhost:3100`) in the app. Settings → Fill up credits uses this service for checkout.
