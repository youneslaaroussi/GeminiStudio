/**
 * Session cookie management endpoint.
 *
 * POST - Create session cookie from Firebase ID token
 * DELETE - Clear session cookie (logout)
 */

import { NextRequest, NextResponse } from "next/server";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { cookies } from "next/headers";

export const runtime = "nodejs";

const SESSION_COOKIE_NAME = "__session";
const SESSION_EXPIRY_DAYS = 14;

export async function POST(request: NextRequest) {
  try {
    const { idToken } = await request.json();

    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json(
        { error: "idToken is required" },
        { status: 400 }
      );
    }

    await initAdmin();
    const decoded = await getAuth().verifyIdToken(idToken);

    const expiresIn = SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const sessionCookie = await getAuth().createSessionCookie(idToken, {
      expiresIn,
    });

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: expiresIn / 1000,
      path: "/",
    });

    return NextResponse.json({ uid: decoded.uid });
  } catch (error) {
    console.error("Failed to create session cookie:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 401 }
    );
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete session cookie:", error);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
