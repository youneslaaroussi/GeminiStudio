import { randomUUID } from "crypto";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type Tool as AiTool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import type {
  ChatAttachment,
  ChatMessageMetadata,
  ChatMode,
  PlanningToolTaskInput,
  TaskListItem,
  TaskListSnapshot,
  TimelineChatMessage,
} from "@/app/types/chat";
import { toolRegistry, executeTool } from "@/app/lib/tools/tool-registry";
import { toolResultOutputFromExecution } from "@/app/lib/tools/tool-output-adapter";
import { logger } from "@/app/lib/server/logger";
import type { ToolExecutionResult } from "@/app/lib/tools/types";
import { waitForClientToolResult } from "@/app/lib/server/tools/client-tool-bridge";
import { attachmentToGeminiPart } from "@/app/lib/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MODE_DESCRIPTIONS: Record<ChatMode, string> = {
  ask: "Ask Mode: answer conversationally without invoking any tools. Provide direct, concise responses.",
  agent:
    "Agent Mode: full autonomy. Analyze the request, call available tools when needed, and report results and next steps.",
  plan: "Plan Mode: focus on planning. Use the planning tools to build and refine a detailed task list without executing work.",
};

const taskListStore = new Map<string, TaskListSnapshot>();

const planningTaskStatus = z.enum(["pending", "in_progress", "completed"]);

const planningTaskInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  status: planningTaskStatus.optional(),
});

type ToolMap = Record<string, AiTool<any, any>>;
type PlanningToolResponse<Action extends string> = {
  action: Action;
  message: string;
  taskList: TaskListSnapshot;
};


function createGeneralTools(): ToolMap {
  const localeSchema = z.object({
    locale: z
      .string()
      .optional()
      .describe("Optional locale for formatting"),
  });

  return {
    getDate: tool<z.infer<typeof localeSchema>, string>({
      description: "Get the current date in ISO format.",
      inputSchema: localeSchema,
      async execute({ locale }) {
        const now = new Date();
        return locale
          ? now.toLocaleDateString(locale)
          : now.toISOString().split("T")[0];
      },
    }),
    getTime: tool<z.infer<typeof localeSchema>, string>({
      description: "Get the current time in HH:MM:SS format.",
      inputSchema: localeSchema,
      async execute({ locale }) {
        const now = new Date();
        return locale
          ? now.toLocaleTimeString(locale, { hour12: false })
          : now.toISOString().split("T")[1].split(".")[0];
      },
    }),
  } satisfies ToolMap;
}

function createToolboxTools(): ToolMap {
  const toolboxEntries = toolRegistry.list();

  return toolboxEntries.reduce<ToolMap>((acc, definition) => {
    acc[definition.name] = tool<any, ToolResultOutput>({
      description: definition.description,
      inputSchema: definition.inputSchema,
      async execute(
        input,
        options?: {
          toolCallId?: string;
        }
      ) {
        if (definition.runLocation === "client") {
          if (!options?.toolCallId) {
            throw new Error("Client tool requests require a toolCallId.");
          }
          const context = {
            tool: definition.name,
            runLocation: "client",
            toolCallId: options.toolCallId,
            inputKeys: Object.keys(input ?? {}),
          };
          logger.info(context, "Waiting for client tool result");
          const result = await waitForClientToolResult({
            toolCallId: options.toolCallId,
            toolName: definition.name,
          });
          if (result.status === "error") {
            logger.error({ ...context, error: result.error }, "Client tool execution failed");
            throw new Error(result.error ?? "Client tool execution failed.");
          }
          logger.info(
            { ...context, summary: summarizeExecutionResult(result) },
            "Client tool execution completed"
          );
          return toolResultOutputFromExecution(result);
        }

        const context = {
          tool: definition.name,
          runLocation: definition.runLocation ?? "server",
          inputKeys: Object.keys(input ?? {}),
        };
        logger.info(context, "Executing toolbox tool");

        const result = await executeTool({
          toolName: definition.name,
          input,
          context: {},
        });
        if (result.status === "error") {
          logger.error({ ...context, error: result.error }, "Tool execution failed");
          throw new Error(result.error ?? "Tool execution failed.");
        }
        logger.info(
          { ...context, summary: summarizeExecutionResult(result) },
          "Tool execution completed"
        );
        return toolResultOutputFromExecution(result);
      },
    });
    return acc;
  }, {} as ToolMap);
}

