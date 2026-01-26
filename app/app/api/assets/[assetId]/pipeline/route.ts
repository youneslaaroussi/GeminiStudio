import { NextRequest, NextResponse } from "next/server";
import { getPipelineStateForAsset } from "@/app/lib/server/pipeline/store";
import { runPipelineStepForAsset } from "@/app/lib/server/pipeline/runner";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await params;
  const pipeline = await getPipelineStateForAsset(assetId);
  return NextResponse.json({ pipeline });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await params;
  const { stepId, paramOverrides } = (await request.json()) as {
    stepId?: string;
    paramOverrides?: Record<string, unknown>;
  };

  if (!stepId) {
    return NextResponse.json({ error: "stepId is required" }, { status: 400 });
  }

  try {
    const pipeline = await runPipelineStepForAsset(assetId, stepId, {
      params: paramOverrides,
    });
    return NextResponse.json({ pipeline });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run pipeline step";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
