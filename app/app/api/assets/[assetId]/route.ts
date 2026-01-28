import { NextRequest, NextResponse } from "next/server";
import {
  ensureAssetStorage,
  deleteAsset,
  getAssetById,
  storedAssetToRemote,
  updateAssetMetadata,
} from "@/app/lib/server/asset-storage";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  await ensureAssetStorage();
  const { assetId } = await context.params;

  const asset = await getAssetById(assetId);
  if (!asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  return NextResponse.json({ asset: storedAssetToRemote(asset) });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  await ensureAssetStorage();
  const { assetId } = await context.params;

  const deleted = await deleteAsset(assetId);
  if (!deleted) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

interface MetadataUpdateBody {
  width?: number;
  height?: number;
  duration?: number;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  await ensureAssetStorage();
  const { assetId } = await context.params;

  const body = (await request.json()) as MetadataUpdateBody;
  const { width, height, duration } = body;

  // Validate input
  if (width !== undefined && (typeof width !== "number" || width <= 0)) {
    return NextResponse.json({ error: "Invalid width" }, { status: 400 });
  }
  if (height !== undefined && (typeof height !== "number" || height <= 0)) {
    return NextResponse.json({ error: "Invalid height" }, { status: 400 });
  }
  if (duration !== undefined && (typeof duration !== "number" || duration <= 0)) {
    return NextResponse.json({ error: "Invalid duration" }, { status: 400 });
  }

  const updated = await updateAssetMetadata(assetId, { width, height, duration });
  if (!updated) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

  return NextResponse.json({ asset: storedAssetToRemote(updated) });
}
