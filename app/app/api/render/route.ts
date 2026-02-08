import { NextRequest, NextResponse } from "next/server";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { createV4SignedUrl } from "@/app/lib/server/gcs-signed-url";
import { deductCredits } from "@/app/lib/server/credits";
import { getCreditsForAction } from "@/app/lib/credits-config";
import { signRendererRequest, isRendererSigningEnabled } from "@/app/lib/server/hmac";

const RENDERER_API_URL = process.env.RENDERER_API_URL || "http://localhost:4000";
const GCS_BUCKET = process.env.ASSET_GCS_BUCKET;

interface RenderRequest {
  projectId: string;
  branchId?: string;
  output: {
    format: "mp4" | "webm" | "gif";
    quality: "low" | "web" | "social" | "studio";
    fps?: number;
    range?: [number, number];
  };
  /** Preview mode: low-res (360p), low fps (10), low quality for fast agent review */
  preview?: boolean;
}

interface RendererJobResponse {
  jobId: string;
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

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyToken(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as RenderRequest;
    const { projectId, branchId = "main", output, preview } = body;

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing projectId" },
        { status: 400 }
      );
    }

    // Preview renders use reduced credits (1/4 of normal cost)
    const baseCost = getCreditsForAction("render");
    const cost = preview ? Math.max(1, Math.floor(baseCost / 4)) : baseCost;
    try {
      await deductCredits(userId, cost, preview ? "render_preview" : "render");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Insufficient credits";
      return NextResponse.json({ error: msg, required: cost }, { status: 402 });
    }

    if (!GCS_BUCKET) {
      return NextResponse.json(
        { error: "GCS bucket not configured (ASSET_GCS_BUCKET)" },
        { status: 500 }
      );
    }

    // Generate signed upload URL for GCS
    const timestamp = Date.now();
    const extension = output.format === "gif" ? "gif" : output.format === "webm" ? "webm" : "mp4";
    const previewPrefix = preview ? "previews" : "renders";
    const outputObjectName = `${previewPrefix}/${projectId}/${timestamp}.${extension}`;

    const uploadUrl = createV4SignedUrl({
      bucket: GCS_BUCKET,
      objectName: outputObjectName,
      method: "PUT",
      expiresInSeconds: 60 * 60 * 24, // 24 hours for upload
    });

    // Preview mode settings
    const previewSettings = preview
      ? {
          fps: 10,
          quality: "low" as const,
          resolutionScale: 0.33,
        }
      : null;

    // Build minimal payload — renderer fetches everything else
    const rendererPayload = {
      userId,
      projectId,
      branchId,
      output: {
        format: output.format,
        fps: previewSettings?.fps ?? output.fps,
        quality: previewSettings?.quality ?? output.quality,
        range: output.range,
        includeAudio: true,
        uploadUrl,
      },
      ...(previewSettings && {
        options: {
          resolutionScale: previewSettings.resolutionScale,
        },
      }),
    };

    // Sign the request for renderer authentication
    const rendererBody = JSON.stringify(rendererPayload);
    const rendererTimestamp = Date.now();
    const rendererHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (isRendererSigningEnabled()) {
      const signature = signRendererRequest(rendererBody, rendererTimestamp);
      rendererHeaders["X-Signature"] = signature;
      rendererHeaders["X-Timestamp"] = rendererTimestamp.toString();
    }

    const rendererResponse = await fetch(`${RENDERER_API_URL}/renders`, {
      method: "POST",
      headers: rendererHeaders,
      body: rendererBody,
    });

    if (!rendererResponse.ok) {
      const errorText = await rendererResponse.text();
      console.error("Renderer API error:", errorText);
      return NextResponse.json(
        { error: `Renderer error: ${rendererResponse.status}` },
        { status: 502 }
      );
    }

    const rendererResult = (await rendererResponse.json()) as RendererJobResponse;

    return NextResponse.json({
      jobId: rendererResult.jobId,
      status: "queued",
      outputPath: `gs://${GCS_BUCKET}/${outputObjectName}`,
      preview: preview ?? false,
    });
  } catch (error) {
    console.error("Render API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
