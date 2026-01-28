import { NextRequest, NextResponse } from "next/server";
import type { Project, TimelineClip } from "@/app/types/timeline";
import { getPipelineStateForAsset } from "@/app/lib/server/pipeline/store";
import { createV4SignedUrl } from "@/app/lib/server/gcs-signed-url";

const RENDERER_API_URL = process.env.RENDERER_API_URL || "http://localhost:4000";
const GCS_BUCKET = process.env.ASSET_GCS_BUCKET;

const UPLOAD_POLL_INTERVAL_MS = 500;
const UPLOAD_TIMEOUT_MS = 60000; // 60 seconds max wait

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
 * Collect all asset IDs from project clips
 */
function collectAssetIds(project: Project): string[] {
  const assetIds: string[] = [];
  for (const layer of project.layers) {
    for (const clip of layer.clips) {
      if ("assetId" in clip && clip.assetId) {
        assetIds.push(clip.assetId);
      }
    }
  }
  return [...new Set(assetIds)]; // dedupe
}

/**
 * Check if an asset's cloud-upload step is complete
 */
async function isAssetUploaded(assetId: string): Promise<boolean> {
  try {
    const pipelineState = await getPipelineStateForAsset(assetId);
    const uploadStep = pipelineState.steps.find((s) => s.id === "cloud-upload");
    return uploadStep?.status === "succeeded";
  } catch {
    return false;
  }
}

/**
 * Wait for all assets to be uploaded to GCS
 * Throws if timeout is reached
 */
async function waitForAssetUploads(assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;

  const startTime = Date.now();
  const pending = new Set(assetIds);

  while (pending.size > 0) {
    if (Date.now() - startTime > UPLOAD_TIMEOUT_MS) {
      throw new Error(
        `Timeout waiting for asset uploads. Still pending: ${[...pending].join(", ")}`
      );
    }

    for (const assetId of pending) {
      if (await isAssetUploaded(assetId)) {
        pending.delete(assetId);
      }
    }

    if (pending.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, UPLOAD_POLL_INTERVAL_MS));
    }
  }
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
 * Returns the transformed clip and optionally the assetId -> signedUrl mapping
 */
async function transformClipUrls(
  clip: TimelineClip,
  urlMap: Map<string, string>
): Promise<TimelineClip> {
  if (!("src" in clip) || !clip.assetId) {
    return clip;
  }

  const signedUrl = await getAssetSignedUrl(clip.assetId);
  if (signedUrl) {
    urlMap.set(clip.assetId, signedUrl);
    return { ...clip, src: signedUrl };
  }

  return clip;
}

/**
 * Transform project to use signed GCS URLs for all assets
 * Also updates transcription assetUrls to match transformed clip URLs
 */
async function transformProjectForRenderer(project: Project): Promise<Project> {
  // Map to track assetId -> signedUrl for transcription updates
  const assetUrlMap = new Map<string, string>();

  const transformedLayers = await Promise.all(
    project.layers.map(async (layer) => ({
      ...layer,
      clips: await Promise.all(
        layer.clips.map((clip) => transformClipUrls(clip, assetUrlMap))
      ),
    }))
  );

  // Transform transcription assetUrls to match the new signed URLs
  let transformedTranscriptions = project.transcriptions;
  if (project.transcriptions && assetUrlMap.size > 0) {
    transformedTranscriptions = { ...project.transcriptions };
    for (const [key, transcription] of Object.entries(transformedTranscriptions)) {
      const signedUrl = assetUrlMap.get(transcription.assetId);
      if (signedUrl) {
        transformedTranscriptions[key] = {
          ...transcription,
          assetUrl: signedUrl,
        };
      }
    }
  }

  return {
    ...project,
    layers: transformedLayers,
    transcriptions: transformedTranscriptions,
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

    // Wait for all assets to be uploaded to GCS before proceeding
    const assetIds = collectAssetIds(project);
    if (assetIds.length > 0) {
      console.log(`[Render] Waiting for ${assetIds.length} asset(s) to upload...`);
      await waitForAssetUploads(assetIds);
      console.log("[Render] All assets uploaded to GCS");
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
