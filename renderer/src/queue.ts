import { Queue, Worker, JobsOptions, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import type { RenderJobData } from './jobs/render-job.js';
import { renderJobSchema } from './jobs/render-job.js';
import { logger } from './logger.js';
import { loadConfig } from './config.js';
import { publishRenderEvent } from './pubsub.js';
import type { RenderEventMetadata } from './pubsub.js';
import type { RenderResult } from './services/render-runner.js';

const cfg = loadConfig();

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
    await publishRenderEvent({
      type: 'render.completed',
      jobId,
      result: coerceReturnValue(returnvalue),
      metadata,
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
      const parseResult = renderJobSchema.safeParse(job.data);
      if (!parseResult.success) {
        logger.error({ err: parseResult.error }, 'Invalid render job payload');
        throw parseResult.error;
      }

      // Type assertion is safe after validation
      (job as Job<RenderJobData>).data = parseResult.data;

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
