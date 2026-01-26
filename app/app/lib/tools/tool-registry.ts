import { z } from "zod";
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolRuntimeContext,
} from "./types";
import { useToolboxStore } from "@/app/lib/store/toolbox-store";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import type { AssetMetadata } from "@/app/lib/store/assets-store";
import type { Project } from "@/app/types/timeline";
import type { RemoteAsset } from "@/app/types/assets";
import { Input, UrlSource, CanvasSink, ALL_FORMATS } from "mediabunny";

type RegistryMap = Map<string, ToolDefinition<z.ZodTypeAny, Project>>;

class ToolRegistry {
  private tools: RegistryMap = new Map();

  register(tool: ToolDefinition<z.ZodTypeAny, Project>) {
    this.tools.set(tool.name, tool);
  }

  list() {
    return Array.from(this.tools.values());
  }

  get(name: string) {
    return this.tools.get(name);
  }
}

export const toolRegistry = new ToolRegistry();

type ToolInput = Record<string, unknown>;

export interface ExecuteToolOptions {
  toolName: string;
  input: ToolInput;
  context: ToolRuntimeContext<Project>;
}

export async function executeTool({
  toolName,
  input,
  context,
}: ExecuteToolOptions): Promise<ToolExecutionResult> {
  const tool = toolRegistry.get(toolName);
  if (!tool) {
    return {
      status: "error",
      error: `Tool ${toolName} not found`,
    };
  }

  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      error: "Invalid tool inputs",
      details: parsed.error.flatten(),
    };
  }

  try {
    return await tool.run(parsed.data, context);
  } catch (error) {
    console.error(`Tool ${toolName} failed`, error);
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function loadAssetsSnapshot(): Promise<RemoteAsset[]> {
  if (typeof window === "undefined") {
    const { ensureAssetStorage, readManifest, storedAssetToRemote } = await import(
      "@/app/lib/server/asset-storage"
    );
    await ensureAssetStorage();
    const manifest = await readManifest();
    return manifest.map((asset) => storedAssetToRemote(asset));
  }
  const assetsStore = useAssetsStore.getState();
  if (assetsStore.assets.length > 0) {
    return assetsStore.assets;
  }
  try {
    const response = await fetch("/api/assets");
    if (!response.ok) throw new Error("Failed to fetch assets");
    const data = (await response.json()) as { assets: RemoteAsset[] };
    assetsStore.setAssets(data.assets ?? []);
    return useAssetsStore.getState().assets;
  } catch (error) {
    console.error("Failed to load assets", error);
    return [];
  }
}

function formatAssetSummary(
  asset: RemoteAsset,
  metadata?: AssetMetadata | null
) {
  const mb = asset.size / 1024 / 1024;
  const parts = [
    asset.name,
    asset.type.toUpperCase(),
    `${mb.toFixed(mb > 1 ? 2 : 1)} MB`,
  ];
  if (metadata?.duration && metadata.duration > 0) {
    parts.push(`${metadata.duration.toFixed(2)}s`);
  }
  if (
    metadata?.width &&
    metadata?.width > 0 &&
    metadata?.height &&
    metadata.height > 0
  ) {
    parts.push(`${metadata.width}x${metadata.height}`);
  }
  return parts.join(" • ");
}

function toAbsoluteAssetUrl(url: string) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (typeof window === "undefined" || !window.location) {
    throw new Error("Cannot resolve asset URL outside the browser runtime.");
  }
  return new URL(url, window.location.origin).toString();
}

async function canvasToPngDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas) {
  if ("toDataURL" in canvas) {
    return (canvas as HTMLCanvasElement).toDataURL("image/png");
  }
  if ("convertToBlob" in canvas) {
    const blob = await (canvas as OffscreenCanvas).convertToBlob({
      type: "image/png",
    });
    return blobToDataUrl(blob);
  }
  throw new Error("Unsupported canvas implementation for capture output.");
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read captured frame data."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read captured frame data."));
    reader.readAsDataURL(blob);
  });
}

async function captureVideoFrame(asset: RemoteAsset, timecode: number) {
  const absoluteUrl = toAbsoluteAssetUrl(asset.url);
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(absoluteUrl),
  });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error("No video track found in this asset.");
    }
    if (!(await videoTrack.canDecode())) {
      throw new Error("This browser cannot decode the selected video asset.");
    }
    const canvasSink = new CanvasSink(videoTrack, { poolSize: 1 });
    const frame = await canvasSink.getCanvas(timecode);
    if (!frame) {
      throw new Error("No frame exists at the requested timestamp.");
    }
    const url = await canvasToPngDataUrl(frame.canvas);
    return {
      url,
      width: frame.canvas.width,
      height: frame.canvas.height,
    };
  } finally {
    input.dispose();
  }
}

