import { NextRequest, NextResponse } from "next/server";
import { getPipelineStateForAsset } from "@/app/lib/server/pipeline/store";
import { runPipelineStepForAsset } from "@/app/lib/server/pipeline/runner";

export async function GET(
  _request: NextRequest,
  { params }: { params: { assetId: string } }
) {
  const pipeline = await getPipelineStateForAsset(params.assetId);
  return NextResponse.json({ pipeline });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { assetId: string } }
) {
  const { stepId, paramOverrides } = (await request.json()) as {
    stepId?: string;
    paramOverrides?: Record<string, unknown>;
  };

  if (!stepId) {
    return NextResponse.json({ error: "stepId is required" }, { status: 400 });
  }

  try {
    const pipeline = await runPipelineStepForAsset(params.assetId, stepId, {
      params: paramOverrides,
    });
    return NextResponse.json({ pipeline });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run pipeline step";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
