import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
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
import { initAdmin } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { deductCredits } from "@/app/lib/server/credits";
import { getCreditsForAction } from "@/app/lib/credits-config";

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
    // Return raw ToolExecutionResult so prepareStep can access meta (for _injectMedia)
    // toModelOutput transforms it for the model
    acc[definition.name] = tool<any, ToolExecutionResult>({
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
            { ...context, summary: summarizeExecutionResult(result), hasMeta: !!result.meta },
            "Client tool execution completed"
          );
          // Return raw result - prepareStep needs meta._injectMedia, toModelOutput transforms for model
          return result;
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
          { ...context, summary: summarizeExecutionResult(result), hasMeta: !!result.meta },
          "Tool execution completed"
        );
        // Return raw result - toModelOutput transforms for model
        return result;
      },
      // Transform raw ToolExecutionResult to ToolResultOutput for the model
      // (prepareStep already extracted meta._injectMedia for media injection)
      toModelOutput({ output }): ToolResultOutput {
        // output is a ToolExecutionResult, transform it for the model
        const result = output as ToolExecutionResult | undefined;
        if (!result) {
          return { type: "text", value: "No output" };
        }
        // Use the adapter to transform to ToolResultOutput
        return toolResultOutputFromExecution(result);
      },
    });
    return acc;
  }, {} as ToolMap);
}

