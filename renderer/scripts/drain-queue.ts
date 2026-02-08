import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { loadConfig } from '../src/config.js';

/**
 * Drain or clear the render queue.
 *
 * Usage:
 *   pnpm run drain-queue          # Drain waiting jobs (leave active; default)
 *   pnpm run drain-queue --obliterate   # Remove ALL jobs (waiting, active, completed, failed)
 */
async function main() {
  const obliterate = process.argv.includes('--obliterate');
  const cfg = loadConfig();
  const connection = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue('gemini-render', { connection });

  if (obliterate) {
    await queue.obliterate({ force: true });
    console.log('Render queue obliterated (all jobs removed).');
  } else {
    await queue.drain(true);
    console.log('Render queue drained (waiting jobs removed).');
  }

  await connection.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
