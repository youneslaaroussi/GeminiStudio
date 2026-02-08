import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

const config = loadConfig();

const app = createServer(config);

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      baseSceneDir: config.baseSceneDir,
      hmacEnabled: !!config.sharedSecret,
    },
    'Scene Compiler API listening',
  );
});
