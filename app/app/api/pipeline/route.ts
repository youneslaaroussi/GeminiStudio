/**
 * Pipeline API route for listing all pipeline states in a project.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import {
  isAssetServiceEnabled,
  listPipelineStatesFromService,
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

export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  try {
    const states = await listPipelineStatesFromService(userId, projectId);
    return NextResponse.json({ states });
  } catch (error) {
    console.error("Failed to list pipeline states:", error);
    return NextResponse.json(
      { error: "Failed to list pipeline states" },
      { status: 500 }
    );
  }
}
