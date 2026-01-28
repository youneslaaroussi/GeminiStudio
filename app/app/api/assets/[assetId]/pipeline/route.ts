/**
 * Pipeline API route for managing asset pipeline state and triggering steps.
 *
 * GET - Get pipeline state for an asset
 * POST - Trigger a pipeline step (queued for background processing)
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";
import { initAdmin } from "@/app/lib/server/firebase-admin";
import {
  isAssetServiceEnabled,
  getPipelineStateFromService,
  runPipelineStepOnService,
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
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

  const { assetId } = await params;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  try {
    const state = await getPipelineStateFromService(userId, projectId, assetId);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Failed to get pipeline state:", error);
    return NextResponse.json(
      { error: "Failed to get pipeline state" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
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

  const { assetId } = await params;
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 }
    );
  }

  let body: { stepId?: string; params?: Record<string, unknown> } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { stepId, params: stepParams } = body;

  if (!stepId) {
    return NextResponse.json(
      { error: "stepId is required" },
      { status: 400 }
    );
  }

  try {
    const result = await runPipelineStepOnService(
      userId,
      projectId,
      assetId,
      stepId,
      stepParams || {}
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error("Failed to run pipeline step:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run pipeline step" },
      { status: 500 }
    );
  }
}
