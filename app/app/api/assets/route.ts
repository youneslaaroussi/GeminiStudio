import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { AssetType } from "@/app/types/assets";

interface StoredAsset {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

interface AssetResponse extends StoredAsset {
  url: string;
  type: AssetType;
}

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const DATA_DIR = path.join(process.cwd(), ".data");
const MANIFEST_PATH = path.join(DATA_DIR, "assets-manifest.json");

export const runtime = "nodejs";

async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function readManifest(): Promise<StoredAsset[]> {
  try {
    const data = await fs.readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(data) as StoredAsset[];
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeManifest(manifest: StoredAsset[]) {
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
}

function determineAssetType(mimeType: string, fileName: string): AssetType {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";

  const ext = path.extname(fileName).toLowerCase();

  if ([".mp4", ".mov", ".webm", ".mkv"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".aac", ".ogg"].includes(ext)) return "audio";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";

  return "other";
}

function toResponse(asset: StoredAsset): AssetResponse {
  return {
    ...asset,
    url: `/uploads/${asset.fileName}`,
    type: determineAssetType(asset.mimeType, asset.name),
  };
}

export async function GET() {
  await ensureDirs();
  const manifest = await readManifest();

  const existingAssets: AssetResponse[] = [];

  for (const asset of manifest) {
    const filePath = path.join(UPLOAD_DIR, asset.fileName);
    try {
      await fs.stat(filePath);
      existingAssets.push(toResponse(asset));
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        console.error("Error inspecting asset file", error);
      }
    }
  }

  return NextResponse.json({ assets: existingAssets });
}

export async function POST(request: NextRequest) {
  await ensureDirs();
  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const manifest = await readManifest();
  const uploaded: AssetResponse[] = [];

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
    uploaded.push(toResponse(asset));
  }

  await writeManifest(manifest);

  return NextResponse.json({ assets: uploaded }, { status: 201 });
}
