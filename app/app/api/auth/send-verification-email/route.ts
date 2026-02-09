/**
 * Send a customized email verification using Resend.
 * Requires Firebase ID token; generates verification link via Firebase Admin and sends HTML email.
 */

import { NextRequest, NextResponse } from "next/server";
import { initAdmin, getAdminAuth } from "@/app/lib/server/firebase-admin";
import { Resend } from "resend";

export const runtime = "nodejs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "Gemini Studio <onboarding@resend.dev>";

function buildVerificationEmailHtml(verifyUrl: string): string {
  const appName = "Gemini Studio";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;">
  <div style="max-width:420px;margin:0 auto;">
    <h1 style="font-size:1.5rem;font-weight:600;margin-bottom:8px;">Verify your email</h1>
    <p style="color:#94a3b8;font-size:0.95rem;line-height:1.5;margin-bottom:24px;">
      Thanks for signing up for ${appName}. Click the button below to verify your email and unlock your 30 free R-Credits.
    </p>
    <a href="${verifyUrl}" style="display:inline-block;background:#f59e0b;color:#000;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:0.95rem;">Verify email address</a>
    <p style="color:#64748b;font-size:0.8rem;margin-top:24px;line-height:1.5;">
      If you didn’t create an account, you can ignore this email.
    </p>
    <p style="color:#64748b;font-size:0.75rem;margin-top:32px;">
      If the button doesn’t work, copy and paste this link into your browser:<br/>
      <a href="${verifyUrl}" style="color:#94a3b8;word-break:break-all;">${verifyUrl}</a>
    </p>
  </div>
</body>
</html>`;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
    }
    const idToken = authHeader.slice(7);

    await initAdmin();
    const auth = await getAdminAuth();
    const decoded = await auth.verifyIdToken(idToken);
    const email = decoded.email;
    if (!email) {
      return NextResponse.json({ error: "User has no email" }, { status: 400 });
    }

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set");
      return NextResponse.json({ error: "Email service not configured" }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const continueUrl =
      typeof body?.continueUrl === "string" && body.continueUrl
        ? body.continueUrl
        : `${request.nextUrl.origin}/settings/claims`;

    const firebaseLink = await auth.generateEmailVerificationLink(email, {
      url: continueUrl,
    });

    const origin = request.nextUrl.origin;
    const customActionUrl = `${origin}/auth/action?link=${encodeURIComponent(firebaseLink)}`;

    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: "Verify your email – Gemini Studio",
      html: buildVerificationEmailHtml(customActionUrl),
    });

    if (error) {
      console.error("Resend send failed:", error);
      return NextResponse.json({ error: "Failed to send verification email" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Send verification email error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send verification email" },
      { status: 500 }
    );
  }
}
