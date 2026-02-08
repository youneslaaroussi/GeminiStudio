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
  assetServiceUrl?: string;
  assetServiceSharedSecret?: string;
  sceneCompilerUrl: string;
  sceneCompilerSharedSecret?: string;
  maxFps: number;
  maxResolution: number; // Max dimension of longest side (preserves aspect ratio)
  maxDuration: number; // Max duration in seconds
  maxQuality: string; // Maximum allowed quality level
  /** Allowed hosts for headless browser requests (e.g. storage.googleapis.com). Same-origin is always allowed. */
  headlessAllowedRequestHosts: string[];
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
    ASSET_SERVICE_URL,
    ASSET_SERVICE_SHARED_SECRET,
    SCENE_COMPILER_URL,
    SCENE_COMPILER_SHARED_SECRET,
    RENDERER_MAX_FPS,
    RENDERER_MAX_RESOLUTION,
    RENDERER_MAX_DURATION,
    RENDERER_MAX_QUALITY,
    HEADLESS_ALLOWED_REQUEST_HOSTS,
  } = process.env;

  const headlessAllowedRequestHosts = (HEADLESS_ALLOWED_REQUEST_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

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
    assetServiceUrl: ASSET_SERVICE_URL,
    assetServiceSharedSecret: ASSET_SERVICE_SHARED_SECRET,
    sceneCompilerUrl: SCENE_COMPILER_URL ?? 'http://localhost:4001',
    sceneCompilerSharedSecret: SCENE_COMPILER_SHARED_SECRET || undefined,
    maxFps: Number(RENDERER_MAX_FPS ?? 30),
    maxResolution: Number(RENDERER_MAX_RESOLUTION ?? 1280), // 720p default (1280x720)
    maxDuration: Number(RENDERER_MAX_DURATION ?? 30), // 30 seconds default
    maxQuality: RENDERER_MAX_QUALITY ?? 'web',
    headlessAllowedRequestHosts,
  };
};
