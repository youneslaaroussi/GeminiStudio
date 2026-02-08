/**
 * HMAC signature verification middleware.
 *
 * Follows the same pattern as the renderer service (renderer/src/server.ts).
 * If SCENE_COMPILER_SHARED_SECRET is not set, verification is skipped (dev mode).
 */

import type { Request, Response, NextFunction } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { logger } from './logger.js';

const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

/** Extended request type that carries the raw body for HMAC verification. */
export interface RequestWithRawBody extends Request {
  rawBody?: string;
}

/**
 * Middleware to capture the raw request body before JSON parsing.
 * Must be used before express.json() so we have the exact bytes for HMAC.
 */
export function captureRawBody(req: RequestWithRawBody, res: Response, next: NextFunction): void {
  const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
  // Quick reject if content-length exceeds limit (actual check in the route too)
  const maxBytes = parseInt(process.env.MAX_INPUT_BYTES ?? '204800', 10);
  if (contentLength > maxBytes) {
    res.status(413).json({ error: `Request body too large (max ${maxBytes} bytes)` });
    return;
  }

  let data = '';
  req.setEncoding('utf8');

  req.on('data', (chunk: string) => {
    data += chunk;
    if (Buffer.byteLength(data) > maxBytes) {
      res.status(413).json({ error: `Request body too large (max ${maxBytes} bytes)` });
      req.destroy();
    }
  });

  req.on('end', () => {
    req.rawBody = data;
    if (data) {
      try {
        req.body = JSON.parse(data);
      } catch {
        req.body = {};
      }
    }
    next();
  });
}

/**
 * Middleware to verify HMAC-SHA256 signature on incoming requests.
 *
 * Expects headers:
 *   X-Signature: hex-encoded HMAC
 *   X-Timestamp: Unix timestamp in milliseconds
 *
 * If the shared secret is not configured, verification is skipped (dev mode).
 */
export function verifySignature(sharedSecret: string | undefined) {
  return (req: RequestWithRawBody, res: Response, next: NextFunction): void => {
    // Skip verification in dev mode when secret is not set
    if (!sharedSecret) {
      next();
      return;
    }

    const signature = req.headers['x-signature'] as string | undefined;
    const timestamp = req.headers['x-timestamp'] as string | undefined;

    if (!signature || !timestamp) {
      res.status(401).json({ error: 'Missing authentication headers' });
      return;
    }

    // Check timestamp to prevent replay attacks
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
      res.status(401).json({ error: 'Request expired or invalid timestamp' });
      return;
    }

    // Use raw body for signature verification (preserves original formatting)
    const body = req.rawBody || '';
    const payload = `${timestamp}.${body}`;
    const expected = createHmac('sha256', sharedSecret).update(payload).digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
      logger.warn({ timestamp }, 'Invalid HMAC signature on compile request');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    next();
  };
}
