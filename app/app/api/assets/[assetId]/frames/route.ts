/**
 * Get fresh signed frame URLs (generated on-demand - signed URLs expire).
 * GET /api/assets/[assetId]/frames?projectId=xxx
 */

import { NextRequest, NextResponse } from "next/server";
import {
  isAssetServiceEnabled,
  getAssetFramesFromService,
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
    const data = await getAssetFramesFromService(userId, projectId, assetId);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Asset not found") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    console.error("Frames fetch failed:", err);
    return NextResponse.json(
      { error: "Failed to get frames" },
      { status: 500 }
    );
  }
}
