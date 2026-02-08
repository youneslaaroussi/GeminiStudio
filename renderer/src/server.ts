import express from 'express';
import type { Request, Response, NextFunction, Express } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { enqueueRenderJob, renderQueue } from './queue.js';
import { renderJobSchema, type RenderJobInput, type RenderJobData } from './jobs/render-job.js';
import { logger } from './logger.js';
import { loadConfig } from './config.js';
import { fetchRenderData } from './services/project-fetcher.js';

const SHARED_SECRET = process.env.RENDERER_SHARED_SECRET;
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

const config = loadConfig();

/**
 * Quality levels ordered from lowest to highest
 */
const QUALITY_LEVELS: Record<string, number> = {
  low: 1,
  web: 2,
  social: 3,
  studio: 4,
};

/**
 * Apply hard limits to hydrated render job settings.
 * Clamps FPS, resolution (preserving aspect ratio), duration, and quality.
 */
function applyRenderLimits(job: RenderJobData): RenderJobData {
  const limits = {
    maxFps: config.maxFps,
    maxResolution: config.maxResolution,
    maxDuration: config.maxDuration,
    maxQuality: config.maxQuality,
  };

  // Clamp FPS
  const clampedFps = Math.min(job.output.fps, limits.maxFps);

  // Clamp resolution preserving aspect ratio
  const { width, height } = job.output.size;
  const longestDimension = Math.max(width, height);
  let clampedWidth = width;
  let clampedHeight = height;

  if (longestDimension > limits.maxResolution) {
    const scale = limits.maxResolution / longestDimension;
    clampedWidth = Math.round(width * scale);
    clampedHeight = Math.round(height * scale);
  }

  // Clamp duration
  let clampedTimelineDuration = job.timelineDuration;
  if (clampedTimelineDuration && clampedTimelineDuration > limits.maxDuration) {
    clampedTimelineDuration = limits.maxDuration;
  }
  
  let clampedRange: [number, number] | undefined = job.output.range;
  if (clampedRange) {
    const duration = clampedRange[1] - clampedRange[0];
    if (duration > limits.maxDuration) {
      clampedRange = [clampedRange[0], clampedRange[0] + limits.maxDuration];
    }
  }
  
  const computedDuration = clampedTimelineDuration ?? 
    (clampedRange ? clampedRange[1] - clampedRange[0] : undefined) ??
    job.variables?.duration;
  
  if (!clampedRange && computedDuration && computedDuration > limits.maxDuration) {
    clampedRange = [0, limits.maxDuration];
  }

  // Clamp quality
  const currentQuality = job.output.quality?.toLowerCase() ?? 'web';
  const currentQualityLevel = QUALITY_LEVELS[currentQuality] ?? QUALITY_LEVELS.web;
  const maxQualityLevel = QUALITY_LEVELS[limits.maxQuality.toLowerCase()] ?? QUALITY_LEVELS.web;
  const clampedQuality = currentQualityLevel <= maxQualityLevel ? currentQuality : limits.maxQuality;

  const rangeChanged = clampedRange !== job.output.range && 
    (clampedRange === undefined || job.output.range === undefined ||
     clampedRange[0] !== job.output.range[0] ||
     clampedRange[1] !== job.output.range[1]);
  
  if (clampedFps !== job.output.fps ||
      clampedWidth !== width ||
      clampedHeight !== height ||
      rangeChanged ||
      clampedTimelineDuration !== job.timelineDuration ||
      clampedQuality !== currentQuality) {
    logger.warn({
      original: {
        fps: job.output.fps,
        resolution: `${width}x${height}`,
        duration: job.output.range ? job.output.range[1] - job.output.range[0] : job.timelineDuration,
        quality: currentQuality,
      },
      clamped: {
        fps: clampedFps,
        resolution: `${clampedWidth}x${clampedHeight}`,
        duration: clampedRange ? clampedRange[1] - clampedRange[0] : clampedTimelineDuration,
        quality: clampedQuality,
      },
    }, 'Applied render limits to job');
  }

  return {
    ...job,
    timelineDuration: clampedTimelineDuration,
    output: {
      ...job.output,
      fps: clampedFps,
      size: {
        width: clampedWidth,
        height: clampedHeight,
      },
      range: clampedRange,
      quality: clampedQuality,
    },
  };
}

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

  // Render endpoint: accepts minimal payload, fetches project data, enqueues hydrated job
  app.post('/renders', captureRawBody, verifySignature, async (req: Request, res: Response) => {
    // Validate minimal input
    const parse = renderJobSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: parse.error.flatten() });
      return;
    }

    const input: RenderJobInput = parse.data;

    try {
      // Fetch all project data from Firebase + asset service
      const renderData = await fetchRenderData(
        config,
        input.userId,
        input.projectId,
        input.branchId,
      );

      const { project, componentFiles, timelineDuration } = renderData;

      // Derive output settings from fetched project + input overrides
      const timestamp = Date.now();
      const extension = input.output.format === 'gif' ? 'gif' : input.output.format === 'webm' ? 'webm' : 'mp4';
      const fps = input.output.fps ?? project.fps ?? 30;
      const size = { ...project.resolution };

      // Build hydrated job data
      const jobData: RenderJobData = {
        project,
        timelineDuration,
        output: {
          format: input.output.format,
          fps,
          size,
          quality: input.output.quality ?? 'web',
          destination: `/tmp/render-${timestamp}.${extension}`,
          range: input.output.range,
          includeAudio: input.output.includeAudio,
          uploadUrl: input.output.uploadUrl,
        },
        options: input.options,
        metadata: input.metadata,
        ...(Object.keys(componentFiles).length > 0 && { componentFiles }),
      };

      // Apply hard limits
      const limitedJob = applyRenderLimits(jobData);
      const job = await enqueueRenderJob(limitedJob);
      res.status(202).json({ jobId: job.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ err, userId: input.userId, projectId: input.projectId }, 'Failed to process render request');
      res.status(500).json({ error: `Failed to process render request: ${message}` });
    }
  });

  return app;
};
