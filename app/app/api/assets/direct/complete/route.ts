import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { verifyBearerToken } from "@/app/lib/server/auth";
import {
  isAssetServiceEnabled,
  registerGcsAssetOnService,
  type TranscodeOptions,
} from "@/app/lib/server/asset-service-client";
import { toRemoteAsset } from "../../utils";
import { isHeicFile, isVideoFile } from "@/app/lib/uploads/file-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CompleteUploadEntry {
  id: string;
  gcsUri: string;
  fileName: string;
  mimeType: string;
  size: number;
  transcodeOptions?: TranscodeOptions;
}

function parseGcsUri(uri: string) {
  const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    return null;
  }
  return { bucket: match[1], objectName: match[2] };
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
    uploads?: CompleteUploadEntry[];
    creditsUsed?: number;
    source?: string;
    runPipeline?: boolean;
    threadId?: string | null;
  };

  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.projectId || typeof body.projectId !== "string") {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  if (!Array.isArray(body.uploads) || body.uploads.length === 0) {
    return NextResponse.json({ error: "uploads array is required" }, { status: 400 });
  }

  const bucket = process.env.ASSET_GCS_BUCKET;
  if (!bucket) {
    console.error("ASSET_GCS_BUCKET is not configured");
    return NextResponse.json(
      { error: "Asset storage bucket not configured" },
      { status: 500 }
    );
  }

  const source = body.source ?? "web";
  const runPipeline = body.runPipeline !== false;

  const convertStarted = body.uploads.some((upload) =>
    isHeicFile(upload.mimeType, upload.fileName)
  );

  try {
    const uploadedAssets = [];
    let transcodeStarted = false;

    for (const upload of body.uploads) {
      const parsed = parseGcsUri(upload.gcsUri);
      if (!parsed || parsed.bucket !== bucket) {
        return NextResponse.json(
          { error: `Invalid gcsUri for upload ${upload.id}` },
          { status: 400 }
        );
      }
      const expectedPrefix = `${userId}/${body.projectId}/`;
      if (!parsed.objectName.startsWith(expectedPrefix)) {
        return NextResponse.json(
          { error: `gcsUri does not belong to the requesting user/project for upload ${upload.id}` },
          { status: 400 }
        );
      }

      const videoFile = isVideoFile(upload.mimeType, upload.fileName);
      const payload: TranscodeOptions | undefined = videoFile ? upload.transcodeOptions : undefined;

      const result = await registerGcsAssetOnService(userId, body.projectId, {
        gcsUri: upload.gcsUri,
        name: upload.fileName,
        source,
        runPipeline,
        threadId: body.threadId,
        transcodeOptions: payload,
      });

      uploadedAssets.push(toRemoteAsset(result.asset, body.projectId));
      if (result.transcodeStarted) {
        transcodeStarted = true;
      }
    }

    const response = NextResponse.json(
      {
        assets: uploadedAssets,
        creditsUsed: body.creditsUsed ?? 0,
        transcodeStarted,
        convertStarted,
      },
      { status: 201 }
    );
    revalidateTag("assets", "max");
    return response;
  } catch (error) {
    console.error("Failed to register uploaded assets:", error);
    return NextResponse.json(
      { error: "Failed to register uploads" },
      { status: 500 }
    );
  }
}