async function loadImageDimensions(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Failed to load image asset for capture."));
    image.src = url;
  });
}

async function buildImagePreview(asset: RemoteAsset) {
  const absoluteUrl = toAbsoluteAssetUrl(asset.url);
  const metadata = useAssetsStore.getState().metadata[asset.id] ?? null;
  if (
    metadata?.width &&
    metadata.width > 0 &&
    metadata?.height &&
    metadata.height > 0
  ) {
    return {
      url: absoluteUrl,
      width: metadata.width,
      height: metadata.height,
    };
  }
  const dimensions = await loadImageDimensions(absoluteUrl);
  return {
    url: absoluteUrl,
    width: dimensions.width,
    height: dimensions.height,
  };
}

async function buildAssetPreview(asset: RemoteAsset, timecode: number) {
  if (asset.type === "image") {
    return buildImagePreview(asset);
  }
  return captureVideoFrame(asset, timecode);
}

const captureAssetSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  timecode: z.number().min(0, "Time must be positive"),
  notes: z.string().optional(),
});

toolRegistry.register({
  name: "captureAsset",
  label: "Capture Asset",
  description:
    "Bookmark a timeline moment for an uploaded asset using its asset ID and capture an exact still.",
  runLocation: "client",
  inputSchema: captureAssetSchema,
  fields: [
    {
      name: "assetId",
      label: "Asset ID",
      type: "text",
      placeholder: "e.g. asset_123",
      required: true,
    },
    {
      name: "timecode",
      label: "Time (seconds)",
      type: "number",
      placeholder: "12.4",
      description: "Exact timeline position in seconds.",
      required: true,
    },
    {
      name: "notes",
      label: "Notes",
      type: "textarea",
      placeholder: "Optional context for the captured asset.",
    },
  ],
  async run(input) {
    const assets = await loadAssetsSnapshot();
    const matchedAsset = assets.find((asset) => asset.id === input.assetId.trim());

    if (!matchedAsset) {
      return {
        status: "error",
        error: `Asset ID "${input.assetId}" not found in the current project.`,
      };
    }

    if (matchedAsset.type !== "video" && matchedAsset.type !== "image") {
      return {
        status: "error",
        error: `Asset "${matchedAsset.name}" is a ${matchedAsset.type} file. Only video or image assets can be captured.`,
      };
    }

    const preview = await buildAssetPreview(matchedAsset, input.timecode);

    const store = useToolboxStore.getState();
    const asset = store.addCapturedAsset({
      name: matchedAsset.name,
      assetId: matchedAsset.id,
      assetType: matchedAsset.type,
      assetUrl: matchedAsset.url,
      timecode: input.timecode,
      notes: input.notes,
    });
    return {
      status: "success",
      outputs: [
        {
          type: "image",
          url: preview.url,
          alt: `Captured ${matchedAsset.name} at ${input.timecode.toFixed(2)}s`,
          width: preview.width,
          height: preview.height,
        },
        {
          type: "text",
          text: `Captured asset "${asset.name}" (${asset.assetType}) at ${asset.timecode.toFixed(
            2
          )}s.`,
        },
        {
          type: "json",
          data: asset,
        },
      ],
    };
  },
});

const listAssetsSchema = z.object({});

toolRegistry.register({
  name: "listAssets",
  label: "List Assets",
  description: "Return the uploaded assets currently available in the Assets panel.",
  runLocation: "server",
  inputSchema: listAssetsSchema,
  fields: [],
  async run() {
    const assets = await loadAssetsSnapshot();
    const metadataMap = useAssetsStore.getState().metadata;
    const enriched = assets.map((asset) => ({
      ...asset,
      metadata: metadataMap[asset.id] ?? null,
    }));
    return {
      status: "success",
      outputs: [
        {
          type: "list",
          title: `${assets.length} assets`,
          items:
            enriched.length > 0
              ? enriched.map((asset) => ({
                  type: "text",
                  text: formatAssetSummary(asset, asset.metadata ?? undefined),
                }))
              : [
                  {
                    type: "text",
                    text: "No uploaded assets found.",
                  },
                ],
        },
        {
          type: "json",
          data: enriched,
        },
      ],
    };
  },
});
