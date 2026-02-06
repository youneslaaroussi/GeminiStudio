/**
 * Returns a short-lived signed URL for direct GCS playback (no proxy).
 * GET /api/assets/[assetId]/playback-url?projectId=xxx
 *
 * Use this URL as video/audio src so the browser loads from GCS directly,
 * avoiding proxy lag in production. CORS must be configured on the GCS bucket.
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
        { error: "Asset file not available for playback" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { url: asset.signedUrl },
      {
        headers: {
          "Cache-Control": "private, max-age=300", // 5 min - signed URLs typically valid 1h+
        },
      }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Asset not found") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    console.error("Playback URL failed:", err);
    return NextResponse.json(
      { error: "Failed to get playback URL" },
      { status: 500 }
    );
  }
}