export async function POST(req: Request) {
  const body = await req.json();
  const messages: UIMessage[] = Array.isArray(body?.messages)
    ? body.messages
    : [];
  const chatId =
    typeof body?.id === "string" && body.id.length > 0 ? body.id : "default";
  const fallbackMode = isChatMode(body?.mode) ? body.mode : "ask";

  const filteredMessages = messages.filter(
    (message) => typeof message.role === "string" && message.role.length > 0
  );

  const messagesWithMetadata = filteredMessages.map((message) => {
    if (message.role !== "user") return message;
    const existingMetadata = (message.metadata ??
      {}) as ChatMessageMetadata | null;
    const nextMetadata: ChatMessageMetadata = {
      mode: isChatMode(existingMetadata?.mode)
        ? existingMetadata.mode
        : fallbackMode,
      attachments: existingMetadata?.attachments,
    };
    return {
      ...message,
      metadata: nextMetadata,
    };
  }) as TimelineChatMessage[];

  // Inject attachment parts into user messages
  const messagesWithAttachments = injectAttachmentParts(messagesWithMetadata);

  const activeMode = determineActiveMode(messagesWithAttachments, fallbackMode);

  const systemMessage: TimelineChatMessage = {
    id: "system-mode-instructions",
    role: "system",
    parts: [
      {
        type: "text",
        text: createSystemPrompt(activeMode),
      },
    ],
  };

  const generalTools = createGeneralTools();
  const toolboxTools = createToolboxTools();
  const planningTools = createPlanningTools(chatId);
  const tools =
    activeMode === "ask"
      ? undefined
      : activeMode === "agent"
        ? { ...generalTools, ...toolboxTools, ...planningTools }
        : planningTools;

  const result = streamText({
    model: google(process.env.AI_CHAT_GOOGLE_MODEL ?? "gemini-3-pro-preview"),
    providerOptions: {
      google: {
        thinkingConfig: {
          includeThoughts: true,
        },
      },
    },
    messages: await convertToModelMessages([
      systemMessage,
      ...messagesWithAttachments,
    ]),
    stopWhen: stepCountIs(5),
    toolChoice: activeMode === "ask" ? "none" : undefined,
    tools,
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    onError: (err) => {
      if (err == null) {
        return "Unknown error while contacting Gemini.";
      }
      if (typeof err === "string") {
        return err;
      }
      if (err instanceof Error) {
        return err.message;
      }
      return JSON.stringify(err);
    },
  });
}

function isChatMode(value: unknown): value is ChatMode {
  return value === "ask" || value === "agent" || value === "plan";
}

/**
 * Inject attachment content parts into user messages
 *
 * This converts ChatAttachment metadata into actual content parts
 * that the ai SDK can convert to Gemini API format.
 */
function injectAttachmentParts(
  messages: TimelineChatMessage[]
): TimelineChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;

    const metadata = message.metadata as ChatMessageMetadata | undefined;
    const attachments = metadata?.attachments;

    if (!attachments || attachments.length === 0) return message;

    // Build attachment parts (media should come before text per Gemini best practices)
    const attachmentParts = attachments.map((attachment) => {
      const geminiPart = attachmentToGeminiPart(attachment);

      // Convert to ai SDK part format
      if ("fileData" in geminiPart) {
        return {
          type: "file" as const,
          url: geminiPart.fileData.fileUri,
          mediaType: geminiPart.fileData.mimeType,
        };
      } else if ("inlineData" in geminiPart) {
        // For inline data, use file type with data URL for all types
        return {
          type: "file" as const,
          url: `data:${geminiPart.inlineData.mimeType};base64,${geminiPart.inlineData.data}`,
          mediaType: geminiPart.inlineData.mimeType,
        };
      }
      return null;
    }).filter((part): part is NonNullable<typeof part> => part !== null);

    // Get existing parts
    const existingParts = Array.isArray(message.parts) ? message.parts : [];

    // Combine: attachments first, then existing parts (per Gemini best practices)
    return {
      ...message,
      parts: [...attachmentParts, ...existingParts],
    };
  });
}

