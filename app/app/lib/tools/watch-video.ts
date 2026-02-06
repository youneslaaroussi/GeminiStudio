/**
 * Watch Video Tool
 *
 * Renders a preview of the current timeline and returns it as multimodal content
 * so the agent can see/watch the video directly with full conversation context.
 *
 * This enables the "self-correcting director" workflow where the agent can:
 * 1. Make edits to the timeline
 * 2. Watch the result
 * 3. Critique its own work
 * 4. Make improvements
 */

import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_TIME_MS = 5 * 60 * 1000; // 5 minutes max

const watchVideoSchema = z.object({
  startTime: z
    .number()
    .min(0)
    .optional()
    .describe("Start time in seconds to render only a segment (use with endTime)"),
  endTime: z
    .number()
    .min(0)
    .optional()
    .describe("End time in seconds to render only a segment (use with startTime)"),
});

interface RenderResponse {
  jobId: string;
  status: string;
  outputPath: string;
}

interface JobStatusResponse {
  jobId: string;
  state: "waiting" | "active" | "completed" | "failed";
  progress: number;
  failedReason?: string;
  downloadUrl?: string;
}

interface GeminiFilesResponse {
  fileUri?: string;
  mimeType?: string;
  displayName?: string;
  error?: string;
}

export const watchVideoTool: ToolDefinition<typeof watchVideoSchema, Project> = {
  name: "watchVideo",
  label: "Watch Video",
  description:
    "Render a preview of the current timeline and watch it. " +
    "Optionally use startTime and endTime (seconds) to render only a segment. " +
    "Triggers a fast low-resolution render (360p @ 10fps), waits for completion, " +
    "then returns the video so you can see it directly. Use to review your edits. Takes 10-60 seconds.",
  runLocation: "client",
  inputSchema: watchVideoSchema,
  fields: [
    {
      name: "startTime",
      label: "Start Time (s)",
      type: "number",
      placeholder: "e.g. 5",
      description: "Optional start time in seconds to watch only part of the timeline.",
      required: false,
    },
    {
      name: "endTime",
      label: "End Time (s)",
      type: "number",
      placeholder: "e.g. 15",
      description: "Optional end time in seconds (use with startTime).",
      required: false,
    },
  ],
  async run(input, context) {
    const toolCallId = `watchVideo_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      if (typeof window === "undefined") {
        console.error(`[watchVideo:${toolCallId}] ERROR: Must run from client side`);
        return {
          status: "error" as const,
          error: "watchVideo must be run from the client side.",
        };
      }

      if (!context.project) {
        console.error(`[watchVideo:${toolCallId}] ERROR: No project available`);
        return {
          status: "error" as const,
          error: "No project available. Cannot render without a timeline.",
        };
      }

      if (!context.projectId) {
        console.error(`[watchVideo:${toolCallId}] ERROR: No project ID available`);
        return {
          status: "error" as const,
          error: "No project ID available.",
        };
      }

      const authHeaders = await getAuthHeaders();
      const projectName = context.project.name || "Timeline Preview";

      // Optional range: render only [startTime, endTime] when both provided
      const range: [number, number] | undefined =
        input.startTime != null && input.endTime != null && input.endTime > input.startTime
          ? [input.startTime, input.endTime]
          : undefined;

      // Step 1: Trigger preview render
      const renderResponse = await fetch("/api/render", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          project: context.project,
          projectId: context.projectId,
          output: {
            format: "mp4",
            quality: "low",
            fps: 10,
            ...(range && { range }),
          },
          preview: true,
        }),
      });

      if (!renderResponse.ok) {
        const errorData = await renderResponse.json().catch(() => ({}));
        console.error(`[watchVideo:${toolCallId}] ERROR: Render API failed`, {
          status: renderResponse.status,
          statusText: renderResponse.statusText,
          error: errorData.error,
        });
        return {
          status: "error" as const,
          error: `Failed to start preview render: ${errorData.error || renderResponse.statusText}`,
        };
      }

      const renderResult = (await renderResponse.json()) as RenderResponse;
      const { jobId } = renderResult;

      // Step 2: Poll for render completion
      const startTime = Date.now();
      let jobStatus: JobStatusResponse | null = null;

      while (Date.now() - startTime < MAX_POLL_TIME_MS) {
        const statusResponse = await fetch(`/api/render/${jobId}`, {
          method: "GET",
          headers: authHeaders,
        });

        if (!statusResponse.ok) {
          console.error(`[watchVideo:${toolCallId}] Failed to check render status`, statusResponse.status, statusResponse.statusText);
          return {
            status: "error" as const,
            error: `Failed to check render status: ${statusResponse.statusText}`,
          };
        }

        jobStatus = (await statusResponse.json()) as JobStatusResponse;

        if (jobStatus.state === "completed") break;

        if (jobStatus.state === "failed") {
          console.error(`[watchVideo:${toolCallId}] Render failed`, jobStatus.failedReason);
          return {
            status: "error" as const,
            error: `Preview render failed: ${jobStatus.failedReason || "Unknown error"}`,
          };
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (!jobStatus || jobStatus.state !== "completed") {
        console.error(`[watchVideo:${toolCallId}] Render timeout`);
        return {
          status: "error" as const,
          error: "Preview render timed out after 5 minutes.",
        };
      }

      if (!jobStatus.downloadUrl) {
        console.error(`[watchVideo:${toolCallId}] No download URL from render`);
        return {
          status: "error" as const,
          error: "Preview render completed but no download URL was provided.",
        };
      }

      // Step 3: Upload to Gemini Files API
      const geminiResponse = await fetch("/api/gemini-files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          url: jobStatus.downloadUrl,
          mimeType: "video/mp4",
          displayName: `Preview - ${projectName}`,
        }),
      });

      const geminiData = (await geminiResponse.json()) as GeminiFilesResponse;

      if (!geminiResponse.ok || !geminiData.fileUri) {
        console.error(`[watchVideo:${toolCallId}] Gemini Files API failed`, geminiResponse.status, geminiData.error);
        return {
          status: "error" as const,
          error: geminiData.error || "Failed to prepare video for viewing",
        };
      }

      // Step 4: Return with _injectMedia + fileUri for multimodal tool result
      // Our local @ai-sdk/google (ai-sdk/packages/google) sends file-url tool results as fileData,
      // so the model receives this video in the tool result. prepareStep also injects as user message (fallback).
      // For Live API we also include downloadUrl.
      const renderTime = Math.round((Date.now() - startTime) / 1000);
      const rangeNote =
        range != null ? ` (segment ${range[0]}s–${range[1]}s)` : "";

      const result = {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: `Preview of "${projectName}"${rangeNote} ready (360p @ 10fps, rendered in ${renderTime}s). The video is now visible.`,
          },
        ],
        meta: {
          _injectMedia: true,
          fileUri: geminiData.fileUri,
          downloadUrl: jobStatus.downloadUrl, // For Live API which needs inline data
          mimeType: geminiData.mimeType || "video/mp4",
          assetName: `Preview - ${projectName}`,
          jobId,
          projectName,
          renderTimeSeconds: renderTime,
        },
      };

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[watchVideo:${toolCallId}] ERROR: Exception caught`, {
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        status: "error" as const,
        error: message,
      };
    }
  },
};
