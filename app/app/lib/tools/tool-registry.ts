import { z } from "zod";
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolRuntimeContext,
} from "./types";
import type { Project } from "@/app/types/timeline";
import { captureAssetTool } from "./capture-asset";
import { captureFacesTool } from "./capture-faces";
import { getAssetMetadataTool } from "./get-asset-metadata";
import { listAssetsTool } from "./list-assets";
import { projectHistoryTool } from "./project-history";
import { timelineAddLayerTool } from "./timeline-add-layer";
import { timelineAddClipTool } from "./timeline-add-clip";
import { timelineSplitClipTool } from "./timeline-split-clip";
import { timelineUpdateClipTool } from "./timeline-update-clip";
import {
  videoEffectsRunTool,
  videoEffectsListTool,
  videoEffectsJobStatusTool,
} from "./video-effects-run";
import { veoGenerateTool, veoJobStatusTool } from "./veo-generate";
import { digestAssetTool } from "./digest-asset";

type AnyToolDefinition = ToolDefinition<any, Project>;

class ToolRegistry {
  private tools: Map<string, AnyToolDefinition> = new Map();

  register<TSchema extends z.ZodTypeAny>(
    tool: ToolDefinition<TSchema, Project>
  ) {
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
toolRegistry.register(captureAssetTool);
toolRegistry.register(captureFacesTool);
toolRegistry.register(getAssetMetadataTool);
toolRegistry.register(listAssetsTool);
toolRegistry.register(projectHistoryTool);
toolRegistry.register(timelineAddLayerTool);
toolRegistry.register(timelineAddClipTool);
toolRegistry.register(timelineSplitClipTool);
toolRegistry.register(timelineUpdateClipTool);
toolRegistry.register(videoEffectsListTool);
toolRegistry.register(videoEffectsRunTool);
toolRegistry.register(videoEffectsJobStatusTool);
toolRegistry.register(veoGenerateTool);
toolRegistry.register(veoJobStatusTool);
toolRegistry.register(digestAssetTool);

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
