import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mapping of app tool names to their corresponding langgraph server tool names.
 * This is maintained manually - update when adding new langgraph implementations.
 *
 * Format: { appToolName: langgraphToolName }
 */
const LANGGRAPH_TOOL_MAP: Record<string, string> = {
  timelineAddClip: "addClipToTimeline",
  timelineUpdateClip: "updateClipInTimeline",
  timelineDeleteClip: "deleteClipFromTimeline",
  getTimelineState: "getTimelineState",
  listAssets: "listAssets",
  generateMusic: "generateMusic",
  generateSpeech: "generateSpeech",
  veoGenerate: "generateVeoVideo",
  applyVideoEffectToClip: "applyVideoEffectToClip",
  setAssetNotes: "setAssetNotes",
  setSceneConfig: "setSceneConfig",
  applyChromaKeyToClip: "applyChromaKeyToClip",
  previewTimeline: "previewTimeline",
  inspectAsset: "inspectAsset",
};

/**
 * Langgraph-only tools that don't have app equivalents.
 * These are included in the manifest for visibility.
 */
const LANGGRAPH_ONLY_TOOLS: Array<{
  name: string;
  label: string;
  description: string;
  langgraphName: string;
}> = [
  {
    name: "listProjectAssets",
    label: "List Project Assets",
    description: "List all assets associated with a specific project.",
    langgraphName: "listProjectAssets",
  },
  {
    name: "renderVideo",
    label: "Render Video",
    description: "Trigger a video render job for the current project.",
    langgraphName: "renderVideo",
  },
  {
    name: "generateImage",
    label: "Generate Image",
    description: "Generate an image using Google's Gemini image model from a text prompt.",
    langgraphName: "generateImage",
  },
  {
    name: "getAssetMetadata",
    label: "Get Asset Metadata",
    description: "Get detailed metadata for an asset including face detection, shot detection, labels, and transcription.",
    langgraphName: "getAssetMetadata",
  },
  {
    name: "getVideoEffectJobStatus",
    label: "Check Video Effect Job Status",
    description: "Check the status of a video effect job started by applyVideoEffectToClip.",
    langgraphName: "getVideoEffectJobStatus",
  },
  {
    name: "removeBackgroundOnImage",
    label: "Remove Background from Image",
    description:
      "Remove the background from an image. Polls until done, then returns the result. Use asset_id for project assets or image_url for external URLs.",
    langgraphName: "removeBackgroundOnImage",
  },
  {
    name: "reorderLayers",
    label: "Reorder Timeline Layers",
    description:
      "Reorder timeline layers (first = bottom, last = top). Use when the user says the title should be on top or layers are reversed.",
    langgraphName: "reorderLayers",
  },
];

interface ToolImplementations {
  app: boolean;
  langgraph: boolean;
  langgraphName?: string;
  notes?: string;
}

async function exportManifest() {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??= "test-key";
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??= "localhost";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= "demo-project";
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??= "demo-bucket";
  process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ??= "000000000000";
  process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??= "1:000000000000:web:demo";

  const { toolRegistry } = await import("../app/lib/tools/tool-registry");
  const tools = toolRegistry.list();

  // Tools that require browser APIs and can't be ported to langgraph
  const browserOnlyTools = new Set([
    "captureAsset",
    "captureFaces",
    "projectHistory",
  ]);

  const entries = tools.map((tool) => {
    const langgraphName = LANGGRAPH_TOOL_MAP[tool.name];
    const isBrowserOnly = browserOnlyTools.has(tool.name);

    const implementations: ToolImplementations = {
      app: true,
      langgraph: !!langgraphName,
    };

    if (langgraphName) {
      implementations.langgraphName = langgraphName;
    }

    if (isBrowserOnly) {
      implementations.notes = "Requires browser APIs (canvas, video elements)";
    }

    return {
      name: tool.name,
      label: tool.label,
      description: tool.description,
      runLocation: tool.runLocation ?? "server",
      implementations,
      fields: tool.fields,
      inputSchema: zodToJsonSchema(tool.inputSchema, `${tool.name}Input`),
    };
  });

  // Add langgraph-only tools
  const langgraphOnlyEntries = LANGGRAPH_ONLY_TOOLS.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    runLocation: "server" as const,
    implementations: {
      app: false,
      langgraph: true,
      langgraphName: tool.langgraphName,
    },
    fields: [],
    inputSchema: null, // Schema defined in langgraph server
  }));

  const allEntries = [...entries, ...langgraphOnlyEntries];

  const manifest = {
    generatedAt: new Date().toISOString(),
    tools: allEntries.reduce<Record<string, (typeof allEntries)[number]>>(
      (acc, tool) => {
        acc[tool.name] = tool;
        return acc;
      },
      {}
    ),
  };

  const outputDir = path.resolve(__dirname, "../../shared/tools");
  const outputPath = path.join(outputDir, "manifest.json");

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(manifest, null, 2), "utf8");

  const appCount = entries.length;
  const langgraphOnlyCount = langgraphOnlyEntries.length;
  const bothCount = entries.filter((e) => e.implementations.langgraph).length;

  console.log(`Exported ${allEntries.length} tools to ${outputPath}`);
  console.log(`  - App only: ${appCount - bothCount}`);
  console.log(`  - Langgraph only: ${langgraphOnlyCount}`);
  console.log(`  - Both: ${bothCount}`);
}

exportManifest().catch((error) => {
  console.error("Failed to export tool manifest:", error);
  process.exitCode = 1;
});
