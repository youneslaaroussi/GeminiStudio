import { Queue, Worker, JobsOptions, Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { RenderJobData } from './jobs/render-job.js';
import { renderJobSchema } from './jobs/render-job.js';
import { logger } from './logger.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();

export const RENDER_QUEUE_NAME = 'gemini:render';

const createRedisConnection = () => new Redis(cfg.redisUrl);

export const renderQueue = new Queue<RenderJobData>(RENDER_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 1,
  },
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
