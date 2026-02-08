/**
 * Download proxy for assets (video, image, audio, other).
 * Fetches the real file from GCS server-side and streams it so the client
 * gets the actual bytes (avoids CORS / signed-URL issues when fetching from browser).
 *
 * GET /api/assets/[assetId]/download?projectId=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isAssetServiceEnabled,
  getAssetFromService,
} from "@/app/lib/server/asset-service-client";
import { verifyAuth } from "@/app/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json(
      { error: "Asset service not configured" },
      { status: 503 }
    );
  }

  const userId = await verifyAuth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId } = await params;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId || !assetId) {
    return NextResponse.json(
      { error: "projectId and assetId are required" },
      { status: 400 }
    );
  }

  try {
    const asset = await getAssetFromService(userId, projectId, assetId);
    if (!asset.signedUrl) {
      return NextResponse.json(
        { error: "Asset file not available for download" },
        { status: 404 }
      );
    }

    // Fetch the real file from GCS (server-side, no CORS)
    const response = await fetch(asset.signedUrl, { cache: "no-store" });
    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch file: ${response.status}` },
        { status: response.status }
      );
    }

    const contentType =
      response.headers.get("content-type") || asset.mimeType || "application/octet-stream";
    const contentLength = response.headers.get("content-length");

    // Filename: prefer asset name (keep original extension), else derive from mime
    let filename = (asset.name || asset.fileName || "download").trim();
    if (!filename || filename === "download") {
      const ext = extensionFromMimeType(asset.mimeType || contentType);
      filename = `asset-${assetId}${ext}`;
    } else if (!/\.\w+$/.test(filename)) {
      const ext = extensionFromMimeType(asset.mimeType || contentType);
      if (ext) filename = `${filename}${ext}`;
    }
    const safe = filename.replace(/[<>:"/\\|?*]+/g, "_").replace(/\s+/g, " ").trim() || "download";

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safe}"`,
    });
    if (contentLength) headers.set("Content-Length", contentLength);

    return new NextResponse(response.body, { status: 200, headers });
  } catch (err) {
    if (err instanceof Error && err.message === "Asset not found") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    console.error("Asset download failed:", err);
    return NextResponse.json(
      { error: "Download failed" },
      { status: 500 }
    );
  }
}

function extensionFromMimeType(mimeType: string): string {
  const mime = (mimeType || "").split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-matroska": ".mkv",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/webm": ".weba",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
  };
  return map[mime] ?? "";
}
