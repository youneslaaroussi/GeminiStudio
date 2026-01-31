/**
 * Shared authentication utilities for API routes.
 *
 * Supports both session cookies (for browser requests like <video>/<img>)
 * and Bearer tokens (for API calls with Authorization header).
 */

import { NextRequest } from "next/server";
import { initAdmin } from "./firebase-admin";
import { getAuth } from "firebase-admin/auth";

const SESSION_COOKIE_NAME = "__session";

/**
 * Verify Firebase session cookie and return user ID.
 * Used for browser requests that can't send Authorization headers.
 */
export async function verifySessionCookie(
  request: NextRequest
): Promise<string | null> {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;

  try {
    await initAdmin();
    const decoded = await getAuth().verifySessionCookie(cookie, true);
    return decoded.uid;
  } catch {
    return null;
  }
}

/**
 * Verify Bearer token from Authorization header.
 * Used for API calls with explicit authentication.
 */
export async function verifyBearerToken(
  request: NextRequest
): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    await initAdmin();
    const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
    return decoded.uid;
  } catch {
    return null;
  }
}

/**
 * Verify authentication using either session cookie OR bearer token.
 * Tries session cookie first (for browser requests), falls back to bearer token.
 */
export async function verifyAuth(
  request: NextRequest
): Promise<string | null> {
  return (
    (await verifySessionCookie(request)) || (await verifyBearerToken(request))
  );
}
