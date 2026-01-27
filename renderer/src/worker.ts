import { createRenderWorker } from './queue.js';
import { RenderRunner } from './services/render-runner.js';
import { logger } from './logger.js';

const runner = new RenderRunner();

const { worker } = createRenderWorker(async (job) => {
  return await runner.run(job);
});

worker
  .waitUntilReady()
  .then(() => logger.info('Render worker ready'))
  .catch((err) => {
    logger.error({ err }, 'Render worker failed to initialize');
    process.exitCode = 1;
  });
