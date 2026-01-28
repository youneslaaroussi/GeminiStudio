import { NextRequest, NextResponse } from "next/server";
import { pollVeoJob } from "@/app/lib/server/veo-service";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const job = await pollVeoJob(jobId);
    if (!job) {
      return NextResponse.json(
        { error: "VEO job not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ job });
  } catch (error) {
    console.error("Failed to poll VEO job", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
