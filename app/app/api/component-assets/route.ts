import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import type { RemoteAsset, ComponentInputDef } from "@/app/types/assets";
import {
  isAssetServiceEnabled,
  createComponentAssetOnService,
  type AssetServiceAsset,
} from "@/app/lib/server/asset-service-client";
import { verifyBearerToken } from "@/app/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toRemoteAsset(asset: AssetServiceAsset): RemoteAsset {
  return {
    id: asset.id,
    name: asset.name,
    url: "",
    mimeType: asset.mimeType ?? "text/typescript",
    size: asset.size ?? 0,
    type: "component",
    uploadedAt: asset.uploadedAt,
    code: asset.code,
    componentName: asset.componentName,
    inputDefs: asset.inputDefs as ComponentInputDef[] | undefined,
  };
}

export async function POST(request: NextRequest) {
  if (!isAssetServiceEnabled()) {
    return NextResponse.json(
      { error: "Asset service not configured. Set ASSET_SERVICE_URL." },
      { status: 503 }
    );
  }

  const userId = await verifyBearerToken(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized. Include Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  let body: {
    projectId: string;
    name: string;
    code: string;
    componentName: string;
    inputDefs?: Array<{ name: string; type: string; default: string | number | boolean; label?: string }>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.projectId || !body.name || !body.code || !body.componentName) {
    return NextResponse.json(
      { error: "projectId, name, code, and componentName are required" },
      { status: 400 }
    );
  }

  try {
    const result = await createComponentAssetOnService(userId, body.projectId, {
      name: body.name,
      code: body.code,
      componentName: body.componentName,
      inputDefs: body.inputDefs,
    });

    revalidateTag("assets", "max");
    return NextResponse.json({ asset: toRemoteAsset(result) }, { status: 201 });
  } catch (error) {
    console.error("Failed to create component asset:", error);
    return NextResponse.json(
      { error: "Failed to create component asset" },
      { status: 500 }
    );
  }
}
