import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { compileScene } from './compiler.js';
import { compileSceneEsbuild } from './compiler-esbuild.js';

const config = loadConfig();
const useEsbuild = process.env.SCENE_COMPILER_ENGINE !== 'vite';
const compile = useEsbuild ? compileSceneEsbuild : compileScene;

const app = createServer(config);

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      baseSceneDir: config.baseSceneDir,
      hmacEnabled: !!config.sharedSecret,
      engine: useEsbuild ? 'esbuild' : 'vite',
    },
    'Scene Compiler API listening',
  );

  if (process.env.WARMUP_COMPILE === 'true') {
    setImmediate(async () => {
      try {
        await compile(config, { includeDiagnostics: false });
        logger.info('Warmup compile completed');
      } catch (err) {
        logger.warn({ err }, 'Warmup compile failed');
      }
    });
  }
});
