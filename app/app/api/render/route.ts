import { NextRequest, NextResponse } from "next/server";
import type { Project, TimelineClip } from "@/app/types/timeline";
import type { ProjectTranscription } from "@/app/types/transcription";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getPipelineStateFromService, isAssetServiceEnabled } from "@/app/lib/server/asset-service-client";
import { createV4SignedUrl } from "@/app/lib/server/gcs-signed-url";
import { deductCredits } from "@/app/lib/server/credits";
import { getCreditsForAction } from "@/app/lib/credits-config";

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

/**
 * Collect asset IDs from clips that need to wait for upload.
 * Skips clips that already have a valid src URL (not blob:).
 */
function collectPendingAssetIds(project: Project): string[] {
  const assetIds: string[] = [];
  for (const layer of project.layers) {
    for (const clip of layer.clips) {
      if ("assetId" in clip && clip.assetId && "src" in clip) {
        const src = clip.src || "";
        // Skip if already has a valid URL (http/https or local api proxy)
        if (src.startsWith("http") || src.startsWith("/api/")) {
          console.log(`[Render] Clip ${clip.assetId} already has valid src, skipping upload wait`);
          continue;
        }
        // Need to wait for blob: URLs or empty src
        console.log(`[Render] Clip ${clip.assetId} needs upload wait, src: ${src.substring(0, 50)}`);
        assetIds.push(clip.assetId);
      }
    }
  }
  return [...new Set(assetIds)]; // dedupe
}

/**
 * Check if an asset's upload step is complete.
 * Returns: { uploaded: boolean, hasPipeline: boolean }
 * - uploaded=true means the asset is ready in GCS
 * - hasPipeline=false means no pipeline exists (asset not being processed, skip waiting)
 */
async function checkAssetUploadStatus(userId: string, projectId: string, assetId: string): Promise<{ uploaded: boolean; hasPipeline: boolean }> {
  try {
    const pipelineState = await getPipelineStateFromService(userId, projectId, assetId);
    const uploadStep = pipelineState.steps.find((s) => s.id === "upload" || s.id === "cloud-upload");
    console.log(`[Render] Asset ${assetId} pipeline state:`, JSON.stringify({
      steps: pipelineState.steps.map(s => ({ id: s.id, status: s.status })),
      uploadStep: uploadStep ? { status: uploadStep.status, metadata: uploadStep.metadata } : null,
    }));
    return {
      uploaded: uploadStep?.status === "succeeded",
      hasPipeline: true,
    };
  } catch (err) {
    // No pipeline state - asset isn't being uploaded via the pipeline
    console.log(`[Render] Asset ${assetId} no pipeline:`, err);
    return { uploaded: false, hasPipeline: false };
  }
}

/**
 * Wait for assets with active pipelines to be uploaded to GCS.
 * Assets without a pipeline (not being uploaded) are skipped - they'll use local URLs.
 */
