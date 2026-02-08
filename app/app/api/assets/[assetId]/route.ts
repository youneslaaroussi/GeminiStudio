import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import {
  isAssetServiceEnabled,
  getAssetFromService,
  deleteAssetFromService,
  updateAssetFromService,
} from "@/app/lib/server/asset-service-client";
import { verifyAuth, verifyBearerToken } from "@/app/lib/server/auth";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

/** Bearer-only (used for DELETE/PATCH from API clients). */
async function verifyToken(request: NextRequest): Promise<string | null> {
  return verifyBearerToken(request);
}

export async function GET(request: NextRequest, context: RouteContext) {
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

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId query parameter is required" },
      { status: 400 }
    );
  }

  const { assetId } = await context.params;

  try {
    const asset = await getAssetFromService(userId, projectId, assetId);
    return NextResponse.json({ asset });
  } catch (error) {
    if (error instanceof Error && error.message === "Asset not found") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    console.error("Failed to get asset:", error);
    return NextResponse.json({ error: "Failed to get asset" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json(
      { error: "Asset service not configured" },
      { status: 503 }
    );
  }

  const userId = await verifyToken(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId query parameter is required" },
      { status: 400 }
    );
  }

  const { assetId } = await context.params;

  try {
    await deleteAssetFromService(userId, projectId, assetId);
    revalidateTag("assets", "max");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete asset:", error);
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json(
      { error: "Asset service not configured" },
      { status: 503 }
    );
  }

  const userId = await verifyToken(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId query parameter is required" },
      { status: 400 }
    );
  }

  const { assetId } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Allowed update fields
  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string") updates.name = body.name;
  if (typeof body.sortOrder === "number") updates.sortOrder = body.sortOrder;
  if (typeof body.notes === "string" || body.notes === null) updates.notes = body.notes ?? undefined;
  if (typeof body.description === "string" || body.description === null) updates.description = body.description ?? undefined;
  // Component asset fields
  if (typeof body.code === "string") updates.code = body.code;
  if (typeof body.componentName === "string") updates.componentName = body.componentName;
  if (Array.isArray(body.inputDefs)) updates.inputDefs = body.inputDefs;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid updates" }, { status: 400 });
  }

  try {
    const asset = await updateAssetFromService(userId, projectId, assetId, updates);
    revalidateTag("assets", "max");
    return NextResponse.json({ asset });
  } catch (error) {
    if (error instanceof Error && error.message === "Asset not found") {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    console.error("Failed to update asset:", error);
    return NextResponse.json({ error: "Failed to update asset" }, { status: 500 });
  }
}
