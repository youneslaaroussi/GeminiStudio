/**
 * HMAC signing utilities for renderer requests.
 *
 * Used to authenticate requests between the Next.js app and the renderer service.
 */

import { createHmac } from "crypto";

const RENDERER_SECRET = process.env.RENDERER_SHARED_SECRET;

/**
 * Sign a renderer request body with HMAC-SHA256.
 * Includes timestamp to prevent replay attacks.
 *
 * @param body - JSON string of the request body
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Hex-encoded HMAC signature
 */
export function signRendererRequest(body: string, timestamp: number): string {
  if (!RENDERER_SECRET) {
    throw new Error("RENDERER_SHARED_SECRET environment variable is not set");
  }
  const payload = `${timestamp}.${body}`;
  return createHmac("sha256", RENDERER_SECRET).update(payload).digest("hex");
}

/**
 * Check if renderer signing is enabled.
 */
export function isRendererSigningEnabled(): boolean {
  return !!RENDERER_SECRET;
}