function createSystemPrompt(currentMode: ChatMode) {
  return [
    "You are the Gemini Studio AI assistant that collaborates with a user while editing creative timelines.",
    "You operate with three explicit modes and you must honor their constraints:",
    `- ${MODE_DESCRIPTIONS.ask}`,
    `- ${MODE_DESCRIPTIONS.agent}`,
    `- ${MODE_DESCRIPTIONS.plan}`,
    "",
    `The current mode for this turn is: ${currentMode.toUpperCase()}. Treat this as an internal detail—follow its rules but never reveal or explain the mode name to the user.`,
    "When in Ask Mode you must not call any tool and simply answer clearly.",
    "When in Agent Mode you may call any available tool to gather data, reflect, or take action on behalf of the user.",
    "When in Plan Mode you are limited to the planning tools. Use them to create, update, and maintain the shared task list so the user can see progress. Do not execute other tools while planning.",
  ].join("\n");
}

function determineActiveMode(
  messages: TimelineChatMessage[],
  fallback: ChatMode
): ChatMode {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const metadata = message.metadata as ChatMessageMetadata | undefined;
    if (metadata?.mode && isChatMode(metadata.mode)) {
      return metadata.mode;
    }
  }
  return fallback;
}

function createPlanningTools(chatId: string): ToolMap {
  const createTaskListSchema = z.object({
    title: z.string().min(1).max(160).optional(),
    tasks: z.array(planningTaskInputSchema),
  });

  const addTaskSchema = z.object({
    task: planningTaskInputSchema,
  });

  const updateTaskSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1).max(160).optional(),
    description: z.string().max(500).optional(),
    status: planningTaskStatus.optional(),
  });

  const removeTaskSchema = z.object({
    id: z.string().min(1),
  });

  const resetTaskListSchema = z.object({
    title: z.string().min(1).max(160).optional(),
  });

  return {
    planCreateTaskList: tool<
      z.infer<typeof createTaskListSchema>,
      PlanningToolResponse<"task-list-created">
    >({
      description:
        "Create or overwrite the current task list with the provided tasks.",
      inputSchema: createTaskListSchema,
      async execute({ title, tasks }) {
        const normalized = tasks.map(normalizeTask);
        const snapshot = persistTaskList(chatId, { title, tasks: normalized });
        return {
          action: "task-list-created",
          message: `Created ${normalized.length} task(s).`,
          taskList: snapshot,
        } satisfies PlanningToolResponse<"task-list-created">;
      },
    }),
    planAddTask: tool<
      z.infer<typeof addTaskSchema>,
      PlanningToolResponse<"task-added">
    >({
      description: "Add a task to the current plan.",
      inputSchema: addTaskSchema,
      async execute({ task }) {
        const current = ensureTaskList(chatId);
        const normalizedTask = normalizeTask(task);
        const snapshot = persistTaskList(chatId, {
          title: current.title,
          tasks: [...current.tasks, normalizedTask],
        });
        return {
          action: "task-added",
          message: `Added ${normalizedTask.title}.`,
          taskList: snapshot,
        } satisfies PlanningToolResponse<"task-added">;
      },
    }),
    planUpdateTask: tool<
      z.infer<typeof updateTaskSchema>,
      PlanningToolResponse<"task-updated">
    >({
      description: "Update a task's title, description, or status.",
      inputSchema: updateTaskSchema,
      async execute({ id, title, description, status }) {
        const current = ensureTaskList(chatId);
        const tasks = current.tasks.map((task) =>
          task.id === id
            ? {
                ...task,
                title: title ?? task.title,
                description:
                  description === undefined
                    ? task.description
                    : description || undefined,
                status: status ?? task.status,
              }
            : task
        );
        const snapshot = persistTaskList(chatId, {
          title: current.title,
          tasks,
        });
        return {
          action: "task-updated",
          message: `Updated task ${id}.`,
          taskList: snapshot,
        } satisfies PlanningToolResponse<"task-updated">;
      },
    }),
    planRemoveTask: tool<
      z.infer<typeof removeTaskSchema>,
      PlanningToolResponse<"task-removed">
    >({
      description: "Remove a task from the current plan.",
      inputSchema: removeTaskSchema,
      async execute({ id }) {
        const current = ensureTaskList(chatId);
        const snapshot = persistTaskList(chatId, {
          title: current.title,
          tasks: current.tasks.filter((task) => task.id !== id),
        });
        return {
          action: "task-removed",
          message: `Removed task ${id}.`,
          taskList: snapshot,
        } satisfies PlanningToolResponse<"task-removed">;
      },
    }),
    planResetTaskList: tool<
      z.infer<typeof resetTaskListSchema>,
      PlanningToolResponse<"task-list-reset">
    >({
      description: "Clear every task to start fresh while keeping the title.",
      inputSchema: resetTaskListSchema,
      async execute({ title }) {
        const snapshot = persistTaskList(chatId, {
          title: title ?? ensureTaskList(chatId).title,
          tasks: [],
        });
        return {
          action: "task-list-reset",
          message: "Cleared the task list.",
          taskList: snapshot,
        } satisfies PlanningToolResponse<"task-list-reset">;
      },
    }),
  } satisfies ToolMap;
}


