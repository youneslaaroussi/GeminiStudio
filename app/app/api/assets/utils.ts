import type { RemoteAsset } from "@/app/types/assets";
import type { AssetServiceAsset } from "@/app/lib/server/asset-service-client";
import type { ComponentInputDef } from "@/app/types/assets";

export function toRemoteAsset(asset: AssetServiceAsset, projectId: string): RemoteAsset {
  const url = asset.signedUrl ?? "";

  const result: RemoteAsset = {
    id: asset.id,
    name: asset.name,
    url,
    mimeType: asset.mimeType,
    size: asset.size,
    type: asset.type as RemoteAsset["type"],
    uploadedAt: asset.uploadedAt,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    gcsUri: asset.gcsUri,
    signedUrl: asset.signedUrl,
    description: asset.description,
    notes: asset.notes,
    transcodeStatus: asset.transcodeStatus as RemoteAsset["transcodeStatus"],
    transcodeError: asset.transcodeError,
  };

  if (asset.code !== undefined) result.code = asset.code;
  if (asset.componentName !== undefined) result.componentName = asset.componentName;
  if (asset.inputDefs !== undefined) result.inputDefs = asset.inputDefs as ComponentInputDef[];

  return result;
}
