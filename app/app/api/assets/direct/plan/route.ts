import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { verifyBearerToken } from "@/app/lib/server/auth";
import { isAssetServiceEnabled } from "@/app/lib/server/asset-service-client";
import { createV4SignedUrl } from "@/app/lib/server/gcs-signed-url";
import { sanitizeObjectNameSegment } from "@/app/lib/uploads/file-utils";
import {
  calculateTotalCredits,
  verifyAndDeductCredits,
  CreditsError,
} from "../../credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DirectUploadFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export async function POST(request: NextRequest) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json(
      { error: "Asset service not configured. Set ASSET_SERVICE_URL." },
      { status: 503 }
    );
  }

  const userId = await verifyBearerToken(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized. Include Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  let body: {
    projectId?: string;
    files?: DirectUploadFile[];
  };

  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.projectId || typeof body.projectId !== "string") {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  if (!Array.isArray(body.files) || body.files.length === 0) {
    return NextResponse.json({ error: "At least one file is required" }, { status: 400 });
  }

  const bucket = process.env.ASSET_GCS_BUCKET;
  if (!bucket) {
    console.error("ASSET_GCS_BUCKET is not configured");
    return NextResponse.json(
      { error: "Asset storage bucket not configured" },
      { status: 500 }
    );
  }

  const totalCreditsNeeded = calculateTotalCredits(
    body.files.map((file) => ({ mimeType: file.mimeType || "" }))
  );

  try {
    await verifyAndDeductCredits(userId, totalCreditsNeeded);
  } catch (error) {
    if (error instanceof CreditsError) {
      return NextResponse.json(error.responseBody, { status: error.status });
    }
    throw error;
  }

  const uploads = body.files.map((file) => {
    const uploadId = randomUUID();
    const fileName = file.name || `upload-${uploadId}`;
    const safeName = sanitizeObjectNameSegment(fileName);
    const objectName = `${userId}/${body.projectId}/uploads/${uploadId}/${safeName}`;
    const uploadUrl = createV4SignedUrl({
      bucket,
      objectName,
      method: "PUT",
      expiresInSeconds: 60 * 60, // 1 hour
    });
    const gcsUri = `gs://${bucket}/${objectName}`;
    return {
      id: file.id,
      uploadId,
      fileName,
      mimeType: file.mimeType,
      size: file.size,
      uploadUrl,
      gcsUri,
      objectName,
    };
  });

  return NextResponse.json(
    {
      uploads,
      creditsUsed: totalCreditsNeeded,
    },
    { status: 201 }
  );
}
