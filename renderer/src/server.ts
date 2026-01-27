import express from 'express';
import type { Request, Response, Express } from 'express';
import { enqueueRenderJob, renderQueue } from './queue.js';
import { renderJobSchema } from './jobs/render-job.js';
import { logger } from './logger.js';

export const createServer = (): Express => {
  const app: Express = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.post('/renders', async (req: Request, res: Response) => {
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
        returnvalue: job.returnvalue,
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

  return app;
};