function summarizeExecutionResult(result: ToolExecutionResult) {
  if (result.status === "error") {
    return {
      status: "error",
      error: result.error,
    };
  }
  const summary = {
    status: "success" as const,
    counts: {
      text: 0,
      json: 0,
      list: 0,
      image: 0,
    },
    inlineImageBytes: 0,
  };
  for (const output of result.outputs) {
    switch (output.type) {
      case "text":
        summary.counts.text += 1;
        break;
      case "json":
        summary.counts.json += 1;
        break;
      case "list":
        summary.counts.list += 1;
        break;
      case "image":
        summary.counts.image += 1;
        if (output.url.startsWith("data:")) {
          const [, data] = output.url.split(",");
          if (data) {
            summary.inlineImageBytes += Math.floor((data.length * 3) / 4);
          }
        }
        break;
      default:
        break;
    }
  }
  return summary;
}

function normalizeTask(task: PlanningToolTaskInput): TaskListItem {
  return {
    id:
      typeof task.id === "string" && task.id.trim().length > 0
        ? task.id
        : randomUUID(),
    title: task.title.trim(),
    description: task.description?.trim() || undefined,
    status: task.status ?? "pending",
  };
}

function ensureTaskList(chatId: string): TaskListSnapshot {
  const existing = taskListStore.get(chatId);
  if (existing) {
    return existing;
  }
  const empty = {
    id: chatId,
    title: "Project Plan",
    tasks: [],
    updatedAt: new Date().toISOString(),
  };
  taskListStore.set(chatId, empty);
  return empty;
}

function persistTaskList(
  chatId: string,
  next: { title?: string; tasks: TaskListItem[] }
): TaskListSnapshot {
  const snapshot: TaskListSnapshot = {
    id: chatId,
    title: next.title?.trim() || undefined,
    tasks: next.tasks.map((task) => ({ ...task })),
    updatedAt: new Date().toISOString(),
  };
  taskListStore.set(chatId, snapshot);
  return snapshot;
}
