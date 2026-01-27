import { NextRequest, NextResponse } from "next/server";
import { prepareAttachment, type ChatAttachment } from "@/app/lib/server/gemini";

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

      const { attachment } = await prepareAttachment({
        data: buffer,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        sessionId,
        config: {
          uploadToGcs: true,
          generateSignedUrls: true,
        },
      });

      attachments.push(attachment);
    }

    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    console.error("Failed to upload chat attachments:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
