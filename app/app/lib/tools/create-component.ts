import { z } from "zod";
import type { ToolDefinition, ToolFieldDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useProjectStore } from "@/app/lib/store/project-store";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import { requestCompileScene } from "@/app/lib/compile-scene-client";
import type { RemoteAsset } from "@/app/types/assets";

const inputDefSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "color", "enum"]),
  default: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string().optional(),
  options: z.array(z.string()).optional().describe("For type 'enum': list of allowed options the user can choose from"),
});

const createComponentSchema = z.object({
  name: z.string().min(1).describe("Display name for the component asset"),
  code: z.string().min(1).describe("Motion Canvas TSX source code"),
  componentName: z
    .string()
    .min(1)
    .describe("Exported class name (e.g. ProgressRing)"),
  inputDefs: z
    .array(inputDefSchema)
    .optional()
    .describe("Input definitions for dynamic props"),
  description: z
    .string()
    .optional()
    .describe("Short description of what the component does"),
});

type CreateComponentInput = z.infer<typeof createComponentSchema>;

const fields: ToolFieldDefinition[] = [
  {
    name: "name",
    label: "Name",
    type: "text",
    placeholder: "e.g. ProgressRing",
    required: true,
  },
  {
    name: "componentName",
    label: "Component Class Name",
    type: "text",
    placeholder: "e.g. ProgressRing",
    required: true,
  },
  {
    name: "code",
    label: "Code",
    type: "textarea",
    placeholder: "Motion Canvas TSX source code",
    required: true,
  },
  {
    name: "description",
    label: "Description",
    type: "text",
    placeholder: "Short description of the component",
  },
];

export const createComponentTool: ToolDefinition<
  typeof createComponentSchema,
  Project
> = {
  name: "createComponent",
  label: "Create Component",
  description:
    "Create a new Motion Canvas custom component asset with TSX source code. The component will be compiled and available for use on the timeline.",
  runLocation: "client",
  inputSchema: createComponentSchema,
  fields,
  async run(input: CreateComponentInput) {
    const projectId = useProjectStore.getState().projectId;
    if (!projectId) {
      return { status: "error", error: "No project loaded." };
    }

    try {
      const authHeaders = await getAuthHeaders();

      // 1. Create the component asset
      const createUrl = new URL(
        "/api/component-assets",
        window.location.origin
      );
      const createBody = {
        projectId,
        name: input.name,
        code: input.code,
        componentName: input.componentName,
        inputDefs: input.inputDefs,
      };

      const createRes = await fetch(createUrl.toString(), {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(createBody),
      });

      if (!createRes.ok) {
        const data = (await createRes.json()) as { error?: string };
        return {
          status: "error",
          error:
            data.error ?? `Failed to create component (${createRes.status})`,
        };
      }

      const { asset } = (await createRes.json()) as { asset: RemoteAsset };

      // 2. Set description if provided
      if (input.description) {
        const patchUrl = new URL(
          `/api/assets/${asset.id}`,
          window.location.origin
        );
        patchUrl.searchParams.set("projectId", projectId);
        await fetch(patchUrl.toString(), {
          method: "PATCH",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ description: input.description }),
        });
        asset.description = input.description;
      }

      // 3. Update local store
      const store = useAssetsStore.getState();
      store.setAssets([...store.assets, asset]);

      const inputCount = input.inputDefs?.length ?? 0;
      const summary = `Created component "${input.componentName}"${inputCount > 0 ? ` with ${inputCount} input${inputCount > 1 ? "s" : ""}` : ""}`;

      // 4. Trial compile to validate the component code and collect type/lint diagnostics
      let compileError: string | null = null;
      let compileDiagnostics: Array<{ file: string; line: number; column: number; message: string; code?: string; severity: string }> | undefined;
      try {
        const allAssets = useAssetsStore.getState().assets;
        const files: Record<string, string> = {};
        for (const a of allAssets) {
          if (a.type === "component" && a.componentName && a.code) {
            files[`src/components/custom/${a.componentName}.tsx`] = a.code;
          }
        }
        files[`src/components/custom/${input.componentName}.tsx`] = input.code;

        const compileRes = await requestCompileScene(
          { files, includeDiagnostics: true },
          authHeaders
        );

        const compileData = await compileRes.json().catch(() => ({})) as { error?: string; diagnostics?: Array<{ file: string; line: number; column: number; message: string; code?: string; severity: string }> };
        if (!compileRes.ok) {
          compileError = compileData.error ?? `Compilation failed (HTTP ${compileRes.status})`;
        } else if (compileData.diagnostics?.length) {
          compileDiagnostics = compileData.diagnostics;
        }
      } catch {
        // Scene compiler unavailable — skip validation silently
      }

      const outputs: Array<
        | { type: "code"; language: string; filename?: string; code: string; summary?: string }
        | { type: "text"; text: string }
      > = [
        {
          type: "code",
          language: "tsx",
          filename: `${input.componentName}.tsx`,
          code: input.code,
          summary,
        },
        {
          type: "text",
          text: summary + `. Asset ID: ${asset.id}`,
        },
      ];

      if (compileError) {
        outputs.push({
          type: "text",
          text: `COMPILATION ERROR: ${compileError}. The component was saved but the code has errors that prevent it from being used. Please call editComponent to fix the issues.`,
        });
      } else if (compileDiagnostics?.length) {
        const lines = compileDiagnostics.map(
          (d) => `  ${d.file}:${d.line}:${d.column} ${d.code ?? ""} — ${d.message}`
        );
        outputs.push({
          type: "text",
          text: `The component was created and the build succeeded, but type-check reported the following issues. Consider calling editComponent to fix them:\n\n${lines.join("\n")}`,
        });
      }

      return { status: "success", outputs };
    } catch (error) {
      return {
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Failed to create component",
      };
    }
  },
};