async function waitForAssetUploads(userId: string, projectId: string, assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;

  const startTime = Date.now();
  const pending = new Set(assetIds);
  const skipped = new Set<string>();

  // First pass: identify which assets have active pipelines
  for (const assetId of assetIds) {
    const status = await checkAssetUploadStatus(userId, projectId, assetId);
    if (!status.hasPipeline) {
      // No pipeline - skip this asset (will use local/blob URL)
      pending.delete(assetId);
      skipped.add(assetId);
    } else if (status.uploaded) {
      // Already uploaded
      pending.delete(assetId);
    }
  }

  if (skipped.size > 0) {
    console.log(`[Render] Skipping ${skipped.size} asset(s) without active pipeline`);
  }

  // Wait for remaining assets with active pipelines
  while (pending.size > 0) {
    if (Date.now() - startTime > UPLOAD_TIMEOUT_MS) {
      throw new Error(
        `Timeout waiting for asset uploads. Still pending: ${[...pending].join(", ")}`
      );
    }

    for (const assetId of pending) {
      const status = await checkAssetUploadStatus(userId, projectId, assetId);
      if (status.uploaded || !status.hasPipeline) {
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
async function getAssetSignedUrl(userId: string, projectId: string, assetId: string): Promise<string | null> {
  try {
    const pipelineState = await getPipelineStateFromService(userId, projectId, assetId);
    const uploadStep = pipelineState.steps.find((s) => s.id === "upload" || s.id === "cloud-upload");

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
 * For video clips with masks, also resolves maskAssetId to maskSrc
 */
async function transformClipUrls(
  clip: TimelineClip,
  urlMap: Map<string, string>,
  userId: string,
  projectId: string
): Promise<TimelineClip> {
  if (!("src" in clip) || !clip.assetId) {
    return clip;
  }

  // Transform main asset URL
  const signedUrl = await getAssetSignedUrl(userId, projectId, clip.assetId);
  
  // Handle video clips with masks separately to satisfy TypeScript
  if (clip.type === 'video') {
    let videoClip = signedUrl ? { ...clip, src: signedUrl } : clip;
    if (signedUrl) {
      urlMap.set(clip.assetId, signedUrl);
    }
    
    // Resolve maskAssetId to maskSrc for masked video clips
    if (clip.maskAssetId) {
      const maskSignedUrl = await getAssetSignedUrl(userId, projectId, clip.maskAssetId);
      if (maskSignedUrl) {
        urlMap.set(clip.maskAssetId, maskSignedUrl);
        videoClip = { ...videoClip, maskSrc: maskSignedUrl };
      }
    }
    
    return videoClip;
  }

  // Non-video clips
  if (signedUrl) {
    urlMap.set(clip.assetId, signedUrl);
    return { ...clip, src: signedUrl };
  }

  return clip;
}

/**
 * Build transcriptions from pipeline metadata for assets used in the project.
 * This fetches transcription data at runtime rather than relying on project.transcriptions.
 */
async function buildTranscriptionsFromPipeline(
  project: Project,
  userId: string,
  projectId: string,
  assetUrlMap: Map<string, string>
): Promise<Record<string, ProjectTranscription>> {
  // Collect unique assetIds from all clips
  const assetIds = new Set<string>();
  for (const layer of project.layers) {
    for (const clip of layer.clips) {
      if ("assetId" in clip && clip.assetId) {
        assetIds.add(clip.assetId);
      }
    }
  }

  const transcriptions: Record<string, ProjectTranscription> = {};

  // Fetch transcription data from pipeline for each asset
  await Promise.all(
    Array.from(assetIds).map(async (assetId) => {
      try {
        const pipelineState = await getPipelineStateFromService(userId, projectId, assetId);
        const transcriptionStep = pipelineState.steps.find(
          (s) => s.id === "transcription" && s.status === "succeeded"
        );

        if (!transcriptionStep?.metadata) return;

        const { segments } = transcriptionStep.metadata as {
          segments?: Array<{ start: number; speech: string }>;
        };

        if (!segments || segments.length === 0) return;

        // Use signed URL if available, otherwise construct a placeholder
        const assetUrl = assetUrlMap.get(assetId) || "";

        transcriptions[assetId] = {
          assetId,
          assetName: assetId,
          assetUrl,
          segments,
          languageCodes: [],
          status: "completed",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        // Asset may not have a pipeline or transcription - that's OK
        console.log(`[Render] No transcription for asset ${assetId}:`, error instanceof Error ? error.message : "unknown");
      }
    })
  );

  return transcriptions;
}

/**
 * Transform project to use signed GCS URLs for all assets
 * Also builds transcriptions from pipeline data at runtime
 */
async function transformProjectForRenderer(project: Project, userId: string, projectId: string): Promise<Project> {
  // Map to track assetId -> signedUrl for transcription updates
  const assetUrlMap = new Map<string, string>();

  const transformedLayers = await Promise.all(
    project.layers.map(async (layer) => ({
      ...layer,
      clips: await Promise.all(
        layer.clips.map((clip) => transformClipUrls(clip, assetUrlMap, userId, projectId))
      ),
    }))
  );

  // Build transcriptions from pipeline data at runtime (not from project.transcriptions)
  const transcriptions = await buildTranscriptionsFromPipeline(project, userId, projectId, assetUrlMap);

  return {
    ...project,
    layers: transformedLayers,
    transcriptions,
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
    if (!isAssetServiceEnabled()) {
      return NextResponse.json({ error: "Asset service not configured" }, { status: 503 });
    }

    const userId = await verifyToken(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as RenderRequest;
    const { project, projectId, output } = body;

    if (!project || !projectId) {
      return NextResponse.json(
        { error: "Missing project or projectId" },
        { status: 400 }
      );
    }

    const cost = getCreditsForAction("render");
    try {
      await deductCredits(userId, cost, "render");
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

    // Wait for assets that are still uploading (blob: URLs)
    const pendingAssetIds = collectPendingAssetIds(project);
    if (pendingAssetIds.length > 0) {
      console.log(`[Render] Waiting for ${pendingAssetIds.length} asset(s) to upload...`);
      await waitForAssetUploads(userId, projectId, pendingAssetIds);
      console.log("[Render] All pending assets uploaded to GCS");
    }

    // Transform project to use signed GCS URLs
    const transformedProject = await transformProjectForRenderer(project, userId, projectId);

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
