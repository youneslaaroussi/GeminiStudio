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

const captureAssetSchema = z.object({
  assetName: z.string().min(2, "Asset name is required"),
  timecode: z.number().min(0, "Time must be positive"),
  notes: z.string().optional(),
});

toolRegistry.register({
  name: "captureAsset",
  label: "Capture Asset",
  description: "Bookmark a timeline moment for an uploaded asset from the Assets panel.",
  inputSchema: captureAssetSchema,
  fields: [
    {
      name: "assetName",
      label: "Asset Name",
      type: "text",
      placeholder: "e.g. Intro Logo Reveal",
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
    const matchedAsset = assets.find(
      (asset) => asset.name.trim().toLowerCase() === input.assetName.trim().toLowerCase()
    );

    if (!matchedAsset) {
      return {
        status: "error",
        error: `Asset "${input.assetName}" not found in the current project.`,
      };
    }

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

const getAssetsSchema = z.object({});

toolRegistry.register({
  name: "getAssets",
  label: "List Uploaded Assets",
  description: "Return the uploaded assets currently available in the Assets panel.",
  inputSchema: getAssetsSchema,
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

const timelineSummarySchema = z.object({
  includeLayers: z.boolean().default(true),
});

toolRegistry.register({
  name: "summarizeTimeline",
  label: "Summarize Timeline",
  description: "Generate a structured description of the current project timeline layout.",
  inputSchema: timelineSummarySchema,
  fields: [
    {
      name: "includeLayers",
      label: "Include layer breakdown",
      type: "select",
      options: [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ],
      defaultValue: "true",
    },
  ],
  async run(input, context) {
    const project = context.project;
    if (!project) {
      return {
        status: "error",
        error: "Project state unavailable",
      };
    }

    const layers = input.includeLayers ? project.layers : [];
    return {
      status: "success",
      outputs: [
        {
          type: "text",
          text: `Project "${project.name}" at ${project.fps}fps, ${project.resolution.width}x${project.resolution.height}.`,
        },
        {
          type: "json",
          data: {
            layers: layers.map((layer) => ({
              id: layer.id,
              name: layer.name,
              type: layer.type,
              clips: layer.clips.length,
            })),
            totalLayers: project.layers.length,
          },
        },
      ],
    };
  },
});

const storyboardSchema = z.object({
  prompt: z.string().min(5, "Describe the storyboard frame"),
  aspectRatio: z.enum(["16:9", "1:1", "9:16"]).default("16:9"),
});

toolRegistry.register({
  name: "storyboardPreview",
  label: "Storyboard Preview",
  description: "Mock an image output to verify downstream UI handling.",
  inputSchema: storyboardSchema,
  fields: [
    {
      name: "prompt",
      label: "Prompt",
      type: "textarea",
      placeholder: "Describe the frame you want to visualize…",
      required: true,
    },
    {
      name: "aspectRatio",
      label: "Aspect ratio",
      type: "select",
      options: [
        { value: "16:9", label: "16:9" },
        { value: "1:1", label: "1:1" },
        { value: "9:16", label: "9:16" },
      ],
      defaultValue: "16:9",
    },
  ],
  async run(input) {
    const size =
      input.aspectRatio === "1:1"
        ? { w: 600, h: 600 }
        : input.aspectRatio === "9:16"
          ? { w: 540, h: 960 }
          : { w: 960, h: 540 };
    const text = encodeURIComponent(input.prompt.slice(0, 32));
    const url = `https://dummyimage.com/${size.w}x${size.h}/1d1f2f/ffffff.png&text=${text}`;
    return {
      status: "success",
      outputs: [
        { type: "text", text: "Generated placeholder preview." },
        {
          type: "image",
          url,
          alt: input.prompt,
          width: size.w,
          height: size.h,
        },
      ],
    };
  },
});
