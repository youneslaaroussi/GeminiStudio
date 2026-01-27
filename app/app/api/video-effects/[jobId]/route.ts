import { NextRequest, NextResponse } from "next/server";
import { pollVideoEffectJob } from "@/app/lib/server/video-effects/service";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const job = await pollVideoEffectJob(jobId);
    if (!job) {
      return NextResponse.json(
        { error: "Video effect job not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ job });
  } catch (error) {
    console.error("Failed to poll video effect job", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
