/**
 * Gemini Files API endpoint
 *
 * Uploads files to the Gemini Files API for use in multimodal conversations.
 * Returns a file_uri that can be used directly with Gemini models.
 */

import { NextRequest, NextResponse } from "next/server";
import { normalizeGeminiMimeType } from "@/app/lib/server/gemini/multimodal";
import {
  uploadFileFromUrl,
  waitForFileActive,
  isYouTubeUrl,
  isGeminiFileUri,
  GeminiFilesApiError,
} from "@/app/lib/server/gemini/files-api";
import { verifyAuth } from "@/app/lib/server/auth";

export const runtime = "nodejs";

interface UploadRequestBody {
  /** URL of the file to upload */
  url: string;
  /** MIME type of the file */
  mimeType: string;
  /** Optional display name */
  displayName?: string;
}

export async function POST(request: NextRequest) {
  const requestId = `gemini-files_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  // Require authentication
  const userId = await verifyAuth(request);
  if (!userId) {
    console.error(`[gemini-files:${requestId}] ERROR: Unauthorized`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as UploadRequestBody;

    if (!body.url) {
      console.error(`[gemini-files:${requestId}] ERROR: url is required`);
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    if (!body.mimeType) {
      console.error(`[gemini-files:${requestId}] ERROR: mimeType is required`);
      return NextResponse.json({ error: "mimeType is required" }, { status: 400 });
    }

    const normalizedMimeType = normalizeGeminiMimeType(body.mimeType);

    // YouTube URLs can be used directly with Gemini - no upload needed
    if (isYouTubeUrl(body.url)) {
      return NextResponse.json({
        fileUri: body.url,
        mimeType: normalizedMimeType,
        displayName: body.displayName,
        isYouTube: true,
      });
    }

    // Already a Gemini Files API URI - no upload needed
    if (isGeminiFileUri(body.url)) {
      return NextResponse.json({
        fileUri: body.url,
        mimeType: normalizedMimeType,
        displayName: body.displayName,
        isExisting: true,
      });
    }

    // HTTP(S) URL - upload to Files API
    if (!body.url.startsWith("http://") && !body.url.startsWith("https://")) {
      console.error(`[gemini-files:${requestId}] ERROR: Invalid URL format`, { url: body.url });
      return NextResponse.json(
        { error: "Invalid URL format. Expected http:// or https://" },
        { status: 400 }
      );
    }

    try {
      const uploadedFile = await uploadFileFromUrl(body.url, {
        mimeType: normalizedMimeType,
        displayName: body.displayName,
      });
      const activeFile = await waitForFileActive(uploadedFile.name);

      return NextResponse.json({
        fileUri: activeFile.uri,
        mimeType: activeFile.mimeType,
        displayName: activeFile.displayName,
        name: activeFile.name,
        sizeBytes: activeFile.sizeBytes,
        expirationTime: activeFile.expirationTime,
      });
    } catch (err) {
      if (err instanceof GeminiFilesApiError) {
        console.error(`[gemini-files:${requestId}] Gemini Files API error`, {
          message: err.message,
          statusCode: err.statusCode,
          details: err.details,
        });
        return NextResponse.json(
          { error: `Failed to upload file: ${err.message}`, details: err.details },
          { status: err.statusCode }
        );
      }
      throw err;
    }
  } catch (error) {
    console.error(`[gemini-files:${requestId}] Unexpected error`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
