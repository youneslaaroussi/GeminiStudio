import { NextRequest, NextResponse } from "next/server";
import type { Project, TimelineClip } from "@/app/types/timeline";
import { readManifest } from "@/app/lib/server/asset-storage";
import { getPipelineStateForAsset } from "@/app/lib/server/pipeline/store";
import { createV4SignedUrl } from "@/app/lib/server/gcs-signed-url";

const RENDERER_API_URL = process.env.RENDERER_API_URL || "http://localhost:4000";
const GCS_BUCKET = process.env.ASSET_GCS_BUCKET;

interface RenderRequest {
  project: Project;
  projectId: string;
  output: {
    format: "mp4" | "webm" | "gif";
    quality: "low" | "web" | "social" | "studio";
    fps?: number;
  };
}

interface RendererJobResponse {
  jobId: string;
}

/**
 * Get a signed GCS URL for an asset, either from pipeline state or generate fresh
 */
async function getAssetSignedUrl(assetId: string): Promise<string | null> {
  try {
    const pipelineState = await getPipelineStateForAsset(assetId);
    const uploadStep = pipelineState.steps.find((s) => s.id === "cloud-upload");

    if (uploadStep?.status === "succeeded" && uploadStep.metadata) {
      const { bucket, objectName } = uploadStep.metadata as { bucket?: string; objectName?: string };
      if (bucket && objectName) {
        // Generate fresh signed URL (7 days expiry)
        return createV4SignedUrl({
          bucket,
          objectName,
          expiresInSeconds: 60 * 60 * 24 * 7,
        });
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Transform clip URLs from local to signed GCS URLs
 */
async function transformClipUrls(clip: TimelineClip): Promise<TimelineClip> {
  if (!("src" in clip) || !clip.assetId) {
    return clip;
  }

  const signedUrl = await getAssetSignedUrl(clip.assetId);
  if (signedUrl) {
    return { ...clip, src: signedUrl };
  }

  return clip;
}

/**
 * Transform project to use signed GCS URLs for all assets
 */
async function transformProjectForRenderer(project: Project): Promise<Project> {
  const transformedLayers = await Promise.all(
    project.layers.map(async (layer) => ({
      ...layer,
      clips: await Promise.all(layer.clips.map(transformClipUrls)),
    }))
  );

  return {
    ...project,
    layers: transformedLayers,
  };
}

/**
 * Calculate total timeline duration from layers
 */
function calculateTimelineDuration(project: Project): number {
  let maxEnd = 0;
  for (const layer of project.layers) {
    for (const clip of layer.clips) {
      const speed = clip.speed || 1;
      const end = clip.start + clip.duration / Math.max(speed, 0.0001);
      maxEnd = Math.max(maxEnd, end);
    }
  }
  return maxEnd;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RenderRequest;
    const { project, projectId, output } = body;

    if (!project || !projectId) {
      return NextResponse.json(
        { error: "Missing project or projectId" },
        { status: 400 }
      );
    }

    if (!GCS_BUCKET) {
      return NextResponse.json(
        { error: "GCS bucket not configured (ASSET_GCS_BUCKET)" },
        { status: 500 }
      );
    }

    // Transform project to use signed GCS URLs
    const transformedProject = await transformProjectForRenderer(project);

    // Generate output path and signed upload URL
    const timestamp = Date.now();
    const extension = output.format === "gif" ? "gif" : output.format === "webm" ? "webm" : "mp4";
    const outputObjectName = `renders/${projectId}/${timestamp}.${extension}`;

    const uploadUrl = createV4SignedUrl({
      bucket: GCS_BUCKET,
      objectName: outputObjectName,
      method: "PUT",
      expiresInSeconds: 60 * 60 * 24, // 24 hours for upload
    });

    // Calculate timeline duration
    const timelineDuration = calculateTimelineDuration(transformedProject);

    // Call renderer API
    const rendererPayload = {
      project: transformedProject,
      timelineDuration,
      output: {
        format: output.format,
        fps: output.fps || project.fps || 30,
        size: project.resolution,
        quality: output.quality,
        destination: `/tmp/render-${timestamp}.${extension}`,
        range: [0, timelineDuration],
        includeAudio: true,
        uploadUrl,
      },
    };

    const rendererResponse = await fetch(`${RENDERER_API_URL}/renders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rendererPayload),
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
    });
  } catch (error) {
    console.error("Render API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
