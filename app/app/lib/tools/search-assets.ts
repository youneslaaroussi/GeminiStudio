import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";

const searchAssetsSchema = z.object({
  query: z.string().min(1).describe("Search query - can be natural language like 'sunset beach' or 'person talking'"),
  type: z.enum(["video", "audio", "image", "other", ""]).optional().describe("Filter by asset type"),
  limit: z.number().min(1).max(50).optional().default(10).describe("Maximum number of results"),
});

export const searchAssetsTool: ToolDefinition<typeof searchAssetsSchema, Project> = {
  name: "searchAssets",
  label: "Search Assets",
  description:
    "Search for assets by content - filename, AI description, transcripts, detected labels, and Gemini analysis. Use when the user asks to 'find' or 'search' for specific content.",
  runLocation: "client",
  inputSchema: searchAssetsSchema,
  fields: [
    {
      name: "query",
      label: "Search Query",
      type: "text",
      placeholder: "sunset beach, person speaking, logo...",
      description: "Natural language search query",
      required: true,
    },
    {
      name: "type",
      label: "Asset Type",
      type: "select",
      options: [
        { value: "", label: "All types" },
        { value: "video", label: "Video" },
        { value: "audio", label: "Audio" },
        { value: "image", label: "Image" },
      ],
      description: "Filter by asset type",
    },
    {
      name: "limit",
      label: "Max Results",
      type: "number",
      placeholder: "10",
      description: "Maximum number of results (1-50)",
    },
  ],
  async run(input, context) {
    const projectId = context?.projectId;
    
    if (!projectId) {
      return {
        status: "error",
        error: "No project ID available. Please open a project first.",
      };
    }

    try {
      const params = new URLSearchParams({ projectId });
      const response = await fetch(`/api/assets/search?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: input.query,
          type: input.type || undefined,
          limit: input.limit || 10,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        return {
          status: "error",
          error: data.error || `Search failed: ${response.status}`,
        };
      }

      const results = await response.json();
      
      if (results.error) {
        return {
          status: "error",
          error: results.error,
        };
      }

      const hits = results.hits || [];
      
      if (hits.length === 0) {
        return {
          status: "success",
          outputs: [
            {
              type: "text",
              text: `No assets found matching "${input.query}"`,
            },
          ],
        };
      }

      // Build human-readable summary
      const items = hits.map((hit: {
        name?: string;
        type?: string;
        duration?: number;
        description?: string;
        highlights?: { description?: string; searchableText?: string };
      }) => {
        const name = hit.name || "Untitled";
        const assetType = hit.type || "unknown";
        const duration = hit.duration;
        const description = hit.description || "";
        
        // Get highlight snippet if available
        const highlights = hit.highlights || {};
        const snippet = highlights.description || highlights.searchableText || description;
        const truncatedSnippet = snippet && snippet.length > 100 
          ? snippet.substring(0, 100) + "..." 
          : snippet;

        let text = duration
          ? `**${name}** (${assetType}, ${duration.toFixed(1)}s)`
          : `**${name}** (${assetType})`;

        if (truncatedSnippet) {
          text += `\n  _${truncatedSnippet}_`;
        }

        return { type: "text" as const, text };
      });

      return {
        status: "success",
        outputs: [
          {
            type: "list",
            title: `Found ${results.total} asset${results.total !== 1 ? "s" : ""} matching "${input.query}"`,
            items,
          },
          {
            type: "json",
            data: hits.map((hit: { id?: string; name?: string; type?: string; duration?: number; description?: string; labels?: string[] }) => ({
              id: hit.id,
              name: hit.name,
              type: hit.type,
              duration: hit.duration,
              description: hit.description,
              labels: hit.labels?.slice(0, 10),
            })),
          },
        ],
      };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : "Search failed",
      };
    }
  },
};
