import { z } from "zod";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

const ASPECT_RATIOS = ["1:1", "16:9", "9:16"] as const;
const IMAGE_SIZES = ["1K", "2K", "4K"] as const;

const generateImageSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
  aspectRatio: z.enum(ASPECT_RATIOS).default("1:1"),
  imageSize: z.enum(IMAGE_SIZES).default("1K"),
});

export const generateImageTool: ToolDefinition<typeof generateImageSchema, Project> = {
  name: "generateImage",
  label: "Generate Image",
  description:
    "Generate an image using Google's Gemini image model (Banana) from a text prompt. Creates still images from a description.",
  runLocation: "client",
  inputSchema: generateImageSchema,
  fields: [
    {
      name: "prompt",
      label: "Image Description",
      type: "textarea",
      placeholder: "A serene mountain landscape at sunset with a lake in the foreground...",
      description: "Describe the image you want to generate in detail.",
      required: true,
    },
    {
      name: "aspectRatio",
      label: "Aspect Ratio",
      type: "select",
      options: [
        { value: "1:1", label: "1:1 Square" },
        { value: "16:9", label: "16:9 Landscape" },
        { value: "9:16", label: "9:16 Portrait" },
      ],
      defaultValue: "1:1",
      description: "Aspect ratio of the generated image.",
    },
    {
      name: "imageSize",
      label: "Resolution",
      type: "select",
      options: [
        { value: "1K", label: "1K" },
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" },
      ],
      defaultValue: "1K",
      description: "Output resolution (1K, 2K, or 4K).",
    },
  ],
  async run(input, context) {
    try {
      if (typeof window === "undefined") {
        return {
          status: "error" as const,
          error: "Image generation must be run from the client side.",
        };
      }

      const projectId = context.projectId;
      if (!projectId) {
        return {
          status: "error" as const,
          error: "No project open. Open a project in the editor first.",
        };
      }

      const payload = {
        prompt: input.prompt.trim(),
        aspectRatio: input.aspectRatio,
        imageSize: input.imageSize,
        projectId,
      };

      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/banana", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as {
        asset?: { id: string; signedUrl?: string; name?: string };
        error?: string;
        required?: number;
      };

      if (response.status === 402) {
        return {
          status: "error" as const,
          error: data.error ?? "Insufficient credits",
          details: data.required != null ? { requiredCredits: data.required } : undefined,
        };
      }

      if (!response.ok || !data.asset) {
        return {
          status: "error" as const,
          error: data.error || "Failed to generate image",
        };
      }

      const asset = data.asset;

      return {
        status: "success" as const,
        outputs: [
          {
            type: "text" as const,
            text: "Image generated successfully!",
          },
          {
            type: "image" as const,
            url: asset.signedUrl ?? "",
            alt: input.prompt.slice(0, 80) + (input.prompt.length > 80 ? "..." : ""),
          },
          {
            type: "json" as const,
            data: {
              assetId: asset.id,
              imageUrl: asset.signedUrl,
              prompt: input.prompt.slice(0, 100) + (input.prompt.length > 100 ? "..." : ""),
            },
          },
        ],
        meta: {
          assetId: asset.id,
          imageUrl: asset.signedUrl,
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
