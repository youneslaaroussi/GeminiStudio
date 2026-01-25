import { promises as fs } from "fs";
import path from "path";
import { parseFile } from "music-metadata";
import type { PipelineStepDefinition } from "../types";
import { determineAssetType, UPLOAD_DIR } from "@/app/lib/server/asset-storage";

function formatDurationSeconds(duration?: number | null) {
  if (!duration || !Number.isFinite(duration)) return undefined;
  return Number(duration);
}

export const metadataStep: PipelineStepDefinition = {
  id: "metadata",
  label: "Extract metadata",
  description: "Basic mime, size, and duration checks.",
  autoStart: true,
  run: async ({ asset }) => {
    const assetPath = path.join(UPLOAD_DIR, asset.fileName);
    const metadata: Record<string, unknown> = {
      mimeType: asset.mimeType,
      size: asset.size,
      uploadedAt: asset.uploadedAt,
      type: determineAssetType(asset.mimeType, asset.name),
    };

    try {
      const stats = await fs.stat(assetPath);
      metadata.fileSize = stats.size;
      metadata.lastModified = stats.mtime.toISOString();
    } catch {
      // ignore stat errors, rely on stored manifest
    }

    if (asset.mimeType.startsWith("audio/")) {
      try {
        const parsed = await parseFile(assetPath);
        metadata.duration = formatDurationSeconds(parsed.format.duration);
        metadata.sampleRate = parsed.format.sampleRate;
        metadata.bitrate = parsed.format.bitrate;
      } catch (error) {
        metadata.audioMetadataError =
          error instanceof Error ? error.message : "Unable to parse audio metadata";
      }
    }

    return {
      status: "succeeded" as const,
      metadata,
    };
  },
};
