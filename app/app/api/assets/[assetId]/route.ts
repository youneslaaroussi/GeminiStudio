import { NextRequest, NextResponse } from "next/server";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import {
  isAssetServiceEnabled,
  getAssetFromService,
  deleteAssetFromService,
} from "@/app/lib/server/asset-service-client";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

async function verifyToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);

  try {
    await initAdmin();
    const decoded = await getAuth().verifyIdToken(token);
    return decoded.uid;
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
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
  const body = await request.json();

  const ASSET_SERVICE_URL = process.env.ASSET_SERVICE_URL || "http://localhost:8081";

  try {
    const response = await fetch(
      `${ASSET_SERVICE_URL}/api/assets/${userId}/${projectId}/${assetId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      }
      throw new Error(`Asset service returned ${response.status}`);
    }

    const asset = await response.json();
    return NextResponse.json({ asset });
  } catch (error) {
    console.error("Failed to update asset:", error);
    return NextResponse.json({ error: "Failed to update asset" }, { status: 500 });
  }
}
