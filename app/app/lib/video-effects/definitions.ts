import { z } from "zod";
import type {
  AnyVideoEffectDefinition,
  VideoEffectDefinition,
  VideoEffectProvider,
} from "@/app/types/video-effects";

const replicateVersionSam2 =
  "meta/sam-2-video:33432afdfc06a10da6b4018932893d39b0159f838b6d11dd1236dff85cc5ec1d";

const sam2FormSchema = z.object({
  maskType: z
    .enum(["highlighted", "binary"])
    .default("binary")
    .describe("Controls whether the selected object is highlighted or isolated."),
  videoFps: z
    .number()
    .int("Frame rate must be an integer")
    .min(1, "Frame rate must be at least 1")
    .max(60, "Frame rate must be 60 or less")
    .default(25),
  clickFrames: z
    .string()
    .default("1")
    .describe(
      "Comma separated list of frame indexes where clicks are applied (1-based)."
    ),
  clickObjectIds: z
    .string()
    .default("")
    .describe(
      "Optional comma separated list of labels for each clicked object (e.g. bee_1,bee_2)."
    ),
  clickCoordinates: z
    .string()
    .default("")
    .describe(
      "Coordinates for each click formatted as [x,y] pairs (e.g. [391,239],[178,320])."
    ),
  outputVideo: z.boolean().default(true),
});

type Sam2FormValues = z.infer<typeof sam2FormSchema>;

function normalizeCoordinateList(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function normalizeCommaList(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

const sam2VideoDefinition: VideoEffectDefinition<typeof sam2FormSchema, Sam2FormValues> = {
    id: "replicate.meta.sam2-video",
    label: "Segment Anything v2 (Video)",
    description:
      "Interactively segments objects in a video using Meta's SAM 2 model. Provide click coordinates to highlight or isolate subjects.",
    provider: "replicate" satisfies VideoEffectProvider,
    version: replicateVersionSam2,
    formSchema: sam2FormSchema,
    defaultValues: sam2FormSchema.parse({}),
    fields: [
      {
        name: "maskType",
        label: "Mask Type",
        type: "select",
        options: [
          { value: "highlighted", label: "Highlight objects" },
          { value: "binary", label: "Binary mask" },
        ],
        description:
          "Choose whether to highlight selected objects or output a binary mask.",
        required: true,
      },
      {
        name: "videoFps",
        label: "Output FPS",
        type: "number",
        description: "Frames per second for the processed video.",
      },
      {
        name: "clickFrames",
        label: "Click Frames",
        type: "text",
        placeholder: "1,15,30",
        description:
          "Frame numbers where clicks are applied. Leave blank to use the first frame only.",
      },
      {
        name: "clickObjectIds",
        label: "Click Object IDs",
        type: "text",
        placeholder: "bee_1,bee_2",
        description: "Optional labels for objects corresponding to each click.",
      },
      {
        name: "clickCoordinates",
        label: "Click Coordinates",
        type: "textarea",
        placeholder: "[391,239],[178,320]",
        description:
          "Coordinates for clicks in [x,y] format. One coordinate per click frame.",
        required: true,
      },
      {
        name: "outputVideo",
        label: "Return Video Output",
        type: "select",
        options: [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ],
        description:
          "If disabled, the model may return only masks. Default is enabled.",
      },
    ],
    buildProviderInput: ({ assetUrl, params }) => {
      const input: Record<string, unknown> = {
        input_video: assetUrl,
        mask_type: params.maskType,
        video_fps: params.videoFps,
        output_video: params.outputVideo,
      };
      const normalizedFrames = normalizeCommaList(params.clickFrames);
      if (normalizedFrames) {
        input.click_frames = normalizedFrames;
      }
      const normalizedObjectIds = normalizeCommaList(params.clickObjectIds ?? "");
      if (normalizedObjectIds) {
        input.click_object_ids = normalizedObjectIds;
      }
      const normalizedCoordinates = normalizeCoordinateList(
        params.clickCoordinates ?? ""
      );
      if (normalizedCoordinates) {
        input.click_coordinates = normalizedCoordinates;
      }
      return input;
    },
    extractResult: ({ providerOutput, providerStatus }) => {
      if (
        providerStatus === "succeeded" &&
        Array.isArray(providerOutput) &&
        providerOutput.length > 0
      ) {
        const videoUrl = providerOutput.find((value) =>
          typeof value === "string" ? value.endsWith(".mp4") : false
        );
        return {
          resultUrl: typeof videoUrl === "string" ? videoUrl : undefined,
        };
      }

      if (providerStatus === "failed") {
        const message =
          typeof providerOutput === "string"
            ? providerOutput
            : Array.isArray(providerOutput)
            ? providerOutput.join("\n")
            : undefined;
        return {
          error: message ?? "Replicate job failed",
        };
      }

      return {};
    },
  };

export const videoEffectDefinitions: AnyVideoEffectDefinition[] = [
  sam2VideoDefinition,
];

export const videoEffectDefinitionMap = new Map(
  videoEffectDefinitions.map((definition) => [definition.id, definition])
);

export function getVideoEffectDefinition(effectId: string) {
  return videoEffectDefinitionMap.get(effectId);
}
