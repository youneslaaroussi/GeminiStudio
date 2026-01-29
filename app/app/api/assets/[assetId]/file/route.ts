/**
 * Asset file proxy route.
 *
 * Proxies asset files from GCS to avoid CORS issues.
 * GET /api/assets/[assetId]/file?projectId=xxx&userId=xxx
 *
 * Note: Auth is relaxed here since this is just proxying already-signed GCS URLs.
 * The userId + projectId + assetId combination provides access control.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isAssetServiceEnabled,
  getAssetFromService,
} from "@/app/lib/server/asset-service-client";

export const runtime = "nodejs";

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

  const { assetId } = await params;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const userId = searchParams.get("userId");

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }
  if (!userId) {
    return NextResponse.json(
      { error: "userId is required" },
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
    // Get asset info including signed URL
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
