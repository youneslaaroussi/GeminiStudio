import { config as loadEnv } from 'dotenv';

loadEnv();

export interface RendererConfig {
  port: number;
  redisUrl: string;
  concurrency: number;
  headlessConcurrency: number;
  tmpDir: string;
}

export const loadConfig = (): RendererConfig => {
  const {
    PORT,
    REDIS_URL,
    RENDERER_CONCURRENCY,
    RENDERER_HEADLESS_CONCURRENCY,
    RENDERER_TMP_DIR,
  } = process.env;

  return {
    port: Number(PORT ?? 4000),
    redisUrl: REDIS_URL ?? 'redis://127.0.0.1:6379',
    concurrency: Number(RENDERER_CONCURRENCY ?? 2),
    headlessConcurrency: Number(RENDERER_HEADLESS_CONCURRENCY ?? 2),
    tmpDir: RENDERER_TMP_DIR ?? '/tmp/gemini-renderer',
  };
};
