import { config as loadEnv } from 'dotenv';

loadEnv();

export interface RendererConfig {
  port: number;
  redisUrl: string;
  concurrency: number;
  headlessConcurrency: number;
  tmpDir: string;
  chromeExecutablePath?: string;
  headless: boolean;
  gcpProjectId?: string;
  renderEventTopic: string;
  taskTimeoutMs: number;
}

export const loadConfig = (): RendererConfig => {
  const {
    PORT,
    REDIS_URL,
    RENDERER_CONCURRENCY,
    RENDERER_HEADLESS_CONCURRENCY,
    RENDERER_TMP_DIR,
    PUPPETEER_EXECUTABLE_PATH,
    RENDERER_HEADLESS,
    RENDERER_EVENT_TOPIC,
    GOOGLE_PROJECT_ID,
    RENDERER_TASK_TIMEOUT_MS,
  } = process.env;

  return {
    port: Number(PORT ?? 4000),
    redisUrl: REDIS_URL ?? 'redis://127.0.0.1:6379',
    concurrency: Number(RENDERER_CONCURRENCY ?? 2),
    headlessConcurrency: Number(RENDERER_HEADLESS_CONCURRENCY ?? 2),
    tmpDir: RENDERER_TMP_DIR ?? '/tmp/gemini-renderer',
    chromeExecutablePath: PUPPETEER_EXECUTABLE_PATH,
    headless: RENDERER_HEADLESS ? RENDERER_HEADLESS.toLowerCase() === 'true' : true,
    gcpProjectId: GOOGLE_PROJECT_ID,
    renderEventTopic: RENDERER_EVENT_TOPIC ?? 'gemini-render-events',
    taskTimeoutMs: Number(RENDERER_TASK_TIMEOUT_MS ?? 600000), // 10 minutes default
  };
};
