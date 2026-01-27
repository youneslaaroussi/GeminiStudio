import { NextRequest, NextResponse } from "next/server";
import { createV4SignedUrl } from "@/app/lib/server/gcs-signed-url";

const GCS_BUCKET = process.env.ASSET_GCS_BUCKET;

export async function POST(request: NextRequest) {
  try {
    const { gcsPath } = (await request.json()) as { gcsPath: string };

    if (!gcsPath) {
      return NextResponse.json(
        { error: "Missing gcsPath" },
        { status: 400 }
      );
    }

    if (!GCS_BUCKET) {
      return NextResponse.json(
        { error: "GCS bucket not configured" },
        { status: 500 }
      );
    }

    // Extract object name from gcsPath (format: gs://bucket/path)
    const gcsMatch = gcsPath.match(/^gs:\/\/[^/]+\/(.+)$/);
    if (!gcsMatch) {
      return NextResponse.json(
        { error: "Invalid GCS path format" },
        { status: 400 }
      );
    }

    const objectName = gcsMatch[1];
    const downloadUrl = createV4SignedUrl({
      bucket: GCS_BUCKET,
      objectName,
      expiresInSeconds: 60 * 60 * 24 * 7, // 7 days
    });

    return NextResponse.json({ downloadUrl });
  } catch (error) {
    console.error("Download URL API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
