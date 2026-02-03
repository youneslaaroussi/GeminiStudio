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
  // Require authentication
  const userId = await verifyAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as UploadRequestBody;

    if (!body.url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    if (!body.mimeType) {
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
      return NextResponse.json(
        { error: "Invalid URL format. Expected http:// or https://" },
        { status: 400 }
      );
    }

    console.log(`[gemini-files] Uploading to Gemini Files API from URL...`);

    try {
      const uploadedFile = await uploadFileFromUrl(body.url, {
        mimeType: normalizedMimeType,
        displayName: body.displayName,
      });

      // Wait for the file to be processed
      const activeFile = await waitForFileActive(uploadedFile.name);

      console.log(`[gemini-files] File uploaded successfully: ${activeFile.uri}`);

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
        return NextResponse.json(
          { error: `Failed to upload file: ${err.message}`, details: err.details },
          { status: err.statusCode }
        );
      }
      throw err;
    }
  } catch (error) {
    console.error("[gemini-files] Failed to upload file:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
