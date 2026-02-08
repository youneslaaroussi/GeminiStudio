import { z } from "zod";
import type { ToolDefinition, ToolFieldDefinition } from "./types";
import type { Project } from "@/app/types/timeline";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { useProjectStore } from "@/app/lib/store/project-store";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";

const inputDefSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "color"]),
  default: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string().optional(),
});

const editComponentSchema = z.object({
  assetId: z.string().min(1).describe("ID of the component asset to edit"),
  code: z.string().optional().describe("Updated Motion Canvas TSX source code"),
  name: z.string().optional().describe("Updated display name"),
  componentName: z
    .string()
    .optional()
    .describe("Updated exported class name"),
  inputDefs: z
    .array(inputDefSchema)
    .optional()
    .describe("Updated input definitions"),
  description: z.string().optional().describe("Updated description"),
});

type EditComponentInput = z.infer<typeof editComponentSchema>;

const fields: ToolFieldDefinition[] = [
  {
    name: "assetId",
    label: "Asset ID",
    type: "text",
    placeholder: "UUID of the component asset",
    required: true,
  },
  {
    name: "code",
    label: "Code",
    type: "textarea",
    placeholder: "Updated Motion Canvas TSX source code",
  },
  {
    name: "name",
    label: "Name",
    type: "text",
    placeholder: "Updated display name",
  },
  {
    name: "componentName",
    label: "Component Class Name",
    type: "text",
    placeholder: "Updated class name",
  },
  {
    name: "description",
    label: "Description",
    type: "text",
    placeholder: "Updated description",
  },
];

export const editComponentTool: ToolDefinition<
  typeof editComponentSchema,
  Project
> = {
  name: "editComponent",
  label: "Edit Component",
  description:
    "Edit an existing Motion Canvas custom component. Can update code, name, componentName, inputDefs, or description. When updating code, provide the complete new source.",
  runLocation: "client",
  inputSchema: editComponentSchema,
  fields,
  async run(input: EditComponentInput) {
    const { assetId, ...updates } = input;

    const store = useAssetsStore.getState();
    const existing = store.getAssetById(assetId);
    if (!existing) {
      return {
        status: "error",
        error: `Component asset '${assetId}' not found in the current project.`,
      };
    }
    if (existing.type !== "component") {
      return {
        status: "error",
        error: `Asset '${assetId}' is not a component (type: ${existing.type}).`,
      };
    }

    // Build the PATCH body (only include fields that were provided)
    const patchBody: Record<string, unknown> = {};
    if (updates.code !== undefined) patchBody.code = updates.code;
    if (updates.name !== undefined) patchBody.name = updates.name;
    if (updates.componentName !== undefined)
      patchBody.componentName = updates.componentName;
    if (updates.inputDefs !== undefined) patchBody.inputDefs = updates.inputDefs;
    if (updates.description !== undefined)
      patchBody.description = updates.description;

    if (Object.keys(patchBody).length === 0) {
      return {
        status: "error",
        error: "No fields provided to update.",
      };
    }

    const projectId = useProjectStore.getState().projectId;
    if (!projectId) {
      return { status: "error", error: "No project loaded." };
    }

    try {
      const authHeaders = await getAuthHeaders();
      const url = new URL(`/api/assets/${assetId}`, window.location.origin);
      url.searchParams.set("projectId", projectId);

      const response = await fetch(url.toString(), {
        method: "PATCH",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });

      if (response.status === 404) {
        return { status: "error", error: "Component asset not found." };
      }
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        return {
          status: "error",
          error:
            data.error ??
            `Failed to update component (${response.status})`,
        };
      }

      // Update local store optimistically
      store.setAssets(
        store.assets.map((a) =>
          a.id === assetId ? { ...a, ...patchBody } : a
        )
      );

      const oldCode = existing.code;
      const newCode = updates.code;
      const codeChanged = newCode !== undefined && newCode !== oldCode;
      const componentName =
        updates.componentName ?? existing.componentName ?? "Component";

      const changedFields = Object.keys(patchBody);
      const summary = codeChanged
        ? `Updated code for "${componentName}"`
        : `Updated ${changedFields.join(", ")} for "${componentName}"`;

      const outputs: Array<
        | { type: "code"; language: string; filename?: string; code: string; oldCode?: string; summary?: string }
        | { type: "text"; text: string }
      > = [];

      if (codeChanged) {
        outputs.push({
          type: "code",
          language: "tsx",
          filename: `${componentName}.tsx`,
          code: newCode,
          oldCode: oldCode ?? undefined,
          summary,
        });
      }

      outputs.push({
        type: "text",
        text: summary,
      });

      // Trial compile to validate the component code (only when code changed)
      if (codeChanged) {
        try {
          const allAssets = useAssetsStore.getState().assets;
          const files: Record<string, string> = {};
          for (const a of allAssets) {
            if (a.type === "component" && a.componentName && a.code) {
              files[`src/components/custom/${a.componentName}.tsx`] = a.code;
            }
          }
          // Override with the just-edited code (in case store hasn't synced)
          files[`src/components/custom/${componentName}.tsx`] = newCode;

          const authHeaders2 = await getAuthHeaders();
          const compileRes = await fetch("/api/compile-scene", {
            method: "POST",
            headers: { ...authHeaders2, "Content-Type": "application/json" },
            body: JSON.stringify({ files }),
          });

          if (!compileRes.ok) {
            const errData = await compileRes.json().catch(() => ({}));
            const compileError = (errData as { error?: string }).error ?? `Compilation failed (HTTP ${compileRes.status})`;
            outputs.push({
              type: "text",
              text: `COMPILATION ERROR: ${compileError}. The component was saved but the code has errors that prevent it from being used. Please call editComponent to fix the issues.`,
            });
          }
        } catch {
          // Scene compiler unavailable — skip validation silently
        }
      }

      return { status: "success", outputs };
    } catch (error) {
      return {
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Failed to update component",
      };
    }
  },
};
