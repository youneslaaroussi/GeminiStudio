import express from 'express';
import type { Request, Response, Express } from 'express';
import { z } from 'zod';
import { captureRawBody, verifySignature, type RequestWithRawBody } from './auth.js';
import { compileScene } from './compiler.js';
import { compileSceneEsbuild } from './compiler-esbuild.js';
import { logger } from './logger.js';
import type { CompilerConfig } from './config.js';

/** Pick the compiler implementation based on env var. Default: esbuild (fast). */
const useEsbuild = process.env.SCENE_COMPILER_ENGINE !== 'vite';
const compile = useEsbuild ? compileSceneEsbuild : compileScene;

/** Zod schema for the compile request body. */
const compileRequestSchema = z.object({
  files: z.record(z.string(), z.string()).optional(),
  includeDiagnostics: z.boolean().optional(),
  skipCache: z.boolean().optional(),
});

export const createServer = (config: CompilerConfig): Express => {
  const app: Express = express();
  const hmacMiddleware = verifySignature(config.sharedSecret);

  // --- Health check (no auth needed) ---
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // --- Compile endpoint ---
  app.post(
    '/compile',
    captureRawBody,
    hmacMiddleware,
    async (req: Request, res: Response) => {
      // Validate request body
      const parse = compileRequestSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: parse.error.flatten() });
        return;
      }

      const { files, includeDiagnostics, skipCache } = parse.data;

      // Check total input size of file overrides
      if (files) {
        const totalBytes = Object.values(files).reduce(
          (sum, content) => sum + Buffer.byteLength(content),
          0,
        );
        if (totalBytes > config.maxInputBytes) {
          res.status(413).json({
            error: `Total file content exceeds maximum input size (${config.maxInputBytes} bytes)`,
          });
          return;
        }
      }

      // Run compilation with timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.buildTimeoutMs);

      try {
        const result = await Promise.race([
          compile(config, { files, includeDiagnostics, skipCache }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () =>
              reject(new Error(`Build timed out after ${config.buildTimeoutMs}ms`)),
            );
          }),
        ]);

        res.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, 'Compilation failed');

        if (message.includes('timed out')) {
          res.status(504).json({ error: message });
        } else if (message.includes('not allowed')) {
          res.status(400).json({ error: message });
        } else {
          res.status(500).json({ error: message });
        }
      } finally {
        clearTimeout(timeout);
      }
    },
  );

  return app;
};
