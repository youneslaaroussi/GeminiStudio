import { NextRequest, NextResponse } from "next/server";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { startVeoJob, listVeoJobsForProject } from "@/app/lib/server/veo-service";
import { isAssetServiceEnabled } from "@/app/lib/server/asset-service-client";
import { deductCredits } from "@/app/lib/server/credits";
import { getCreditsForAction } from "@/app/lib/credits-config";
import type { VeoJobParams } from "@/app/types/veo";

export const runtime = "nodejs";

interface VeoRequest {
  prompt?: string;
  durationSeconds?: 4 | 6 | 8;
  aspectRatio?: "16:9" | "9:16";
  resolution?: "720p" | "1080p" | "4k";
  generateAudio?: boolean;
  resizeMode?: "pad" | "crop";
  image?: { data?: string; mimeType?: string };
  lastFrame?: { data?: string; mimeType?: string };
  video?: { data?: string; mimeType?: string };
  referenceImages?: Array<{ data?: string; mimeType?: string; referenceType?: string }>;
  negativePrompt?: string;
  personGeneration?: "allow_all" | "allow_adult" | "dont_allow";
  projectId?: string;
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

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const jobs = await listVeoJobsForProject(projectId);
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("Failed to list VEO jobs", error);
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
    const body = (await request.json()) as VeoRequest;
    const {
      prompt,
      durationSeconds = 8,
      aspectRatio = "16:9",
      resolution = "720p",
      generateAudio = true,
      resizeMode,
      image,
      lastFrame,
      video,
      referenceImages,
      negativePrompt,
      personGeneration,
      projectId,
    } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const requiresEightSeconds =
      Boolean(video) || Boolean(referenceImages?.length) || resolution === "1080p" || resolution === "4k";
    if (requiresEightSeconds && durationSeconds !== 8) {
      return NextResponse.json(
        { error: "Veo requires an 8 second duration for the selected inputs/resolution." },
        { status: 400 }
      );
    }

    if (video && resolution !== "720p") {
      return NextResponse.json(
        { error: "Video extension currently supports 720p output only." },
        { status: 400 }
      );
    }

    if (lastFrame && !image) {
      return NextResponse.json(
        { error: "A starting image is required when specifying a last frame." },
        { status: 400 }
      );
    }

    if (referenceImages && referenceImages.length > 3) {
      return NextResponse.json(
        { error: "Veo 3.1 supports up to 3 reference images." },
        { status: 400 }
      );
    }

    const cost = getCreditsForAction("veo_generation", {
      veo: { resolution, durationSeconds },
    });

    try {
      await deductCredits(userId, cost, "veo_generation");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Insufficient credits";
      return NextResponse.json(
        { error: msg, required: cost },
        { status: 402 }
      );
    }

    const params: VeoJobParams = {
      prompt: prompt.trim(),
      durationSeconds,
      aspectRatio,
      resolution,
      generateAudio,
      resizeMode,
      image,
      lastFrame,
      video,
      referenceImages,
      negativePrompt,
      personGeneration,
      projectId,
      userId,
    };

    const job = await startVeoJob(params);

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    console.error("Veo job start failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
