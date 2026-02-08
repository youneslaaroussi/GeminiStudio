import { Queue, Worker, JobsOptions, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import crypto from 'crypto';
import type { RenderJobData } from './jobs/render-job.js';
import { logger } from './logger.js';
import { loadConfig } from './config.js';
import { publishRenderEvent } from './pubsub.js';
import type { RenderEventMetadata } from './pubsub.js';
import type { RenderResult } from './services/render-runner.js';

const cfg = loadConfig();

/**
 * Sign an asset service request with HMAC-SHA256.
 */
const signAssetServiceRequest = (body: string, timestamp: number): string => {
  if (!cfg.assetServiceSharedSecret) return '';
  const payload = `${timestamp}.${body}`;
  return crypto.createHmac('sha256', cfg.assetServiceSharedSecret).update(payload).digest('hex');
};

/**
 * Register a rendered video as an asset in the asset service.
 * Returns the assetId if successful, null otherwise.
 */
const registerRenderAsAsset = async (
  gcsPath: string,
  metadata: RenderEventMetadata | undefined,
): Promise<string | null> => {
  if (!cfg.assetServiceUrl) {
    logger.debug('Asset service URL not configured, skipping asset registration');
    return null;
  }

  const agent = metadata?.agent;
  const userId = agent?.userId;
  const projectId = agent?.projectId;
  const threadId = agent?.threadId;

  if (!userId || !projectId) {
    logger.debug({ userId, projectId }, 'Missing userId or projectId, skipping asset registration');
    return null;
  }

  const endpoint = `${cfg.assetServiceUrl.replace(/\/$/, '')}/api/assets/${userId}/${projectId}/register-gcs`;

  const requestBody = JSON.stringify({
    gcsUri: gcsPath,
    name: `Render ${new Date().toISOString()}`,
    source: 'render',
    runPipeline: true,
    threadId: threadId || null,
  });

  const timestamp = Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (cfg.assetServiceSharedSecret) {
    headers['X-Signature'] = signAssetServiceRequest(requestBody, timestamp);
    headers['X-Timestamp'] = timestamp.toString();
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error({ status: response.status, text }, 'Failed to register render as asset');
      return null;
    }

    const data = (await response.json()) as { asset?: { id?: string } };
    const assetId = data.asset?.id;
    if (assetId) {
      logger.info({ assetId, gcsPath }, 'Registered render as asset');
      return assetId;
    }
    return null;
  } catch (err) {
    logger.error({ err }, 'Error registering render as asset');
    return null;
  }
};

export const RENDER_QUEUE_NAME = 'gemini-render';

const createRedisConnection = () =>
  new Redis(cfg.redisUrl, {
    maxRetriesPerRequest: null,
  });

export const renderQueue = new Queue<RenderJobData>(RENDER_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: {
      age: 300, // Keep completed jobs for 5 minutes
      count: 100, // Keep at most 100 completed jobs
    },
    removeOnFail: false,
    attempts: 1,
  },
});

const renderQueueEvents = new QueueEvents(RENDER_QUEUE_NAME, {
  connection: createRedisConnection(),
});

renderQueueEvents
  .waitUntilReady()
  .then(() => logger.info('Render queue events ready'))
  .catch((err) => {
    logger.error({ err }, 'Render queue events failed to initialize');
  });

const coerceReturnValue = (value: unknown): RenderResult | null => {
  if (!value) return null;
  if (typeof value === 'object') {
    return value as RenderResult;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as RenderResult;
    } catch (err) {
      logger.warn({ err }, 'Failed to parse return value JSON');
      return null;
    }
  }
  return null;
};

renderQueueEvents.on('completed', async ({ jobId, returnvalue }) => {
  try {
    const job = await renderQueue.getJob(jobId);
    const metadata: RenderEventMetadata | undefined = job?.data.metadata
      ? { ...job.data.metadata }
      : undefined;
    const result = coerceReturnValue(returnvalue);

    // Register rendered video as asset for agent iteration
    let assetId: string | null = null;
    if (result?.gcsPath) {
      assetId = await registerRenderAsAsset(result.gcsPath, metadata);
    }

    await publishRenderEvent({
      type: 'render.completed',
      jobId,
      result,
      metadata,
      assetId,
    });
  } catch (err) {
    logger.error({ err, jobId }, 'Failed to publish render completed event');
  }
});

renderQueueEvents.on('failed', async ({ jobId, failedReason }) => {
  try {
    const job = await renderQueue.getJob(jobId);
    const metadata: RenderEventMetadata | undefined = job?.data.metadata
      ? { ...job.data.metadata }
      : undefined;
    const stacktrace = job?.stacktrace ?? null;
    await publishRenderEvent({
      type: 'render.failed',
      jobId,
      error: failedReason ?? 'Render job failed',
      failedReason,
      stacktrace,
      metadata,
    });
  } catch (pubErr) {
    logger.error({ err: pubErr, jobId }, 'Failed to publish render failed event');
  }
});

renderQueueEvents.on('error', (err) => {
  logger.error({ err }, 'Render queue events error');
});

export type RenderWorkerProcessor = (job: Job<RenderJobData>) => Promise<unknown>;

export const createRenderWorker = (
  processor: RenderWorkerProcessor,
  options?: { concurrency?: number },
) => {
  const worker = new Worker<RenderJobData>(
    RENDER_QUEUE_NAME,
    async (job) => {
      // Job data is already hydrated and validated by the server before enqueueing
      return processor(job as Job<RenderJobData>);
    },
    {
      connection: createRedisConnection(),
      concurrency: options?.concurrency ?? cfg.concurrency,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Render job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Render job failed');
  });

  return { worker };
};

export const enqueueRenderJob = async (
  data: RenderJobData,
  opts?: JobsOptions,
) => {
  const job = await renderQueue.add('render', data, opts);
  logger.info({ jobId: job.id }, 'Queued render job');
  return job;
};
