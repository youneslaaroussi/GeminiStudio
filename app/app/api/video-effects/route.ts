import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { isAssetServiceEnabled } from "@/app/lib/server/asset-service-client";
import {
  listVideoEffectJobsForAsset,
  startVideoEffectJob,
} from "@/app/lib/server/video-effects/service";

export const runtime = "nodejs";

const startJobSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  effectId: z.string().min(1, "Effect ID is required"),
  projectId: z.string().min(1, "Project ID is required"),
  params: z.record(z.any()).optional(),
});

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
    return NextResponse.json({ error: "Asset service not configured" }, { status: 503 });
  }

  const userId = await verifyToken(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assetId = request.nextUrl.searchParams.get("assetId");
  if (!assetId) {
    return NextResponse.json(
      { error: "assetId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const jobs = await listVideoEffectJobsForAsset(assetId);
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("Failed to list video effect jobs", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json({ error: "Asset service not configured" }, { status: 503 });
  }

  const userId = await verifyToken(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const json = await request.json();
    const payload = startJobSchema.parse(json);
    const job = await startVideoEffectJob({
      effectId: payload.effectId,
      assetId: payload.assetId,
      userId,
      projectId: payload.projectId,
      origin: request.nextUrl.origin,
      params: payload.params ?? {},
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request payload", details: error.flatten() },
        { status: 400 }
      );
    }
    console.error("Failed to start video effect job", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
