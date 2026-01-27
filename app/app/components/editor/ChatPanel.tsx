"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import {
  Bot,
  Loader2,
  Send,
  Square,
  Download,
  ChevronDown,
  ChevronRight,
  Sparkles,
  MessageSquare,
  ListTodo,
  Paperclip,
  X,
  Image as ImageIcon,
  FileVideo,
  FileAudio,
  FileText,
  File as FileIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { z } from "zod";
import type {
  ChatAttachment,
  ChatMode,
  TaskListSnapshot,
  TimelineChatMessage,
} from "@/app/types/chat";
import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import { MemoizedMarkdown } from "../MemoizedMarkdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toolRegistry, executeTool } from "@/app/lib/tools/tool-registry";
import type {
  ToolDefinition,
  ToolExecutionResult,
} from "@/app/lib/tools/types";
import type { Project } from "@/app/types/timeline";
import { useProjectStore } from "@/app/lib/store/project-store";

type ToolPartState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "approval-requested";

interface ToolPart {
  type: string;
  toolCallId: string;
  state: ToolPartState;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
  approval?: { id: string };
}

const MODE_OPTIONS: { value: ChatMode; label: string; description: string }[] =
  [
    {
      value: "ask",
      label: "Ask",
      description: "Direct answers without tools",
    },
    {
      value: "agent",
      label: "Agent",
      description: "Full tool access",
    },
    {
      value: "plan",
      label: "Plan",
      description: "Task planning only",
    },
  ];

