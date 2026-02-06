import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import type { RemoteAsset } from "@/app/types/assets";
import {
  isAssetServiceEnabled,
  reorderAssetsFromService,
  type AssetServiceAsset,
} from "@/app/lib/server/asset-service-client";
import { verifyBearerToken } from "@/app/lib/server/auth";

export const runtime = "nodejs";

/**
 * Convert asset service response to RemoteAsset format.
 */
function toRemoteAsset(asset: AssetServiceAsset, projectId: string): RemoteAsset {
  const playbackPath = `/api/assets/${asset.id}/playback?projectId=${projectId}`;
  const url = asset.signedUrl ?? playbackPath;
  return {
    id: asset.id,
    name: asset.name,
    url,
    mimeType: asset.mimeType,
    size: asset.size,
    type: asset.type as RemoteAsset["type"],
    uploadedAt: asset.uploadedAt,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    gcsUri: asset.gcsUri,
    signedUrl: asset.signedUrl,
    description: asset.description,
    notes: asset.notes,
  };
}

export async function POST(request: NextRequest) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json(
      { error: "Asset service not configured" },
      { status: 503 }
    );
  }

  const userId = await verifyBearerToken(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { projectId?: string; assetIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, assetIds } = body;
  if (!projectId || typeof projectId !== "string") {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  if (!Array.isArray(assetIds) || assetIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "assetIds must be an array of strings" }, { status: 400 });
  }

  try {
    const assets = await reorderAssetsFromService(userId, projectId, assetIds);
    revalidateTag("assets", "max");
    return NextResponse.json({
      assets: assets.map((a) => toRemoteAsset(a, projectId)),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Failed to reorder assets:", error);
    return NextResponse.json({ error: "Failed to reorder assets" }, { status: 500 });
  }
}
