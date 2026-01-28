/**
 * Asset API v2 - Uses the asset service for cloud deployments.
 *
 * This route forwards requests to the asset service, which handles:
 * - GCS storage
 * - Firestore metadata
 * - ffprobe metadata extraction
 * - Pipeline processing (shot detection, labels, transcription, etc.)
 *
 * Requires:
 * - ASSET_SERVICE_URL environment variable
 * - Firebase ID token in Authorization header
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import {
  isAssetServiceEnabled,
  uploadToAssetService,
  listAssetsFromService,
} from "@/app/lib/server/asset-service-client";

export const runtime = "nodejs";

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
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
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
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  try {
    const assets = await listAssetsFromService(userId, projectId);
    return NextResponse.json({ assets });
  } catch (error) {
    console.error("Failed to list assets from service:", error);
    return NextResponse.json(
      { error: "Failed to list assets" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  const projectId = formData.get("projectId");

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  if (!projectId || typeof projectId !== "string") {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const uploaded = [];

  try {
    for (const file of files) {
      const result = await uploadToAssetService(userId, projectId, file, {
        source: "web",
        runPipeline: true,
      });
      uploaded.push(result.asset);
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