const TASK_STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  completed: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
};

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("agent");
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(true);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef(`chat-${Date.now()}`).current;

  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { mode },
      }),
    [mode]
  );

  const { messages, sendMessage, status, error, clearError, stop } =
    useChat<TimelineChatMessage>({
      transport: chatTransport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    });

  const isBusy = status === "submitted" || status === "streaming";
  const hasMessages = messages && messages.length > 0;

  // Handle file selection and upload
  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      setIsUploadingAttachments(true);
      try {
        const formData = new FormData();
        formData.append("sessionId", sessionId);
        for (const file of files) {
          formData.append("files", file);
        }

        const response = await fetch("/api/chat/attachments", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          console.error("Failed to upload attachments:", error);
          return;
        }

        const { attachments } = (await response.json()) as {
          attachments: ChatAttachment[];
        };
        setPendingAttachments((prev) => [...prev, ...attachments]);
      } catch (error) {
        console.error("Failed to upload attachments:", error);
      } finally {
        setIsUploadingAttachments(false);
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [sessionId]
  );

  const removeAttachment = useCallback((attachmentId: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }, []);

  const taskListSnapshot = useMemo(
    () => deriveTaskListSnapshot(messages),
    [messages]
  );
  const project = useProjectStore((state) => state.project);
  const toolboxTools = useMemo(() => toolRegistry.list(), []);
  const clientToolMap = useMemo(() => {
    const entries = new Map<string, ToolDefinition<z.ZodTypeAny, Project>>();
    for (const tool of toolboxTools) {
      if (tool.runLocation === "client") {
        entries.set(tool.name, tool);
      }
    }
    return entries;
  }, [toolboxTools]);
  const handledToolCalls = useRef<Set<string>>(new Set());

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isBusy]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed && pendingAttachments.length === 0) return;

    sendMessage({
      text: trimmed || (pendingAttachments.length > 0 ? "Please analyze these files." : ""),
      metadata: {
        mode,
        attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
      },
    });
    setInput("");
    setPendingAttachments([]);
  };

  const handleExportChat = () => {
    if (!messages || messages.length === 0) return;

    const data = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        activeMode: mode,
        taskList: taskListSnapshot,
        messages,
      },
      null,
      2
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const submitClientToolResult = useCallback(
    async (payload: { toolCallId: string; result: ToolExecutionResult }) => {
      await fetch("/api/chat/tool-callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    },
    []
  );

  const runClientToolForCall = useCallback(
    async (options: {
      toolName: string;
      toolCallId: string;
      input: Record<string, unknown>;
    }) => {
      try {
        const result = await executeTool({
          toolName: options.toolName,
          input: options.input,
          context: { project },
        });
        await submitClientToolResult({
          toolCallId: options.toolCallId,
          result,
        });
      } catch (error) {
        const err =
          error instanceof Error
            ? error
            : new Error("Client tool execution failed.");
        await submitClientToolResult({
          toolCallId: options.toolCallId,
          result: {
            status: "error",
            error: err.message,
          },
        });
      }
    },
    [project, submitClientToolResult]
  );

  useEffect(() => {
    if (!messages || messages.length === 0) return;
    for (const message of messages) {
      const parts = Array.isArray(message.parts) ? message.parts : [];
      for (const rawPart of parts) {
        const part = rawPart as ToolPart | null;
        if (
          !part ||
          typeof part !== "object" ||
          typeof part.type !== "string" ||
          !part.type.startsWith("tool-") ||
          part.state !== "input-available" ||
          typeof part.toolCallId !== "string"
        ) {
          continue;
        }
        const toolName = part.type.replace("tool-", "");
        if (!clientToolMap.has(toolName)) continue;
        if (handledToolCalls.current.has(part.toolCallId)) continue;
        handledToolCalls.current.add(part.toolCallId);
        void runClientToolForCall({
          toolName,
          toolCallId: part.toolCallId,
          input: (part.input as Record<string, unknown>) ?? {},
        });
      }
    }
  }, [messages, clientToolMap, runClientToolForCall]);

  return (
    <div className="flex h-full flex-col">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        {/* Task List (sticky at top when present) */}
        {taskListSnapshot && (
          <div className="sticky top-0 z-10 p-3 bg-gradient-to-b from-card via-card to-transparent pb-6">
            <TaskListPanel
              snapshot={taskListSnapshot}
              open={isTaskPanelOpen}
              onOpenChange={setIsTaskPanelOpen}
            />
          </div>
        )}

        <div className="px-3 pb-3 space-y-3">
          {!hasMessages && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <Sparkles className="size-6 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">
                How can I help?
              </p>
              <p className="text-xs text-muted-foreground max-w-[200px]">
                Ask about your project, generate content, or let me help edit
                your timeline.
              </p>
            </div>
          )}

          {messages?.map((message) => {
            const parts = Array.isArray(message.parts) ? message.parts : [];
            const isUser = message.role === "user";
            const metadata = message.metadata as { attachments?: ChatAttachment[] } | undefined;
            const attachments = metadata?.attachments;
            return (
              <div
                key={message.id}
                className={cn("flex", isUser ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                    isUser
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60"
                  )}
                >
                  {/* Show attachments first */}
                  {attachments && attachments.length > 0 && (
                    <MessageAttachments attachments={attachments} isUser={isUser} />
                  )}
                  {parts.map((part, index) => {
                    const content = renderMessagePart(
                      part,
                      `${message.id}-${index}`,
                      isUser
                    );
                    if (!content) return null;
                    return (
                      <div
                        key={`${message.id}-${index}`}
                        className={cn(
                          part.type === "reasoning" &&
                            "text-xs opacity-70 italic mb-2"
                        )}
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {isBusy && (
            <div className="flex justify-start">
              <div className="bg-muted/60 rounded-2xl px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span>Thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate">{error.message ?? "Something went wrong"}</p>
            <button
              type="button"
              className="shrink-0 font-medium hover:underline"
              onClick={() => clearError?.()}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-border p-3 space-y-2">
        {/* Mode Selector + Export */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex rounded-lg bg-muted/50 p-0.5">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  mode === option.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title={option.description}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleExportChat}
            disabled={!hasMessages}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50"
            title="Export chat"
          >
            <Download className="size-4" />
          </button>
        </div>

        {/* Pending Attachments Preview */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-2">
            {pendingAttachments.map((attachment) => (
              <AttachmentPreview
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
          </div>
        )}

        {/* Message Input */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.txt"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Attachment button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy || isUploadingAttachments}
            className="shrink-0 rounded-lg border border-border bg-background px-2.5 py-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            title="Attach files"
          >
            {isUploadingAttachments ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
          </button>

          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              pendingAttachments.length > 0
                ? "Add a message or send files..."
                : mode === "ask"
                  ? "Ask a question..."
                  : mode === "plan"
                    ? "Describe what to plan..."
                    : "What would you like to do?"
            }
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            disabled={isBusy}
          />
          {isBusy ? (
            <button
              type="button"
              onClick={() => stop?.()}
              className="shrink-0 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-destructive hover:bg-destructive/20 transition-colors"
            >
              <Square className="size-4 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() && pendingAttachments.length === 0}
              className="shrink-0 rounded-lg bg-primary px-3 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Send className="size-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

type MessagePart = {
  type?: string;
  reasoning?: string;
  text?: string;
  [key: string]: unknown;
};

function renderMessagePart(part: MessagePart, key: string, isUser: boolean) {
  if (!part || typeof part !== "object") {
    return null;
  }

  if (part.type === "text") {
    if (!part.text) return null;
    return (
      <div className={cn("prose prose-sm max-w-none", isUser && "prose-invert")}>
        <MemoizedMarkdown id={`${key}-text`} content={part.text} />
      </div>
    );
  }

  if (part.type === "reasoning" || part.type === "thinking") {
    if (!part.reasoning && !part.text) return null;
    return (
      <MemoizedMarkdown
        id={`${key}-reasoning`}
        content={part.reasoning ?? part.text ?? ""}
      />
    );
  }

  if (part.type === "step-start") {
    return null;
  }

  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return renderToolPart(part as unknown as ToolPart);
  }

  return null;
}

function renderToolPart(part: ToolPart) {
  const label = resolveToolLabel(part.type);

  if (
    part.state === "output-available" &&
    typeof part.type === "string" &&
    part.type.startsWith("tool-plan") &&
    isPlanningToolOutput(part.output)
  ) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1.5 py-1">
        <ListTodo className="size-3.5" />
        <span>Updated task list</span>
      </div>
    );
  }

  switch (part.state) {
    case "input-streaming":
      return (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5 py-1">
          <Loader2 className="size-3 animate-spin" />
          <span>{label}...</span>
        </div>
      );
    case "input-available":
      return (
        <ToolCallCard label={label} status="running" input={part.input} />
      );
    case "output-available":
      return (
        <ToolCallCard
          label={label}
          status="success"
          input={part.input}
          output={part.output}
        />
      );
    case "output-error":
      return (
        <ToolCallCard
          label={label}
          status="error"
          input={part.input}
          error={part.errorText}
        />
      );
    case "approval-requested":
      return (
        <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 py-1">
          <span>{label}: approval required</span>
        </div>
      );
    default:
      return null;
  }
}

function ToolCallCard({
  label,
  status,
  input,
  output,
  error,
}: {
  label: string;
  status: "running" | "success" | "error";
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2 rounded-lg border border-border/60 bg-background/80 text-xs overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/30 transition-colors text-left"
      >
        {status === "running" && (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        )}
        {status === "success" && (
          <div className="size-3.5 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <div className="size-1.5 rounded-full bg-emerald-500" />
          </div>
        )}
        {status === "error" && (
          <div className="size-3.5 rounded-full bg-destructive/20 flex items-center justify-center">
            <div className="size-1.5 rounded-full bg-destructive" />
          </div>
        )}
        <span className="font-medium flex-1 truncate">{label}</span>
        {expanded ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2 border-t border-border/40 pt-2">
          {input && Object.keys(input).length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Input
              </p>
              <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-auto max-h-32">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {status === "error" && error && (
            <p className="text-destructive">{error}</p>
          )}
          {status === "success" && (output as any) && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Output
              </p>
              <div className="bg-muted/40 rounded p-2 overflow-auto max-h-48">
                {renderToolResultBody(output)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function resolveToolLabel(partType: string) {
  if (partType.startsWith("tool-")) {
    const toolName = partType.replace("tool-", "");
    const definition = toolRegistry.get(toolName);
    if (definition) {
      return definition.label;
    }
  }
  return partType.replace(/^tool-/, "").replace(/-/g, " ");
}

function renderToolResultBody(output: unknown) {
  if (!isToolResultOutput(output)) {
    if (!output)
      return <p className="text-muted-foreground text-[11px]">No output</p>;
    return (
      <pre className="text-[11px] overflow-auto">
        {JSON.stringify(output, null, 2)}
      </pre>
    );
  }

  switch (output.type) {
    case "text":
      return (
        <div className="prose prose-sm max-w-none text-[11px]">
          <MemoizedMarkdown id="tool-output-text" content={output.value} />
        </div>
      );
    case "json":
      return (
        <pre className="text-[11px] overflow-auto">
          {JSON.stringify(output.value, null, 2)}
        </pre>
      );
    case "error-text":
    case "execution-denied":
      return (
        <p className="text-destructive text-[11px]">
          {output.type === "error-text"
            ? output.value
            : output.reason ?? "Execution denied"}
        </p>
      );
    case "error-json":
      return (
        <pre className="text-destructive text-[11px] overflow-auto">
          {JSON.stringify(output.value, null, 2)}
        </pre>
      );
    case "content":
      return (
        <div className="space-y-2">
          {output.value.map((entry, index) => (
            <div key={index}>{renderContentEntry(entry, index)}</div>
          ))}
        </div>
      );
    default:
      return (
        <pre className="text-[11px] overflow-auto">
          {JSON.stringify(output, null, 2)}
        </pre>
      );
  }
}

type ContentEntry = Extract<
  ToolResultOutput,
  { type: "content" }
>["value"][number];

function renderContentEntry(entry: ContentEntry, key: number) {
  switch (entry.type) {
    case "text":
      return (
        <MemoizedMarkdown id={`tool-output-text-${key}`} content={entry.text} />
      );
    case "image-data": {
      const src = `data:${entry.mediaType};base64,${entry.data}`;
      return (
        <img
          src={src}
          alt="Tool output"
          className="max-h-48 w-auto rounded border border-border/40"
        />
      );
    }
    case "image-url":
      return (
        <img
          src={entry.url}
          alt="Tool output"
          className="max-h-48 w-auto rounded border border-border/40"
        />
      );
    case "file-data": {
      const href = `data:${entry.mediaType};base64,${entry.data}`;
      return (
        <a
          href={href}
          download={entry.filename ?? "download"}
          className="text-primary underline"
        >
          Download {entry.filename ?? "file"}
        </a>
      );
    }
    case "file-url":
      return (
        <a
          href={entry.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          Download file
        </a>
      );
    case "media": {
      const href = `data:${entry.mediaType};base64,${entry.data}`;
      return <audio controls src={href} className="w-full h-8" />;
    }
    default:
      return (
        <pre className="text-[11px] overflow-auto">
          {JSON.stringify(entry, null, 2)}
        </pre>
      );
  }
}

function isToolResultOutput(value: unknown): value is ToolResultOutput {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

function deriveTaskListSnapshot(
  messages?: TimelineChatMessage[]
): TaskListSnapshot | null {
  if (!messages) return null;
  let snapshot: TaskListSnapshot | null = null;

  for (const message of messages) {
    const parts = Array.isArray(message.parts) ? message.parts : [];
    for (const part of parts) {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        typeof part.type === "string" &&
        part.type.startsWith("tool-plan") &&
        (part as ToolPart).state === "output-available" &&
        isPlanningToolOutput((part as ToolPart).output)
      ) {
        snapshot = ((part as ToolPart).output as any).taskList;
      }
    }
  }

  return snapshot;
}

type PlanningToolLikeOutput = {
  action?: string;
  message?: string;
  taskList: TaskListSnapshot;
};

function isPlanningToolOutput(
  value: unknown
): value is PlanningToolLikeOutput {
  if (!value || typeof value !== "object") return false;
  const maybe = value as PlanningToolLikeOutput;
  return (
    typeof maybe === "object" &&
    typeof maybe.taskList === "object" &&
    Array.isArray(maybe.taskList.tasks)
  );
}

function TaskListPanel({
  snapshot,
  open,
  onOpenChange,
}: {
  snapshot: TaskListSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const total = snapshot.tasks.length;
  const completed = snapshot.tasks.filter(
    (task) => task.status === "completed"
  ).length;
  const inProgress = snapshot.tasks.find(
    (task) => task.status === "in_progress"
  );
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-xl border border-border bg-card shadow-sm"
    >
      <CollapsibleTrigger className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/30 transition-colors">
        <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <ListTodo className="size-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {snapshot.title ?? "Task List"}
          </p>
          <p className="text-xs text-muted-foreground">
            {completed}/{total} complete
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform shrink-0",
            open && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 space-y-2">
          {/* Progress bar */}
          <div className="h-1 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>

          {/* Current task highlight */}
          {inProgress && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5">
              <Loader2 className="size-3.5 animate-spin text-amber-500" />
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400 truncate">
                {inProgress.title}
              </span>
            </div>
          )}

          {/* Task list */}
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {snapshot.tasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
                  task.status === "completed" && "opacity-60"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full shrink-0",
                    task.status === "completed" && "bg-emerald-500",
                    task.status === "in_progress" && "bg-amber-500",
                    task.status === "pending" && "bg-muted-foreground/40"
                  )}
                />
                <span
                  className={cn(
                    "truncate",
                    task.status === "completed" && "line-through"
                  )}
                >
                  {task.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Attachment preview component for pending attachments
function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachment;
  onRemove?: () => void;
}) {
  const Icon = getAttachmentIcon(attachment.category);

  return (
    <div className="relative group flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2 py-1.5 text-xs">
      <Icon className="size-4 text-muted-foreground shrink-0" />
      <span className="truncate max-w-[120px]" title={attachment.name}>
        {attachment.name}
      </span>
      <span className="text-muted-foreground shrink-0">
        {formatFileSize(attachment.size)}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 rounded-full p-0.5 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// Message attachments display component
function MessageAttachments({
  attachments,
  isUser,
}: {
  attachments: ChatAttachment[];
  isUser: boolean;
}) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((attachment) => (
        <AttachmentDisplay key={attachment.id} attachment={attachment} isUser={isUser} />
      ))}
    </div>
  );
}

// Individual attachment display in messages
function AttachmentDisplay({
  attachment,
  isUser,
}: {
  attachment: ChatAttachment;
  isUser: boolean;
}) {
  const Icon = getAttachmentIcon(attachment.category);
  const previewUrl = attachment.signedUrl || attachment.localUrl;

  // For images, show thumbnail
  if (attachment.category === "image" && previewUrl) {
    return (
      <div className="rounded-lg overflow-hidden border border-border/50 max-w-[200px]">
        <img
          src={previewUrl}
          alt={attachment.name}
          className="max-h-32 w-auto object-cover"
        />
        <div className={cn(
          "px-2 py-1 text-[10px] truncate",
          isUser ? "bg-primary-foreground/10" : "bg-muted/50"
        )}>
          {attachment.name}
        </div>
      </div>
    );
  }

  // For video, show with play icon
  if (attachment.category === "video" && previewUrl) {
    return (
      <div className="rounded-lg overflow-hidden border border-border/50 max-w-[200px]">
        <video
          src={previewUrl}
          className="max-h-32 w-auto"
          controls
          preload="metadata"
        />
        <div className={cn(
          "px-2 py-1 text-[10px] truncate",
          isUser ? "bg-primary-foreground/10" : "bg-muted/50"
        )}>
          {attachment.name}
        </div>
      </div>
    );
  }

  // For audio, show player
  if (attachment.category === "audio" && previewUrl) {
    return (
      <div className={cn(
        "rounded-lg border border-border/50 p-2 space-y-1",
        isUser ? "bg-primary-foreground/10" : "bg-muted/50"
      )}>
        <div className="flex items-center gap-2 text-xs">
          <Icon className="size-4 shrink-0" />
          <span className="truncate max-w-[150px]">{attachment.name}</span>
        </div>
        <audio src={previewUrl} controls className="w-full h-8" preload="metadata" />
      </div>
    );
  }

  // Default file display
  return (
    <a
      href={previewUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-xs hover:bg-muted/30 transition-colors",
        isUser ? "bg-primary-foreground/10" : "bg-muted/50"
      )}
    >
      <Icon className="size-4 shrink-0" />
      <div className="min-w-0">
        <p className="truncate max-w-[150px] font-medium">{attachment.name}</p>
        <p className="text-muted-foreground">{formatFileSize(attachment.size)}</p>
      </div>
    </a>
  );
}

function getAttachmentIcon(category: ChatAttachment["category"]) {
  switch (category) {
    case "image":
      return ImageIcon;
    case "video":
      return FileVideo;
    case "audio":
      return FileAudio;
    case "document":
      return FileText;
    default:
      return FileIcon;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
