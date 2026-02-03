/**
 * Asset file proxy route with streaming and Range request support.
 *
 * Proxies asset files from GCS to avoid CORS issues.
 * Supports Range requests for video seeking and streaming playback.
 * GET /api/assets/[assetId]/file?projectId=xxx
 *
 * Authentication: Session cookie or Bearer token required.
 * User ID is extracted from authentication, not from query params.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isAssetServiceEnabled,
  getAssetFromService,
} from "@/app/lib/server/asset-service-client";
import { verifyAuth } from "@/app/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * HEAD request for browsers to check file size before Range requests.
 * Returns metadata without body for efficient preflight checks.
 */
export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  if (!isAssetServiceEnabled()) {
    return new NextResponse(null, { status: 503 });
  }

  const userId = await verifyAuth(request);
  if (!userId) {
    return new NextResponse(null, { status: 401 });
  }

  const { assetId } = await params;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId || !assetId) {
    return new NextResponse(null, { status: 400 });
  }

  try {
    const asset = await getAssetFromService(userId, projectId, assetId);
    if (!asset.signedUrl) {
      return new NextResponse(null, { status: 404 });
    }

    // HEAD request to GCS to get file size
    const response = await fetch(asset.signedUrl, { method: "HEAD" });
    if (!response.ok) {
      return new NextResponse(null, { status: response.status });
    }

    return new NextResponse(null, {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType || response.headers.get("Content-Type") || "application/octet-stream",
        "Content-Length": response.headers.get("Content-Length") || "0",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}

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

  // Verify authentication (session cookie or bearer token)
  const userId = await verifyAuth(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { assetId } = await params;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }
  if (!assetId) {
    return NextResponse.json(
      { error: "assetId is required" },
      { status: 400 }
    );
  }

  try {
    // Get asset info including signed URL - userId comes from auth, not query params
    const asset = await getAssetFromService(userId, projectId, assetId);

    if (!asset.signedUrl) {
      return NextResponse.json(
        { error: "Asset file not available" },
        { status: 404 }
      );
    }

    // Forward Range header to GCS for partial content / seeking support
    const rangeHeader = request.headers.get("Range");
    const fetchHeaders: HeadersInit = {};
    if (rangeHeader) {
      fetchHeaders["Range"] = rangeHeader;
    }

    // Fetch from GCS with streaming (no buffering entire file)
    const response = await fetch(asset.signedUrl, {
      cache: "no-store",
      headers: fetchHeaders,
    });

    if (!response.ok && response.status !== 206) {
      return NextResponse.json(
        { error: "Failed to fetch asset file" },
        { status: response.status }
      );
    }

    const isDownload = searchParams.get("download") === "1";
    const hasVersion = searchParams.has("v");

    // Safe filename for Content-Disposition; ensure extension matches actual type (webm, gif, mp4)
    const mimeExt =
      asset.mimeType?.startsWith("video/webm")
        ? ".webm"
        : asset.mimeType?.startsWith("image/gif")
          ? ".gif"
          : asset.mimeType?.startsWith("video/")
            ? ".mp4"
            : "";
    let safeName = (asset.name || "download").replace(/[\\/"[\]:;|*?<>]/g, "_").trim() || "download";
    if (mimeExt && !safeName.toLowerCase().endsWith(mimeExt)) {
      const base = safeName.replace(/\.[^.]*$/, "") || safeName;
      safeName = base + mimeExt;
    }

    // If version param is present, URL is cache-busted so we can cache aggressively.
    // Otherwise, use no-cache for backwards compatibility with old URLs.
    const cacheControl = hasVersion
      ? "private, max-age=31536000, immutable" // 1 year - URL changes when asset updates
      : "private, no-store, must-revalidate";

    const headers: Record<string, string> = {
      "Content-Type": asset.mimeType || response.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": cacheControl,
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes", // Tell browser we support Range requests
    };

    // Forward content length
    const contentLength = response.headers.get("Content-Length");
    if (contentLength) {
      headers["Content-Length"] = contentLength;
    }

    // Forward Content-Range for partial responses (206)
    const contentRange = response.headers.get("Content-Range");
    if (contentRange) {
      headers["Content-Range"] = contentRange;
    }

    if (isDownload) {
      headers["Content-Disposition"] = `attachment; filename="${safeName.replace(/"/g, '\\"')}"`;
    }

    // Stream the response body directly without buffering
    return new NextResponse(response.body, {
      status: response.status, // 200 for full, 206 for partial
      headers,
    });
  } catch (error) {
    console.error("Failed to proxy asset file:", error);
    return NextResponse.json(
      { error: "Failed to proxy asset file" },
      { status: 500 }
    );
  }
}
