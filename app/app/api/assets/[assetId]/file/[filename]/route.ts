/**
 * Asset file proxy route with filename.
 *
 * Proxies asset files from GCS to avoid CORS issues.
 * GET /api/assets/[assetId]/file/[filename]?projectId=xxx
 *
 * The filename is included in the path for proper extension detection by browsers/players.
 * The actual filename is derived from the asset metadata, not the URL path.
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string; filename: string }> }
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

    // Fetch the file from GCS
    const response = await fetch(asset.signedUrl);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch asset file" },
        { status: response.status }
      );
    }

    const data = await response.arrayBuffer();

    // Return with proper content type and CORS headers
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType || "application/octet-stream",
        "Content-Length": String(data.byteLength),
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Failed to proxy asset file:", error);
    return NextResponse.json(
      { error: "Failed to proxy asset file" },
      { status: 500 }
    );
  }
}
