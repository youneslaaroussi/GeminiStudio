import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { AssetType, RemoteAsset } from "@/app/types/assets";

export interface StoredAsset {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const DATA_DIR = path.join(process.cwd(), ".data");
const MANIFEST_PATH = path.join(DATA_DIR, "assets-manifest.json");

export async function ensureAssetStorage() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function readManifest(): Promise<StoredAsset[]> {
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

export async function writeManifest(manifest: StoredAsset[]) {
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
}

export function determineAssetType(mimeType: string, fileName: string): AssetType {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";

  const ext = path.extname(fileName).toLowerCase();

  if ([".mp4", ".mov", ".webm", ".mkv"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".aac", ".ogg"].includes(ext)) return "audio";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";

  return "other";
}

export function storedAssetToRemote(asset: StoredAsset): RemoteAsset {
  return {
    ...asset,
    url: `/uploads/${asset.fileName}`,
    type: determineAssetType(asset.mimeType, asset.name),
  };
}

interface SaveBufferOptions {
  data: Buffer;
  originalName: string;
  mimeType: string;
}

export async function saveBufferAsAsset({ data, originalName, mimeType }: SaveBufferOptions) {
  await ensureAssetStorage();
  const fileExtension = path.extname(originalName) || "";
  const storedName = `${Date.now()}-${crypto.randomUUID()}${fileExtension}`;
  const filePath = path.join(UPLOAD_DIR, storedName);

  await fs.writeFile(filePath, data);

  const storedAsset: StoredAsset = {
    id: crypto.randomUUID(),
    name: originalName,
    fileName: storedName,
    mimeType,
    size: data.byteLength,
    uploadedAt: new Date().toISOString(),
  };

  const manifest = await readManifest();
  manifest.push(storedAsset);
  await writeManifest(manifest);

  return storedAssetToRemote(storedAsset);
}

export async function persistStoredAsset(asset: StoredAsset) {
  const manifest = await readManifest();
  manifest.push(asset);
  await writeManifest(manifest);
}

export { UPLOAD_DIR };
