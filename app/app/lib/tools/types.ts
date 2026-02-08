import type { z } from "zod";

export type ToolFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "datetime"
  | "json";

export interface ToolFieldDefinition {
  name: string;
  label: string;
  type: ToolFieldType;
  placeholder?: string;
  description?: string;
  defaultValue?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
}

export type ToolOutput =
  | { type: "text"; text: string }
  | { type: "json"; data: unknown }
  | { type: "image"; url: string; alt?: string; width?: number; height?: number }
  | { type: "list"; title?: string; items: ToolOutput[] }
  | {
      type: "file";
      fileUri: string;
      mimeType: string;
      displayName?: string;
    }
  | {
      type: "code";
      language: string;
      filename?: string;
      code: string;
      oldCode?: string;
      summary?: string;
    };

export interface ToolExecutionSuccess {
  status: "success";
  outputs: ToolOutput[];
  meta?: Record<string, unknown>;
}

export interface ToolExecutionFailure {
  status: "error";
  error: string;
  details?: unknown;
}

export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;

export interface ToolRuntimeContext<TProject = unknown> {
  project?: TProject;
  projectId?: string;
}

export interface ToolDefinition<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TProject = unknown
> {
  name: string;
  label: string;
  description: string;
  inputSchema: TSchema;
  fields: ToolFieldDefinition[];
  runLocation?: "server" | "client";
  run: (
    input: z.infer<TSchema>,
    context: ToolRuntimeContext<TProject>
  ) => Promise<ToolExecutionResult>;
}
