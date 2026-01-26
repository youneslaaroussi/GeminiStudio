import { NextRequest, NextResponse } from "next/server";
import {
  ensureAssetStorage,
  deleteAsset,
  getAssetById,
  storedAssetToRemote,
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
