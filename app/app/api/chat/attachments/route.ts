import { NextRequest, NextResponse } from "next/server";
import { getMediaCategory, type ChatAttachment } from "@/app/lib/server/gemini";
import { saveBufferAsAsset } from "@/app/lib/server/asset-storage";
import {
  runPipelineStepForAsset,
  runAutoStepsForAsset,
} from "@/app/lib/server/pipeline/runner";

export const runtime = "nodejs";

/**
 * POST /api/chat/attachments
 *
 * Upload files to be attached to chat messages.
 * Files are uploaded to GCS and metadata is returned for inclusion in messages.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const sessionId = formData.get("sessionId") as string | null;
    const files = formData.getAll("files") as File[];
    const projectId = formData.get("projectId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "At least one file is required" },
        { status: 400 }
      );
    }

    const attachments: ChatAttachment[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const mimeType = file.type || "application/octet-stream";

      const asset = await saveBufferAsAsset({
        data: buffer,
        originalName: file.name,
        mimeType,
        projectId:
          typeof projectId === "string" && projectId.trim().length > 0
            ? projectId
            : undefined,
      });

      const pipelineState = await runPipelineStepForAsset(
        asset.id,
        "cloud-upload",
        { params: { sessionId } }
      );

      void runAutoStepsForAsset(asset.id).catch((error) => {
        console.error(`Pipeline failed for asset ${asset.id}:`, error);
      });

      const uploadStep = pipelineState.steps.find(
        (step) => step.id === "cloud-upload"
      );
      const metadata = uploadStep?.metadata ?? {};
      const gcsUri =
        typeof metadata?.gcsUri === "string" ? metadata.gcsUri : undefined;
      const signedUrl =
        typeof metadata?.signedUrl === "string" ? metadata.signedUrl : undefined;

      attachments.push({
        id: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
        category: getMediaCategory(asset.mimeType),
        uploadedAt: asset.uploadedAt,
        localUrl: asset.url,
        gcsUri,
        signedUrl,
      });
    }

    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    console.error("Failed to upload chat attachments:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
