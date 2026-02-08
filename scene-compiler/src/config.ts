import { tmpdir } from 'os';
import { join } from 'path';
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
  /** Persistent Vite cache dir for faster repeated compiles. null = disabled (e.g. VITE_CACHE_DISABLED=true). */
  viteCacheDir: string | null;
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
    VITE_CACHE_DIR,
    VITE_CACHE_DISABLED,
  } = process.env;

  const viteCacheDir =
    VITE_CACHE_DISABLED === 'true' || VITE_CACHE_DISABLED === '1'
      ? null
      : (VITE_CACHE_DIR ?? join(tmpdir(), 'scene-compiler-vite-cache'));

  return {
    port: Number(PORT ?? 4001),
    logLevel: LOG_LEVEL ?? 'info',
    sharedSecret: SCENE_COMPILER_SHARED_SECRET || undefined,
    maxInputBytes: Number(MAX_INPUT_BYTES ?? 204800), // 200KB
    buildTimeoutMs: Number(BUILD_TIMEOUT_MS ?? 30000), // 30s
    maxOutputBytes: Number(MAX_OUTPUT_BYTES ?? 8388608), // 8MB
    // In dev: point to ../scene/src; in Docker: /app/base-scene
    baseSceneDir: BASE_SCENE_DIR ?? new URL('../../scene', import.meta.url).pathname,
    viteCacheDir,
  };
};
