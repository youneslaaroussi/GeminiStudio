import { promises as fs } from "fs";
import path from "path";
import type { PipelineStepDefinition } from "../types";
import { getGoogleAccessToken } from "@/app/lib/server/google-cloud";
import { UPLOAD_DIR } from "@/app/lib/server/asset-storage";
import { createV4SignedUrl } from "@/app/lib/server/gcs-signed-url";


async function uploadBufferToBucket(
  token: string,
  bucket: string,
  destination: string,
  buffer: Buffer,
  mimeType: string
) {
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o` +
    `?uploadType=media&name=${encodeURIComponent(destination)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": mimeType || "application/octet-stream",
      "Content-Length": buffer.byteLength.toString(),
    },
    body: buffer as BodyInit,
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
    const signedUrlTtl = Number(process.env.ASSET_SIGNED_URL_TTL_SECONDS ?? 60 * 60 * 24 * 7);
    if (!BUCKET) {
      throw new Error("ASSET_GCS_BUCKET must be configured");
    }

    const token = await getGoogleAccessToken("https://www.googleapis.com/auth/devstorage.full_control");
    const assetPath = path.join(UPLOAD_DIR, asset.fileName);
    const buffer = await fs.readFile(assetPath);
    const objectName = `assets/${asset.id}/${asset.fileName}`;
    const storedName = await uploadBufferToBucket(token, BUCKET, objectName, buffer, asset.mimeType);
    const gcsUri = `gs://${BUCKET}/${storedName}`;
    const signedUrl = createV4SignedUrl({
      bucket: BUCKET,
      objectName: storedName,
      expiresInSeconds: Number.isFinite(signedUrlTtl) ? signedUrlTtl : 60 * 60 * 24 * 7,
    });

    return {
      status: "succeeded" as const,
      metadata: {
        gcsUri,
        signedUrl,
        bucket: BUCKET,
        objectName: storedName,
      },
    };
  },
};
