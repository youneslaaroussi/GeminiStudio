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

   - Create three Products (e.g. "Starter", "Pro", "Enterprise") and one-time Prices in the Dashboard.
   - Create a Webhook endpoint: `https://<billing-service-host>/credits/webhook`, event `checkout.session.completed`.

3. **Run**

   ```bash
   pnpm install
   pnpm run start:dev
   ```

   Default port: `3100`. Override with `PORT`.

## API

- `GET /credits/packs` — List credit packs (id, name, credits, amount, currency, priceId). No auth.
- `POST /credits/checkout` — Create Stripe Checkout session. Body: `{ packId, successUrl?, cancelUrl? }`. Requires `Authorization: Bearer <Firebase ID token>`.
- `POST /credits/webhook` — Stripe webhook. Expects `stripe-signature` header and raw body. No auth.

## Firestore

- **Read/write (client):** `users/{userId}/settings/billing` — `{ credits, tier?, updatedAt? }`. Used by the app for balance and tier.
- **Server-only:** `creditPurchases` — Pending/completed purchases for idempotency and audit.

## Frontend

Set `NEXT_PUBLIC_BILLING_SERVICE_URL` (e.g. `http://localhost:3100`) in the app. Settings → Fill up credits uses this service for checkout.
