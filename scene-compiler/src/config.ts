import { config as loadEnv } from 'dotenv';

loadEnv();

export interface CompilerConfig {
  port: number;
  logLevel: string;
  sharedSecret?: string;
  maxInputBytes: number;
  buildTimeoutMs: number;
  maxOutputBytes: number;
  /** Absolute path to the base scene source directory (scene/src/) */
  baseSceneDir: string;
}

export const loadConfig = (): CompilerConfig => {
  const {
    PORT,
    LOG_LEVEL,
    SCENE_COMPILER_SHARED_SECRET,
    MAX_INPUT_BYTES,
    BUILD_TIMEOUT_MS,
    MAX_OUTPUT_BYTES,
    BASE_SCENE_DIR,
  } = process.env;

  return {
    port: Number(PORT ?? 4001),
    logLevel: LOG_LEVEL ?? 'info',
    sharedSecret: SCENE_COMPILER_SHARED_SECRET || undefined,
    maxInputBytes: Number(MAX_INPUT_BYTES ?? 204800), // 200KB
    buildTimeoutMs: Number(BUILD_TIMEOUT_MS ?? 30000), // 30s
    maxOutputBytes: Number(MAX_OUTPUT_BYTES ?? 2097152), // 2MB
    // In dev: point to ../scene/src; in Docker: /app/base-scene
    baseSceneDir: BASE_SCENE_DIR ?? new URL('../../scene', import.meta.url).pathname,
  };
};
