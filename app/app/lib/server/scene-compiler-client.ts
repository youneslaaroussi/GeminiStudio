/**
 * Client for communicating with the scene-compiler service.
 *
 * Used to compile Motion Canvas scenes on demand.
 * Follows the same HMAC signing pattern as the renderer and asset service clients.
 */

import { createHmac } from "crypto";

const SCENE_COMPILER_URL =
  process.env.SCENE_COMPILER_URL || "http://localhost:4001";
const SHARED_SECRET = process.env.SCENE_COMPILER_SHARED_SECRET;

/**
 * Generate HMAC authentication headers for scene compiler requests.
 * If SCENE_COMPILER_SHARED_SECRET is not set, returns empty headers (dev mode).
 */
function getAuthHeaders(body: string): Record<string, string> {
  if (!SHARED_SECRET) {
    return {};
  }
  const timestamp = Date.now();
  const payload = `${timestamp}.${body}`;
  const signature = createHmac("sha256", SHARED_SECRET)
    .update(payload)
    .digest("hex");
  return {
    "X-Signature": signature,
    "X-Timestamp": timestamp.toString(),
  };
}

export interface CompileSceneRequest {
  /** File overrides: path relative to scene root mapped to file content. */
  files?: Record<string, string>;
}

/** A single type/lint diagnostic from the compiler. */
export interface CompileSceneDiagnostic {
  file: string;
  line: number;
  column: number;
  message: string;
  code?: string;
  severity: 'error' | 'warning';
}

export interface CompileSceneResponse {
  /** The compiled project.js content. */
  js: string;
  /** Type/lint diagnostics from tsc (when available). Present even when build succeeded. */
  diagnostics?: CompileSceneDiagnostic[];
}

/**
 * Compile a Motion Canvas scene via the scene-compiler service.
 *
 * @param request - Compile request with optional file overrides
 * @returns The compiled project.js content
 * @throws If the compilation fails or the service is unavailable
 */
export async function compileScene(
  request: CompileSceneRequest = {}
): Promise<CompileSceneResponse> {
  const bodyStr = JSON.stringify(request);
  const authHeaders = getAuthHeaders(bodyStr);

  const response = await fetch(`${SCENE_COMPILER_URL}/compile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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
      `Scene compilation failed (HTTP ${response.status}): ${errorMessage}`
    );
  }

  return (await response.json()) as CompileSceneResponse;
}
