/**
 * Client for communicating with the scene-compiler service.
 *
 * Used to compile Motion Canvas scenes on demand before each render.
 * Follows the same HMAC signing pattern as the app's scene-compiler-client.
 */

import { createHmac } from 'crypto';
import { logger } from '../logger.js';
import type { RendererConfig } from '../config.js';

export interface CompileSceneRequest {
  /** File overrides: path relative to scene root mapped to file content. */
  files?: Record<string, string>;
  /** When false, skip tsc (faster). Renderer does not need diagnostics. */
  includeDiagnostics?: boolean;
}

export interface CompileSceneResponse {
  /** The compiled project.js content. */
  js: string;
}

/**
 * Generate HMAC authentication headers for scene compiler requests.
 * If sharedSecret is not set, returns empty headers (dev mode).
 */
function getAuthHeaders(body: string, sharedSecret?: string): Record<string, string> {
  if (!sharedSecret) {
    return {};
  }
  const timestamp = Date.now();
  const payload = `${timestamp}.${body}`;
  const signature = createHmac('sha256', sharedSecret)
    .update(payload)
    .digest('hex');
  return {
    'X-Signature': signature,
    'X-Timestamp': timestamp.toString(),
  };
}

/**
 * Compile a Motion Canvas scene via the scene-compiler service.
 *
 * @param config - Renderer configuration (contains scene compiler URL and secret)
 * @param request - Compile request with optional file overrides
 * @returns The compiled project.js content
 * @throws If the compilation fails or the service is unavailable
 */
export async function compileScene(
  config: RendererConfig,
  request: CompileSceneRequest = {},
): Promise<CompileSceneResponse> {
  const bodyStr = JSON.stringify(request);
  const authHeaders = getAuthHeaders(bodyStr, config.sceneCompilerSharedSecret);

  const url = `${config.sceneCompilerUrl}/compile`;

  logger.info(
    { url, fileOverrides: Object.keys(request.files ?? {}) },
    'Requesting scene compilation',
  );

  const startTime = Date.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: bodyStr,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage: string;
    try {
      const parsed = JSON.parse(errorBody);
      errorMessage = parsed.error || errorBody;
    } catch {
      errorMessage = errorBody;
    }
    throw new Error(
      `Scene compilation failed (HTTP ${response.status}): ${errorMessage}`,
    );
  }

  const result = (await response.json()) as CompileSceneResponse;

  const elapsed = Date.now() - startTime;
  logger.info(
    { elapsed, outputSize: Buffer.byteLength(result.js) },
    'Scene compilation completed',
  );

  return result;
}
