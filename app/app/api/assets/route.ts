import { NextRequest, NextResponse } from "next/server";
import type { RemoteAsset } from "@/app/types/assets";
import {
  isAssetServiceEnabled,
  uploadToAssetService,
  listAssetsFromService,
  type AssetServiceAsset,
  type TranscodeOptions,
} from "@/app/lib/server/asset-service-client";
import { verifyBearerToken } from "@/app/lib/server/auth";
import { deductCredits, getBilling } from "@/app/lib/server/credits";
import {
  getUploadActionFromMimeType,
  getCreditsForAction,
} from "@/app/lib/credits-config";

export const runtime = "nodejs";

/**
 * Convert asset service response to RemoteAsset format.
 * Uses proxy URL to avoid CORS issues with GCS signed URLs.
 * Note: userId is NOT included in proxy URL - auth is via session cookie.
 */
function toRemoteAsset(asset: AssetServiceAsset, projectId: string): RemoteAsset {
  // Use proxy URL to avoid CORS issues (auth via session cookie, not query param)
  const proxyUrl = `/api/assets/${asset.id}/file?projectId=${projectId}`;

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
    description: asset.description,
  };
}

export async function GET(request: NextRequest) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json(
      { error: "Asset service not configured. Set ASSET_SERVICE_URL." },
      { status: 503 }
    );
  }

  const userId = await verifyBearerToken(request);
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
    return NextResponse.json({ assets: assets.map((a) => toRemoteAsset(a, projectId)) });
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

  const userId = await verifyBearerToken(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized. Include Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  const projectId = formData.get("projectId");
  const transcodeOptionsRaw = formData.get("transcodeOptions");

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  if (!projectId || typeof projectId !== "string") {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  // Parse transcode options if provided
  let transcodeOptions: TranscodeOptions | undefined;
  if (transcodeOptionsRaw && typeof transcodeOptionsRaw === "string") {
    try {
      transcodeOptions = JSON.parse(transcodeOptionsRaw);
    } catch (e) {
      console.warn("Failed to parse transcodeOptions:", e);
    }
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

  // Video extensions to check (browsers often send wrong MIME types)
  const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v', '.mpeg', '.mpg', '.3gp'];
  
  // HEIC/HEIF extensions that need conversion
  const heicExtensions = ['.heic', '.heif'];

  try {
    let transcodeStarted = false;
    let convertStarted = false;
    for (const file of files) {
      // Check if video by MIME type OR file extension (browsers often send wrong MIME types for .MOV etc)
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      const isVideo = file.type.startsWith("video/") || videoExtensions.includes(ext);
      
      // Check if HEIC/HEIF image that needs conversion
      const isHeic = file.type.startsWith("image/heic") || 
                     file.type.startsWith("image/heif") || 
                     heicExtensions.includes(ext);
      
      if (isVideo && transcodeOptions) {
        console.log(`[upload] Video detected: ${file.name} (type: ${file.type}, ext: ${ext}), forwarding transcode options`);
      }
      
      if (isHeic) {
        console.log(`[upload] HEIC/HEIF detected: ${file.name} (type: ${file.type}, ext: ${ext}), will convert to PNG`);
        convertStarted = true;
      }
      
      const result = await uploadToAssetService(userId, projectId, file, {
        source: "web",
        runPipeline: true,
        transcodeOptions: isVideo ? transcodeOptions : undefined,
      });
      uploaded.push(toRemoteAsset(result.asset, projectId));
      if (result.transcodeStarted) {
        transcodeStarted = true;
      }
    }

    return NextResponse.json(
      { assets: uploaded, creditsUsed: totalCreditsNeeded, transcodeStarted, convertStarted },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to upload to asset service:", error);
    // Note: Credits already deducted - could add refund logic here if needed
    return NextResponse.json(
      { error: "Failed to upload assets" },
      { status: 500 }
    );
  }
}
