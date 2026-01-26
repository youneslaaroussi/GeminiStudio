import { NextRequest, NextResponse } from "next/server";
import { pollVideoEffectJob } from "@/app/lib/server/video-effects/service";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const job = await pollVideoEffectJob(params.jobId);
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
