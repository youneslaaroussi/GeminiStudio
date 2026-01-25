import { NextResponse } from "next/server";
import { getAllPipelineStates } from "@/app/lib/server/pipeline/store";

export async function GET() {
  const pipelines = await getAllPipelineStates();
  return NextResponse.json({ pipelines });
}
