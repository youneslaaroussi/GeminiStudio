import { promises as fs } from "fs";
import path from "path";
import type { PipelineStepDefinition } from "../types";
import { getGoogleAccessToken } from "@/app/lib/server/google-cloud";
import { UPLOAD_DIR } from "@/app/lib/server/asset-storage";


async function uploadBufferToBucket(
  token: string,
  bucket: string,
  destination: string,
  buffer: Buffer,
  mimeType: string
) {
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o` +
    `?uploadType=media&name=${encodeURIComponent(destination)}&predefinedAcl=publicRead`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType || "application/octet-stream",
      "Content-Length": buffer.byteLength.toString(),
    },
    body: buffer,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload to Cloud Storage: ${text}`);
  }
  const payload = (await response.json()) as { name: string };
  return payload.name;
}

export const uploadStep: PipelineStepDefinition = {
  id: "cloud-upload",
  label: "Upload to Cloud Storage",
  description: "Copies the original asset into the configured GCS bucket.",
  autoStart: true,
  run: async ({ asset }) => {
    const BUCKET = process.env.ASSET_GCS_BUCKET;
    const PUBLIC_BASE_URL =
      process.env.ASSET_PUBLIC_BASE_URL ||
      (BUCKET ? `https://storage.googleapis.com/${BUCKET}` : undefined);

    if (!BUCKET || !PUBLIC_BASE_URL) {
      throw new Error("ASSET_GCS_BUCKET and ASSET_PUBLIC_BASE_URL must be configured");
    }

    const token = await getGoogleAccessToken("https://www.googleapis.com/auth/devstorage.full_control");
    const assetPath = path.join(UPLOAD_DIR, asset.fileName);
    const buffer = await fs.readFile(assetPath);
    const objectName = `assets/${asset.id}/${asset.fileName}`;
    const storedName = await uploadBufferToBucket(token, BUCKET, objectName, buffer, asset.mimeType);
    const gcsUri = `gs://${BUCKET}/${storedName}`;
    const publicUrl = `${PUBLIC_BASE_URL.replace(/\/$/, "")}/${storedName}`;

    return {
      status: "succeeded" as const,
      metadata: {
        gcsUri,
        publicUrl,
        bucket: BUCKET,
        objectName: storedName,
      },
    };
  },
};
