import { randomUUID } from "crypto";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import type {
  ChatMessageMetadata,
  ChatMode,
  PlanningToolTaskInput,
  TaskListItem,
  TaskListSnapshot,
  TimelineChatMessage,
} from "@/app/types/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GENERAL_TOOLS = {
  getDate: tool({
    description: "Get the current date in ISO format.",
    inputSchema: z.object({
      locale: z
        .string()
        .optional()
        .describe("Optional locale for formatting"),
    }),
    async execute({ locale }) {
      const now = new Date();
      return locale
        ? now.toLocaleDateString(locale)
        : now.toISOString().split("T")[0];
    },
  }),
  getTime: tool({
    description: "Get the current time in HH:MM:SS format.",
    inputSchema: z.object({
      locale: z
        .string()
        .optional()
        .describe("Optional locale or time zone identifier."),
    }),
    async execute({ locale }) {
      const now = new Date();
      return locale
        ? now.toLocaleTimeString(locale, { hour12: false })
        : now.toISOString().split("T")[1].split(".")[0];
    },
  }),
} as const;

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
    };
    return {
      ...message,
      metadata: nextMetadata,
    };
  }) as TimelineChatMessage[];

  const activeMode = determineActiveMode(messagesWithMetadata, fallbackMode);

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

  const planningTools = createPlanningTools(chatId);
  const tools =
    activeMode === "ask"
      ? undefined
      : activeMode === "agent"
        ? { ...GENERAL_TOOLS, ...planningTools }
        : planningTools;

  const result = streamText({
    model: google("gemini-3-pro-preview"),
    providerOptions: {
      google: {
        thinkingConfig: {
          includeThoughts: true,
        },
      },
    },
    messages: await convertToModelMessages([
      systemMessage,
      ...messagesWithMetadata,
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

function createSystemPrompt(currentMode: ChatMode) {
  return [
    "You are the Gemini Studio AI assistant that collaborates with a user while editing creative timelines.",
    "You operate with three explicit modes and you must honor their constraints:",
    `- ${MODE_DESCRIPTIONS.ask}`,
    `- ${MODE_DESCRIPTIONS.agent}`,
    `- ${MODE_DESCRIPTIONS.plan}`,
    "",
    `The current mode for this turn is: ${currentMode.toUpperCase()}.`,
    "When in Ask Mode you must not call any tool and simply answer clearly.",
    "When in Agent Mode you may call any available tool to gather data, reflect, or take action on behalf of the user.",
    "When in Plan Mode you are limited to the planning tools. Use them to create, update, and maintain the shared task list so the user can see progress. Do not execute other tools while planning.",
    "Always explain how the selected mode influenced your response.",
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

function createPlanningTools(chatId: string) {
  return {
    planCreateTaskList: tool({
      description:
        "Create or overwrite the current task list with the provided tasks.",
      inputSchema: z.object({
        title: z.string().min(1).max(160).optional(),
        tasks: z.array(planningTaskInputSchema),
      }),
      async execute({ title, tasks }) {
        const normalized = tasks.map(normalizeTask);
        const snapshot = persistTaskList(chatId, { title, tasks: normalized });
        return {
          action: "task-list-created",
          message: `Created ${normalized.length} task(s).`,
          taskList: snapshot,
        };
      },
    }),
    planAddTask: tool({
      description: "Add a task to the current plan.",
      inputSchema: z.object({
        task: planningTaskInputSchema,
      }),
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
        };
      },
    }),
    planUpdateTask: tool({
      description: "Update a task's title, description, or status.",
      inputSchema: z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(160).optional(),
        description: z.string().max(500).optional(),
        status: planningTaskStatus.optional(),
      }),
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
        };
      },
    }),
    planRemoveTask: tool({
      description: "Remove a task from the current plan.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
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
        };
      },
    }),
    planResetTaskList: tool({
      description: "Clear every task to start fresh while keeping the title.",
      inputSchema: z.object({
        title: z.string().min(1).max(160).optional(),
      }),
      async execute({ title }) {
        const snapshot = persistTaskList(chatId, {
          title: title ?? ensureTaskList(chatId).title,
          tasks: [],
        });
        return {
          action: "task-list-reset",
          message: "Cleared the task list.",
          taskList: snapshot,
        };
      },
    }),
  };
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
