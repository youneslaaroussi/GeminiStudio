import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import type { RemoteAsset } from "@/app/types/assets";
import {
  isAssetServiceEnabled,
  uploadToAssetService,
  listAssetsFromService,
  type TranscodeOptions,
} from "@/app/lib/server/asset-service-client";
import { verifyBearerToken } from "@/app/lib/server/auth";
import { toRemoteAsset } from "./utils";
import { calculateTotalCredits, verifyAndDeductCredits, CreditsError } from "./credits";
import { isHeicFile, isVideoFile } from "@/app/lib/uploads/file-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const res = NextResponse.json({ assets: assets.map((a) => toRemoteAsset(a, projectId)) });
    res.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate, max-age=0");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
    return res;
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

  const totalCreditsNeeded = calculateTotalCredits(files.map((file) => ({ mimeType: file.type })));

  try {
    await verifyAndDeductCredits(userId, totalCreditsNeeded);
  } catch (error) {
    if (error instanceof CreditsError) {
      return NextResponse.json(error.responseBody, { status: error.status });
    }
    throw error;
  }

  const uploaded: RemoteAsset[] = [];

  try {
    let transcodeStarted = false;
    let convertStarted = false;
    for (const file of files) {
      const videoFile = isVideoFile(file.type, file.name);
      const heicFile = isHeicFile(file.type, file.name);

      if (videoFile && transcodeOptions) {
        console.log(`[upload] Video detected: ${file.name} (type: ${file.type}), forwarding transcode options`);
      }

      if (heicFile) {
        console.log(`[upload] HEIC/HEIF detected: ${file.name} (type: ${file.type}), will convert to PNG`);
        convertStarted = true;
      }
      
      const result = await uploadToAssetService(userId, projectId, file, {
        source: "web",
        runPipeline: true,
        transcodeOptions: videoFile ? transcodeOptions : undefined,
      });
      uploaded.push(toRemoteAsset(result.asset, projectId));
      if (result.transcodeStarted) {
        transcodeStarted = true;
      }
    }

    revalidateTag("assets", "max"); // so list + file meta caches see new assets
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
