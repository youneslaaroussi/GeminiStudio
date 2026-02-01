/**
 * Convert toolRegistry tools to Live API function declarations
 */

import { toolRegistry } from "@/app/lib/tools/tool-registry";
import type { LiveToolDeclaration, LiveFunctionDeclaration, JsonSchemaProperty } from "./types";
import type { z } from "zod";

/**
 * Convert a Zod schema to JSON Schema format for Live API
 */
function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchemaProperty {
  const def = schema._def;

  // Handle ZodObject
  if (def.typeName === "ZodObject") {
    const shape = def.shape();
    const properties: Record<string, JsonSchemaProperty> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as z.ZodTypeAny);

      // Check if field is required (not optional)
      const fieldDef = (value as z.ZodTypeAny)._def;
      if (fieldDef.typeName !== "ZodOptional" && fieldDef.typeName !== "ZodDefault") {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  // Handle ZodString
  if (def.typeName === "ZodString") {
    return { type: "string", description: def.description };
  }

  // Handle ZodNumber
  if (def.typeName === "ZodNumber") {
    return { type: "number", description: def.description };
  }

  // Handle ZodBoolean
  if (def.typeName === "ZodBoolean") {
    return { type: "boolean", description: def.description };
  }

  // Handle ZodEnum
  if (def.typeName === "ZodEnum") {
    return {
      type: "string",
      enum: def.values,
      description: def.description,
    };
  }

  // Handle ZodArray
  if (def.typeName === "ZodArray") {
    return {
      type: "array",
      items: zodToJsonSchema(def.type),
      description: def.description,
    };
  }

  // Handle ZodOptional - unwrap inner type
  if (def.typeName === "ZodOptional") {
    return zodToJsonSchema(def.innerType);
  }

  // Handle ZodDefault - unwrap inner type
  if (def.typeName === "ZodDefault") {
    return zodToJsonSchema(def.innerType);
  }

  // Handle ZodUnion / ZodDiscriminatedUnion
  if (def.typeName === "ZodUnion" || def.typeName === "ZodDiscriminatedUnion") {
    // For discriminated unions, just return object type
    // The AI will figure out the structure from the description
    return { type: "object", description: def.description };
  }

  // Handle ZodLiteral
  if (def.typeName === "ZodLiteral") {
    const value = def.value;
    return {
      type: typeof value as "string" | "number" | "boolean",
      enum: [value],
    };
  }

  // Fallback
  return { type: "string" };
}

/**
 * Get all tools from the registry as Live API function declarations
 * Includes both client and server tools since voice chat runs in browser
 */
export function getToolsForLiveApi(): LiveToolDeclaration[] {
  const tools = toolRegistry.list();

  if (tools.length === 0) {
    return [];
  }

  const functionDeclarations: LiveFunctionDeclaration[] = tools.map((tool) => {
    const parameters = zodToJsonSchema(tool.inputSchema);

    return {
      name: tool.name,
      description: tool.description,
      parameters: parameters.type === "object"
        ? {
            type: "object" as const,
            properties: parameters.properties ?? {},
            required: parameters.required,
          }
        : undefined,
    };
  });

  return [{ functionDeclarations }];
}

/**
 * Get a subset of tools by name
 */
export function getToolsByName(names: string[]): LiveToolDeclaration[] {
  const tools = toolRegistry.list();
  const selectedTools = tools.filter((tool) => names.includes(tool.name));

  if (selectedTools.length === 0) {
    return [];
  }

  const functionDeclarations: LiveFunctionDeclaration[] = selectedTools.map((tool) => {
    const parameters = zodToJsonSchema(tool.inputSchema);

    return {
      name: tool.name,
      description: tool.description,
      parameters: parameters.type === "object"
        ? {
            type: "object" as const,
            properties: parameters.properties ?? {},
            required: parameters.required,
          }
        : undefined,
    };
  });

  return [{ functionDeclarations }];
}

/**
 * Execute a tool from the registry by name
 * Returns the result as a plain object for Live API response
 */
export async function executeToolByName(
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { executeTool } = await import("@/app/lib/tools/tool-registry");

  const result = await executeTool({
    toolName,
    input: args,
    context: {},
  });

  if (result.status === "error") {
    return {
      error: result.error,
      details: result.details,
    };
  }

  const outputTexts: string[] = [];
  const outputData: unknown[] = [];

  for (const output of result.outputs) {
    if (output.type === "text") {
      outputTexts.push(output.text);
    } else if (output.type === "json") {
      outputData.push(output.data);
    } else if (output.type === "list") {
      outputTexts.push(output.title ?? "Results:");
    }
  }

  return {
    success: true,
    message: outputTexts.join("\n") || "Action completed",
    data: outputData.length === 1 ? outputData[0] : outputData.length > 0 ? outputData : undefined,
  };
}
