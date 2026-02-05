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

const watchVideoSchema = z.object({});

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
    "This triggers a fast low-resolution render (360p @ 10fps), waits for completion, " +
    "then returns the video so you can see it directly with full conversation context. " +
    "Use this to review your edits and critique your own work. Takes 10-60 seconds.",
  runLocation: "client",
  inputSchema: watchVideoSchema,
  fields: [],
  async run(_input, context) {
    try {
      if (typeof window === "undefined") {
        return {
          status: "error" as const,
          error: "watchVideo must be run from the client side.",
        };
      }

      if (!context.project) {
        return {
          status: "error" as const,
          error: "No project available. Cannot render without a timeline.",
        };
      }

      if (!context.projectId) {
        return {
          status: "error" as const,
          error: "No project ID available.",
        };
      }

      const authHeaders = await getAuthHeaders();
      const projectName = context.project.name || "Timeline Preview";

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
          },
          preview: true,
        }),
      });

      if (!renderResponse.ok) {
        const errorData = await renderResponse.json().catch(() => ({}));
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
          return {
            status: "error" as const,
            error: `Failed to check render status: ${statusResponse.statusText}`,
          };
        }

        jobStatus = (await statusResponse.json()) as JobStatusResponse;

        if (jobStatus.state === "completed") {
          break;
        }

        if (jobStatus.state === "failed") {
          return {
            status: "error" as const,
            error: `Preview render failed: ${jobStatus.failedReason || "Unknown error"}`,
          };
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (!jobStatus || jobStatus.state !== "completed") {
        return {
          status: "error" as const,
          error: "Preview render timed out after 5 minutes.",
        };
      }

      if (!jobStatus.downloadUrl) {
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
        return {
          status: "error" as const,
          error: geminiData.error || "Failed to prepare video for viewing",
        };
      }

      // Step 4: Return with _injectMedia flag for media injection
      // Gemini doesn't support multimodal tool results, so prepareStep injects as user message
      // For Live API (which can't use fileUri with tokens), we also include downloadUrl
      const renderTime = Math.round((Date.now() - startTime) / 1000);

      return {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: `Preview of "${projectName}" ready (360p @ 10fps, rendered in ${renderTime}s). The video is now visible.`,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        status: "error" as const,
        error: message,
      };
    }
  },
};