async function verifyToken(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    await initAdmin();
    const decoded = await getAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const userId = await verifyToken(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cost = getCreditsForAction("chat");
  try {
    await deductCredits(userId, cost, "chat");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Insufficient credits";
    return new Response(
      JSON.stringify({ error: msg, required: cost }),
      { status: 402, headers: { "Content-Type": "application/json" } }
    );
  }

  const body = await req.json();
  const messages: UIMessage[] = Array.isArray(body?.messages)
    ? body.messages
    : [];
  const chatId =
    typeof body?.id === "string" && body.id.length > 0 ? body.id : "default";
  const fallbackMode = isChatMode(body?.mode) ? body.mode : "ask";

  logger.info(
    {
      messageCount: messages.length,
      bodyKeys: Object.keys(body ?? {}),
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        roleType: typeof m.role,
        partsCount: Array.isArray(m.parts) ? m.parts.length : 0,
        hasContent: !!(m as { content?: string }).content,
        keys: Object.keys(m ?? {}),
        metadataKeys: m.metadata ? Object.keys(m.metadata) : [],
        assetMentionsCount: (m.metadata as ChatMessageMetadata | undefined)?.assetMentions?.length ?? 0,
      })),
    },
    "Incoming chat request"
  );

  const filteredMessages = messages.filter(
    (message) => typeof message.role === "string" && message.role.length > 0
  );

  if (filteredMessages.length !== messages.length) {
    logger.warn(
      {
        originalCount: messages.length,
        filteredCount: filteredMessages.length,
        droppedMessages: messages
          .filter((m) => !(typeof m.role === "string" && m.role.length > 0))
          .map((m) => ({ id: m.id, role: m.role, keys: Object.keys(m ?? {}) })),
      },
      "Some messages were filtered out due to missing role"
    );
  }

  const messagesWithMetadata = filteredMessages.map((message) => {
    if (message.role !== "user") return message;
    const existingMetadata = (message.metadata ??
      {}) as ChatMessageMetadata | null;
    const nextMetadata: ChatMessageMetadata = {
      mode: isChatMode(existingMetadata?.mode)
        ? existingMetadata.mode
        : fallbackMode,
      attachments: existingMetadata?.attachments,
      assetMentions: existingMetadata?.assetMentions,
    };
    return {
      ...message,
      metadata: nextMetadata,
    };
  }) as TimelineChatMessage[];

  // Inject attachment parts into user messages
  const messagesWithAttachments = injectAttachmentParts(messagesWithMetadata);

  logger.info(
    {
      filteredCount: filteredMessages.length,
      withAttachmentsCount: messagesWithAttachments.length,
      messagesWithAttachments: messagesWithAttachments.map((m) => ({
        id: m.id,
        role: m.role,
        partsCount: Array.isArray(m.parts) ? m.parts.length : 0,
        partTypes: Array.isArray(m.parts) ? m.parts.map((p) => p.type) : [],
      })),
    },
    "After processing messages"
  );

  // Gemini API requires at least one user message
  if (messagesWithAttachments.length === 0) {
    logger.warn({ originalCount: messages.length }, "No messages after filtering");
    return new Response(
      JSON.stringify({ error: "No messages provided" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

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

  const modelMessages = await convertToModelMessages([
    systemMessage,
    ...messagesWithAttachments,
  ]);

  logger.info(
    {
      modelMessagesCount: modelMessages.length,
      modelMessages: modelMessages.map((m) => ({
        role: m.role,
        contentLength: Array.isArray(m.content) ? m.content.length : 0,
        contentTypes: Array.isArray(m.content)
          ? m.content.map((c) => c.type)
          : [],
      })),
    },
    "Converted model messages"
  );

  const result = streamText({
    model: google(process.env.AI_CHAT_GOOGLE_MODEL ?? "gemini-3-pro-preview"),
    providerOptions: {
      google: {
        thinkingConfig: {
          includeThoughts: true,
        },
      },
    },
    messages: modelMessages,
    stopWhen: stepCountIs(5),
    toolChoice: activeMode === "ask" ? "none" : undefined,
    tools,
    // Inject media as user message when watchAsset returns _injectMedia flag
    // This is needed because Gemini doesn't support multimodal tool results
    prepareStep: async ({ stepNumber, steps, messages }) => {
      if (stepNumber > 0 && steps.length > 0) {
        const lastStep = steps[steps.length - 1];
        for (const toolResult of lastStep.toolResults) {
          // Check if tool result has _injectMedia flag in meta (output is raw ToolExecutionResult)
          const output = toolResult.output as { meta?: { _injectMedia?: boolean; fileUri?: string; mimeType?: string; startOffset?: string; endOffset?: string; assetName?: string } } | undefined;
          const meta = output?.meta;
          if (meta?._injectMedia && meta?.fileUri) {
            logger.info({ assetName: meta.assetName, startOffset: meta.startOffset, endOffset: meta.endOffset }, "Injecting media as user message");
            
            // Build file content with optional videoMetadata for time range
            const fileContent: Record<string, unknown> = {
              type: "file",
              data: meta.fileUri,
              mediaType: meta.mimeType,
            };
            
            // Add videoMetadata for time range if specified
            if (meta.startOffset || meta.endOffset) {
              fileContent.providerOptions = {
                google: {
                  videoMetadata: {
                    startOffset: meta.startOffset,
                    endOffset: meta.endOffset,
                  },
                },
              };
            }
            
            // Append media as user message
            return {
              messages: [
                ...messages,
                {
                  role: "user" as const,
                  content: [
                    { 
                      type: "text" as const, 
                      text: meta.startOffset || meta.endOffset
                        ? `Here is the video segment (${meta.startOffset || '0s'} - ${meta.endOffset || 'end'}) for "${meta.assetName || 'asset'}":`
                        : `Here is the media "${meta.assetName || 'asset'}":`,
                    },
                    fileContent as { type: "file"; data: string; mediaType: string },
                  ],
                },
              ],
            };
          }
        }
      }
      return {};
    },
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
 * Build context text for asset mentions so the agent knows the actual assetIds
 */
function buildAssetMentionContext(metadata: ChatMessageMetadata | undefined): string | null {
  logger.info({
    hasMetadata: !!metadata,
    metadataKeys: metadata ? Object.keys(metadata) : [],
    assetMentions: metadata?.assetMentions,
    assetMentionsCount: metadata?.assetMentions?.length ?? 0,
  }, "buildAssetMentionContext called");

  const mentions = metadata?.assetMentions;
  if (!mentions || mentions.length === 0) {
    logger.info("No asset mentions found in metadata");
    return null;
  }

  logger.info({ mentions }, "Building context for asset mentions");

  const lines = mentions.map((mention) => {
    const parts = [
      `• Asset: "${mention.name}"`,
      `  assetId: "${mention.id}"`,
      `  type: ${mention.type}`,
    ];
    if (mention.description) {
      parts.push(`  description: ${mention.description}`);
    }
    return parts.join("\n");
  });

  const context = [
    "━━━ REFERENCED ASSETS ━━━",
    "The user mentioned these assets. Use the assetId values below with watchAsset() or other tools:",
    "",
    ...lines,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");

  logger.info({ contextLength: context.length }, "Built asset mention context");
  return context;
}

/**
 * Inject attachment content parts and asset mention context into user messages
 *
 * This converts ChatAttachment metadata into actual content parts
 * that the ai SDK can convert to Gemini API format, and adds context
 * about @mentioned assets so the agent knows their actual assetIds.
 */
function injectAttachmentParts(
  messages: TimelineChatMessage[]
): TimelineChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;

    const metadata = message.metadata as ChatMessageMetadata | undefined;
    const attachments = metadata?.attachments;
    const assetMentionContext = buildAssetMentionContext(metadata);

    // If no attachments and no asset mentions, return as-is
    if ((!attachments || attachments.length === 0) && !assetMentionContext) {
      return message;
    }

    // Build attachment parts (media should come before text per Gemini best practices)
    const attachmentParts = (attachments ?? []).map((attachment) => {
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

    // Get existing parts; fallback to message.content (string) so we never send empty contents to Gemini
    const existingParts = (() => {
      if (Array.isArray(message.parts) && message.parts.length > 0) {
        return message.parts;
      }
      const content = (message as { content?: string }).content;
      if (typeof content === "string" && content.trim().length > 0) {
        return [{ type: "text" as const, text: content.trim() }];
      }
      return [];
    })();

    // Add asset mention context as a text part if present
    const contextParts = assetMentionContext
      ? [{ type: "text" as const, text: assetMentionContext }]
      : [];

    // Combine: attachments first, then context, then existing parts (per Gemini best practices)
    const parts = [...attachmentParts, ...contextParts, ...existingParts];
    // Gemini requires at least one part per user message; avoid empty contents
    const safeParts =
      parts.length > 0 ? parts : [{ type: "text" as const, text: " " }];

    return {
      ...message,
      parts: safeParts,
    };
  });
}

// Load base system prompt from file
const BASE_SYSTEM_PROMPT = (() => {
  try {
    const promptPath = join(process.cwd(), "app/lib/server/prompts/chat-system.txt");
    return readFileSync(promptPath, "utf-8");
  } catch {
    throw new Error("System prompt file not found");
  }
})();

function createSystemPrompt(currentMode: ChatMode) {
  return [
    BASE_SYSTEM_PROMPT,
    "",
    `The current mode for this turn is: ${currentMode.toUpperCase()}.`,
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
