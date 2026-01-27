import { NextRequest, NextResponse } from "next/server";
import { createV4SignedUrl } from "@/app/lib/server/gcs-signed-url";

const RENDERER_API_URL = process.env.RENDERER_API_URL || "http://localhost:4000";
const GCS_BUCKET = process.env.ASSET_GCS_BUCKET;

interface RendererJobStatus {
  state: "waiting" | "active" | "completed" | "failed";
  progress: number;
  attemptsMade: number;
  failedReason?: string;
  returnValue?: {
    outputPath: string;
    gcsPath?: string;
  };
  processedOn?: number;
  finishedOn?: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    // Proxy to renderer API
    const rendererResponse = await fetch(`${RENDERER_API_URL}/jobs/${jobId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!rendererResponse.ok) {
      if (rendererResponse.status === 404) {
        return NextResponse.json(
          { error: "Job not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: `Renderer error: ${rendererResponse.status}` },
        { status: 502 }
      );
    }

    const jobStatus = (await rendererResponse.json()) as RendererJobStatus;

    // If completed and has GCS path, generate download URL
    let downloadUrl: string | undefined;
    if (jobStatus.state === "completed" && jobStatus.returnValue?.gcsPath && GCS_BUCKET) {
      // Extract object name from gcsPath (format: gs://bucket/path)
      const gcsMatch = jobStatus.returnValue.gcsPath.match(/^gs:\/\/[^/]+\/(.+)$/);
      if (gcsMatch) {
        const objectName = gcsMatch[1];
        downloadUrl = createV4SignedUrl({
          bucket: GCS_BUCKET,
          objectName,
          expiresInSeconds: 60 * 60 * 24 * 7, // 7 days
        });
      }
    }

    return NextResponse.json({
      jobId,
      state: jobStatus.state,
      progress: jobStatus.progress,
      failedReason: jobStatus.failedReason,
      downloadUrl,
      processedOn: jobStatus.processedOn,
      finishedOn: jobStatus.finishedOn,
    });
  } catch (error) {
    console.error("Job status API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
