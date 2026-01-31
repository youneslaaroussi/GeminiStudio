import express from 'express';
import type { Request, Response, NextFunction, Express } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { enqueueRenderJob, renderQueue } from './queue.js';
import { renderJobSchema } from './jobs/render-job.js';
import { logger } from './logger.js';

const SHARED_SECRET = process.env.RENDERER_SHARED_SECRET;
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

// Extend Request to include raw body
interface RequestWithRawBody extends Request {
  rawBody?: string;
}

/**
 * Middleware to capture raw body for HMAC verification.
 * Must be used before express.json() parser.
 */
function captureRawBody(req: RequestWithRawBody, res: Response, next: NextFunction): void {
  let data = '';
  req.setEncoding('utf8');
  
  req.on('data', (chunk: string) => {
    data += chunk;
  });
  
  req.on('end', () => {
    req.rawBody = data;
    // Parse JSON manually since we consumed the stream
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
 * Middleware to verify HMAC signature on render requests.
 * If RENDERER_SHARED_SECRET is not set, verification is skipped (dev mode).
 */
function verifySignature(req: RequestWithRawBody, res: Response, next: NextFunction): void {
  // Skip verification in dev mode when secret is not set
  if (!SHARED_SECRET) {
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
  const expected = createHmac('sha256', SHARED_SECRET).update(payload).digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    logger.warn({ timestamp }, 'Invalid HMAC signature on render request');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

export const createServer = (): Express => {
  const app: Express = express();

  // Health check doesn't need body parsing
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Job status doesn't need body parsing
  app.get('/jobs/:id', async (req: Request, res: Response) => {
    try {
      const job = await renderQueue.getJob(req.params.id);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }

      const state = await job.getState();
      res.json({
        id: job.id,
        name: job.name,
        state,
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        returnValue: job.returnvalue,
        stacktrace: job.stacktrace,
        timestamp: job.timestamp,
        processedOn: job.processedOn,
        finishedOn: job.finishedOn,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to get job status');
      res.status(500).json({ error: 'Failed to fetch job status' });
    }
  });

  // Render endpoint uses raw body capture for HMAC verification
  app.post('/renders', captureRawBody, verifySignature, async (req: Request, res: Response) => {
    const parse = renderJobSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: parse.error.flatten() });
      return;
    }

    try {
      const job = await enqueueRenderJob(parse.data);
      res.status(202).json({ jobId: job.id });
    } catch (err) {
      logger.error({ err }, 'Failed to enqueue render job');
      res.status(500).json({ error: 'Failed to enqueue job' });
    }
  });

  return app;
};
