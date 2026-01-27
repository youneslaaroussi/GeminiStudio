import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import './worker.js';

const config = loadConfig();

const app = createServer();

app.listen(config.port, () => {
  logger.info({ port: config.port }, 'Renderer API listening');
});
