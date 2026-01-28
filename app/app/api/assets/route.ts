import { NextRequest, NextResponse } from "next/server";
import type { RemoteAsset } from "@/app/types/assets";
import {
  isAssetServiceEnabled,
  uploadToAssetService,
  listAssetsFromService,
  type AssetServiceAsset,
} from "@/app/lib/server/asset-service-client";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";

export const runtime = "nodejs";

/**
 * Verify Firebase ID token and return user ID.
 */
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

/**
 * Convert asset service response to RemoteAsset format.
 * Uses proxy URL to avoid CORS issues with GCS signed URLs.
 */
function toRemoteAsset(asset: AssetServiceAsset, projectId: string, userId: string): RemoteAsset {
  // Use proxy URL to avoid CORS issues
  const proxyUrl = `/api/assets/${asset.id}/file?projectId=${projectId}&userId=${userId}`;

  return {
    id: asset.id,
    name: asset.name,
    url: proxyUrl,
    mimeType: asset.mimeType,
    size: asset.size,
    type: asset.type as RemoteAsset["type"],
    uploadedAt: asset.uploadedAt,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    gcsUri: asset.gcsUri,
    signedUrl: asset.signedUrl,
  };
}

export async function GET(request: NextRequest) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json(
      { error: "Asset service not configured. Set ASSET_SERVICE_URL." },
      { status: 503 }
    );
  }

  const userId = await verifyToken(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized. Include Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const assets = await listAssetsFromService(userId, projectId);
    return NextResponse.json({ assets: assets.map((a) => toRemoteAsset(a, projectId, userId)) });
  } catch (error) {
    console.error("Failed to list assets:", error);
    return NextResponse.json(
      { error: "Failed to list assets from service" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json(
      { error: "Asset service not configured. Set ASSET_SERVICE_URL." },
      { status: 503 }
    );
  }

  const userId = await verifyToken(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized. Include Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  const projectId = formData.get("projectId");

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  if (!projectId || typeof projectId !== "string") {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const uploaded: RemoteAsset[] = [];

  try {
    for (const file of files) {
      const result = await uploadToAssetService(userId, projectId, file, {
        source: "web",
        runPipeline: true,
      });
      uploaded.push(toRemoteAsset(result.asset, projectId, userId));
    }

    return NextResponse.json({ assets: uploaded }, { status: 201 });
  } catch (error) {
    console.error("Failed to upload to asset service:", error);
    return NextResponse.json(
      { error: "Failed to upload assets" },
      { status: 500 }
    );
  }
}
