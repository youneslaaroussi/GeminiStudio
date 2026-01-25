import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { RemoteAsset } from "@/app/types/assets";
import {
  ensureAssetStorage,
  readManifest,
  writeManifest,
  storedAssetToRemote,
  type StoredAsset,
  UPLOAD_DIR,
} from "@/app/lib/server/asset-storage";
import { runAutoStepsForAsset } from "@/app/lib/server/pipeline/runner";

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export const runtime = "nodejs";

export async function GET() {
  await ensureAssetStorage();
  const manifest = await readManifest();
  const existingAssets: RemoteAsset[] = [];

  for (const asset of manifest) {
    const filePath = path.join(UPLOAD_DIR, asset.fileName);
    try {
      await fs.stat(filePath);
      existingAssets.push(storedAssetToRemote(asset));
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        console.error("Error inspecting asset file", error);
      }
    }
  }

  return NextResponse.json({ assets: existingAssets });
}

export async function POST(request: NextRequest) {
  await ensureAssetStorage();
  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const manifest = await readManifest();
  const uploaded: RemoteAsset[] = [];

  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileExtension = path.extname(file.name) || "";
    const storedName = `${Date.now()}-${crypto.randomUUID()}${fileExtension}`;
    const filePath = path.join(UPLOAD_DIR, storedName);

    await fs.writeFile(filePath, buffer);

    const asset: StoredAsset = {
      id: crypto.randomUUID(),
      name: file.name,
      fileName: storedName,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      uploadedAt: new Date().toISOString(),
    };

    manifest.push(asset);
    uploaded.push(storedAssetToRemote(asset));

    await runAutoStepsForAsset(asset.id);
  }

  await writeManifest(manifest);

  return NextResponse.json({ assets: uploaded }, { status: 201 });
}
