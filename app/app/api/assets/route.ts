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
import { deductCredits, getBilling } from "@/app/lib/server/credits";
import {
  getUploadActionFromMimeType,
  getCreditsForAction,
} from "@/app/lib/credits-config";

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

  // Calculate total credits needed for all files
  const totalCreditsNeeded = files.reduce((sum, file) => {
    const action = getUploadActionFromMimeType(file.type);
    return sum + getCreditsForAction(action);
  }, 0);

  // Check if user has enough credits
  try {
    const billing = await getBilling(userId);
    if (billing.credits < totalCreditsNeeded) {
      return NextResponse.json(
        {
          error: `Insufficient credits. You need ${totalCreditsNeeded} R-Credits to upload these files. You have ${billing.credits}.`,
          reason: "insufficient_credits",
          required: totalCreditsNeeded,
          current: billing.credits,
        },
        { status: 402 }
      );
    }
  } catch (error) {
    console.error("Failed to check credits:", error);
    return NextResponse.json(
      { error: "Failed to verify credits" },
      { status: 500 }
    );
  }

  // Deduct credits upfront (before uploading)
  try {
    await deductCredits(userId, totalCreditsNeeded, "asset_upload");
  } catch (error) {
    console.error("Failed to deduct credits:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("Insufficient")) {
      return NextResponse.json(
        { error: message, reason: "insufficient_credits" },
        { status: 402 }
      );
    }
    return NextResponse.json(
      { error: "Failed to process credits" },
      { status: 500 }
    );
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

    return NextResponse.json({ assets: uploaded, creditsUsed: totalCreditsNeeded }, { status: 201 });
  } catch (error) {
    console.error("Failed to upload to asset service:", error);
    // Note: Credits already deducted - could add refund logic here if needed
    return NextResponse.json(
      { error: "Failed to upload assets" },
      { status: 500 }
    );
  }
}
