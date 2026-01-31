import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { loadConfig } from '../src/config.js';

async function main() {
  const cfg = loadConfig();
  const connection = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue('gemini-render', { connection });
  await queue.drain(true);
  console.log('Queue drained');
  await connection.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
