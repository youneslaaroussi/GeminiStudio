This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## AI asset generators

The Assets panel now includes integrated buttons for:

- **Veo 3 video generation** via Vertex AI long-running predictions.
- **Gemini Banana Pro image generation** via the Gemini API.
- **Prompt enhancer** powered by Gemini that follows the Veo 3.1 prompting guide (cinematography + subject + action + context + style) so you can turn a rough idea into a structured shot description before sending it to Veo.
- Advanced Veo workflows: animate an uploaded image, blend in reference images, lock the last frame, or extend an existing Veo clip—all from the Assets panel.
- Nano Banana Pro now supports image-to-image editing by uploading a source frame alongside the prompt.

Generated assets are persisted alongside uploaded files, so they immediately appear in the asset list and can be dragged into the timeline.

### Required environment variables

Create an `.env.local` based on `env.template` with the following values:

- `AI_CHAT_GOOGLE_MODEL`: optional override for the Gemini chat model id used by the assistant.
- `GOOGLE_GENERATIVE_AI_API_KEY`: API key with access to Gemini image APIs.
- `VEO_PROJECT_ID`: Google Cloud project that has Vertex AI enabled.
- `VEO_LOCATION`: Vertex AI region (for example `us-central1`).
- `VEO_MODEL_ID`: Veo model id, defaults to `veo-3.0-generate-001`.
- Veo uses `GOOGLE_SERVICE_ACCOUNT_KEY` (service-account JSON with `aiplatform.predict` permissions).
- `ASSET_GCS_BUCKET`: Google Cloud Storage bucket where uploaded assets are stored (objects stay private).
- `ASSET_SIGNED_URL_TTL_SECONDS` (optional): Lifetime of generated download URLs in seconds (asset-service default: 1 hour). The app auto-reloads before expiry when `NEXT_PUBLIC_SIGNED_URL_MAX_AGE_SECONDS` is not set (default 55 min).
- `BANANA_MODEL_ID` (optional): override Gemini Banana Pro model id, defaults to `gemini-3-pro-image-preview`.
- `PROMPT_MODEL_ID` (optional): Gemini text model used to expand prompts (defaults to `gemini-1.5-flash-latest`).

Restart the dev server after editing the environment so the server routes can read the new values.

## Email verification (Resend)

Verification emails are sent via [Resend](https://resend.com) with a custom HTML template (not Firebase’s default).

1. Add `RESEND_API_KEY` to your env (from the [Resend dashboard](https://resend.com)).
2. Optionally set `RESEND_FROM_EMAIL` (e.g. `Gemini Studio <onboarding@yourdomain.com>`). If unset, the app uses `onboarding@resend.dev` (Resend’s test sender).
3. The app generates the verification link with Firebase Admin and sends it in a branded email; the link points to your app’s `/auth/action` page.

## Firebase custom action URL (email verification)

To send verification (and other auth) emails to your own domain instead of Firebase’s default link:

1. In [Firebase Console](https://console.firebase.google.com/) go to **Authentication** → **Templates**.
2. Edit the **Email address verification** template (or others as needed).
3. Click **Customize action URL** and set the URL to:
   ```text
   https://YOUR_DOMAIN/auth/action?link=%LINK%
   ```
   Replace `YOUR_DOMAIN` with your app’s origin (e.g. `geminivideo.studio` or `localhost:3000` for dev). Firebase replaces `%LINK%` with the actual action link; the app’s `/auth/action` page parses it and completes verification.

4. Ensure your domain is in **Authentication** → **Sign-in method** → **Authorized domains**.

The handler at `app/auth/action/page.tsx` supports both `?link=%LINK%` and direct params (`?mode=verifyEmail&oobCode=...`).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
