/**
 * Asset file proxy route.
 *
 * Proxies asset files from GCS to avoid CORS issues.
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

    // Fetch the file from GCS (no cache: asset can change after transcode)
    const response = await fetch(asset.signedUrl, { cache: "no-store" });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch asset file" },
        { status: response.status }
      );
    }

    const data = await response.arrayBuffer();
    const isDownload = searchParams.get("download") === "1";
    const hasVersion = searchParams.has("v");

    // Safe filename for Content-Disposition (strip path chars, quote if needed)
    const safeName = (asset.name || "download").replace(/[\\/"[\]:;|*?<>]/g, "_").trim() || "download";

    // If version param is present, URL is cache-busted so we can cache aggressively.
    // Otherwise, use no-cache for backwards compatibility with old URLs.
    const cacheControl = hasVersion
      ? "private, max-age=31536000, immutable" // 1 year - URL changes when asset updates
      : "private, no-store, must-revalidate";

    const headers: Record<string, string> = {
      "Content-Type": asset.mimeType || "application/octet-stream",
      "Content-Length": String(data.byteLength),
      "Cache-Control": cacheControl,
      "Access-Control-Allow-Origin": "*",
    };
    if (isDownload) {
      headers["Content-Disposition"] = `attachment; filename="${safeName.replace(/"/g, '\\"')}"`;
    }

    return new NextResponse(data, {
      status: 200,
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
