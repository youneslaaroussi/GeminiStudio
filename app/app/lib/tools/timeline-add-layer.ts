import { z } from "zod";
import { useProjectStore, createLayerTemplate } from "@/app/lib/store/project-store";
import type { ToolDefinition } from "./types";
import type { Project } from "@/app/types/timeline";

const addLayerSchema = z.object({
  type: z.enum(["video", "audio", "text", "image", "component"]),
  name: z
    .string()
    .trim()
    .min(1, "Layer name cannot be empty")
    .max(120, "Layer name must be 120 characters or fewer")
    .optional(),
});

export const timelineAddLayerTool: ToolDefinition<
  typeof addLayerSchema,
  Project
> = {
  name: "timelineAddLayer",
  label: "Add Timeline Layer",
  description:
    "Create a new timeline layer (video, audio, text, image, or component). Component layers hold custom Motion Canvas component clips.",
  runLocation: "client",
  inputSchema: addLayerSchema,
  fields: [
    {
      name: "type",
      label: "Layer Type",
      type: "select",
      description: "Choose the media type this layer will hold.",
      options: [
        { value: "video", label: "Video" },
        { value: "audio", label: "Audio" },
        { value: "text", label: "Text" },
        { value: "image", label: "Image" },
        { value: "component", label: "Component" },
      ],
      required: true,
    },
    {
      name: "name",
      label: "Layer Name",
      type: "text",
      placeholder: "Optional custom name",
    },
  ],
  async run(input) {
    if (typeof window === "undefined") {
      return {
        status: "error",
        error: "Timeline tools are only available in the browser runtime.",
      };
    }

    const store = useProjectStore.getState();
    const layer = createLayerTemplate(input.type, input.name);
    store.addLayer(layer);

    return {
      status: "success",
      outputs: [
        {
          type: "text",
          text: `Added new ${input.type} layer "${layer.name}".`,
        },
        {
          type: "json",
          data: {
            layer,
            layerCount: store.project.layers.length,
          },
        },
      ],
    };
  },
};
