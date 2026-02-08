import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { compileScene } from './compiler.js';

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

  if (process.env.WARMUP_COMPILE === 'true') {
    setImmediate(async () => {
      try {
        await compileScene(config, { includeDiagnostics: false });
        logger.info('Warmup compile completed');
      } catch (err) {
        logger.warn({ err }, 'Warmup compile failed');
      }
    });
  }
});
