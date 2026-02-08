/**
 * API route: POST /api/compile-scene
 *
 * Proxies scene compilation requests to the scene-compiler service.
 * Requires Firebase authentication (Bearer token or session cookie).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/app/lib/server/auth";
import { compileScene } from "@/app/lib/server/scene-compiler-client";

/** Maximum request body size (200KB) */
const MAX_BODY_BYTES = 204800;

/**
 * Only custom component paths are allowed for compile overrides.
 * Pattern: src/components/custom/<name>.tsx where name is a single path segment (alphanumeric, underscore, hyphen).
 */
const ALLOWED_FILE_PATH_REGEX = /^src\/components\/custom\/[a-zA-Z0-9_-]+\.tsx$/;

export async function POST(request: NextRequest) {
  try {
    // 1. Verify authentication
    const userId = await verifyAuth(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse and validate request body
    const contentLength = parseInt(
      request.headers.get("content-length") ?? "0",
      10
    );
    if (contentLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: `Request body too large (max ${MAX_BODY_BYTES} bytes)` },
        { status: 413 }
      );
    }

    const body = await request.json();
    const { files } = body as { files?: Record<string, string> };

    // Validate files if provided
    if (files !== undefined) {
      if (typeof files !== "object" || files === null || Array.isArray(files)) {
        return NextResponse.json(
          { error: "files must be a Record<string, string>" },
          { status: 400 }
        );
      }

      for (const [key, value] of Object.entries(files)) {
        if (typeof value !== "string") {
          return NextResponse.json(
            { error: `files["${key}"] must be a string` },
            { status: 400 }
          );
        }
        if (!ALLOWED_FILE_PATH_REGEX.test(key)) {
          return NextResponse.json(
            { error: `files: path "${key}" is not allowed. Only src/components/custom/<name>.tsx is permitted.` },
            { status: 400 }
          );
        }
      }
    }

    // 3. Compile via the scene-compiler service
    const result = await compileScene({ files });

    // 4. Return compiled JS
    return NextResponse.json(result);
  } catch (error) {
    console.error("[compile-scene] Error:", error);

    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("timed out") ? 504 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
