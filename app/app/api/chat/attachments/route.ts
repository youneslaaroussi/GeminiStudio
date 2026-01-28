import { NextRequest, NextResponse } from "next/server";
import { getMediaCategory, type ChatAttachment } from "@/app/lib/server/gemini";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import {
  uploadToAssetService,
  isAssetServiceEnabled,
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

/**
 * POST /api/chat/attachments
 *
 * Upload files to be attached to chat messages.
 * Files are uploaded to GCS and metadata is returned for inclusion in messages.
 */
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

  try {
    const formData = await request.formData();
    const sessionId = formData.get("sessionId") as string | null;
    const files = formData.getAll("files") as File[];
    const projectId = formData.get("projectId") as string | null;

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
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
      const result = await uploadToAssetService(userId, projectId, file, {
        source: "chat",
        runPipeline: true,
      });

      const asset = result.asset;

      attachments.push({
        id: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
        category: getMediaCategory(asset.mimeType),
        uploadedAt: asset.uploadedAt,
        localUrl: asset.signedUrl || "",
        gcsUri: asset.gcsUri,
        signedUrl: asset.signedUrl,
      });
    }

    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    console.error("Failed to upload chat attachments:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
