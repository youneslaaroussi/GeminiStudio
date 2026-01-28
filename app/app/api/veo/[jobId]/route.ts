import { NextRequest, NextResponse } from "next/server";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { pollVeoJob } from "@/app/lib/server/veo-service";
import { isAssetServiceEnabled } from "@/app/lib/server/asset-service-client";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json({ error: "Asset service not configured" }, { status: 503 });
  }

  const userId = await verifyToken(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
