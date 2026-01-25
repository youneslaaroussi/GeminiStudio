"use client";

import { FormEvent, useMemo, useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ChatMode,
  TaskListSnapshot,
  TimelineChatMessage,
} from "@/app/types/chat";
import { MemoizedMarkdown } from "../MemoizedMarkdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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

const MODE_OPTIONS: { value: ChatMode; label: string; description: string }[] = [
  {
    value: "ask",
    label: "Ask",
    description: "Answer directly without using tools.",
  },
  {
    value: "agent",
    label: "Agent",
    description: "Full tool access for autonomous help.",
  },
  {
    value: "plan",
    label: "Plan",
    description: "Only planning tools to build task lists.",
  },
];

const MODE_DETAILS: Record<ChatMode, string> = {
  ask: "Ask mode keeps things conversational and tool-free.",
  agent: "Agent mode lets the assistant call any tool.",
  plan: "Plan mode limits the assistant to planning tools for task breakdowns.",
};

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Done",
};

const TASK_STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-amber-200/60 text-amber-900",
  completed: "bg-emerald-200/70 text-emerald-900",
};

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatMode>("agent");
  const [isTaskPanelOpen, setIsTaskPanelOpen] = useState(true);

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

  const taskListSnapshot = useMemo(
    () => deriveTaskListSnapshot(messages),
    [messages]
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    sendMessage({ text: trimmed, metadata: { mode } });
    setInput("");
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

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              AI Assistant
            </h2>
            <p className="text-xs text-muted-foreground">
              Gemini 3 Pro with tool insights
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex flex-col text-right">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Mode
            </span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as ChatMode)}
              className="rounded-md border border-border bg-background/80 px-2 py-1 text-xs font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {MODE_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  title={option.description}
                >
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-muted-foreground">
              {MODE_DETAILS[mode]}
            </span>
          </label>
          <button
            onClick={handleExportChat}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
            title="Export Chat History"
          >
            <Download className="size-4" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto space-y-4 p-4 text-sm">
        {taskListSnapshot && (
          <div className="sticky top-0 z-10">
            <TaskListPanel
              snapshot={taskListSnapshot}
              open={isTaskPanelOpen}
              onOpenChange={setIsTaskPanelOpen}
            />
          </div>
        )}

        {!hasMessages && (
          <p className="text-xs text-muted-foreground text-center">
            Ask the assistant anything about your project. Try &quot;What is the
            current timeline duration?&quot;
          </p>
        )}

        {messages?.map((message) => {
          const parts = Array.isArray(message.parts) ? message.parts : [];
          return (
            <div key={message.id} className="space-y-2">
              <p className="text-xs uppercase text-muted-foreground tracking-wide">
                {renderRoleLabel(message.role)}
              </p>
              <div className="space-y-3 rounded-2xl border border-border/60 bg-card/90 p-4 shadow-sm">
                {parts.map((part, index) => {
                  const content = renderMessagePart(
                    part,
                    `${message.id}-${index}`
                  );
                  if (!content) return null;
                  return (
                    <div
                      key={`${message.id}-${index}`}
                      className={
                        part.type === "reasoning"
                          ? "rounded-xl bg-muted/40 p-3 text-sm leading-relaxed ring-1 ring-border/60"
                          : "leading-relaxed"
                      }
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
          <div className="space-y-2">
            <p className="text-xs uppercase text-muted-foreground tracking-wide">
              Assistant
            </p>
            <div className="space-y-2 rounded-2xl border border-border/60 bg-card/90 p-3 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Generating response…
              </div>
            </div>
          </div>
        )}
      </div>
      {error && (
        <div className="border-t border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <div className="flex justify-between gap-2">
            <p className="whitespace-pre-wrap">
              {error.message ?? "Failed to contact Gemini."}
            </p>
            <button
              type="button"
              className="font-medium underline decoration-dotted"
              onClick={() => clearError?.()}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="border-t border-border p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask the assistant…"
            className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={isBusy}
          />
          {isBusy ? (
            <button
              type="button"
              onClick={() => stop?.()}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/20"
            >
              <Square className="size-4 fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className={cn(
                "inline-flex items-center gap-1 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow",
                "hover:bg-primary/90 disabled:opacity-50"
              )}
            >
              <Send className="size-4" />
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function renderRoleLabel(role: string) {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Assistant";
    default:
      return role;
  }
}

type MessagePart = {
  type?: string;
  reasoning?: string;
  text?: string;
  [key: string]: unknown;
};

function renderMessagePart(part: MessagePart, key: string) {
  if (!part || typeof part !== "object") {
    return null;
  }

  if (part.type === "text") {
    if (!part.text) return null;
    return (
      <div className="prose prose-sm dark:prose-invert">
        <MemoizedMarkdown id={`${key}-text`} content={part.text} />
      </div>
    );
  }

  if (part.type === "reasoning" || part.type === "thinking") {
    if (!part.reasoning && !part.text) return null;
    return (
      <div className="text-xs text-muted-foreground italic">
        <MemoizedMarkdown
          id={`${key}-reasoning`}
          content={part.reasoning ?? part.text ?? ""}
        />
      </div>
    );
  }

  if (part.type === "step-start") {
    return null;
  }

  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return renderToolPart(part as ToolPart);
  }

  if (part.type === "step-start") {
    return <div className="border-t border-dashed border-border my-2" />;
  }

  return (
    <pre className="overflow-auto rounded bg-muted/40 p-2 text-xs text-muted-foreground">
      {JSON.stringify(part, null, 2)}
    </pre>
  );
}

function renderToolPart(part: ToolPart) {
  const label = part.type.replace(/^tool-/, "").replace(/-/g, " ");

  if (
    part.state === "output-available" &&
    typeof part.type === "string" &&
    part.type.startsWith("tool-plan") &&
    isPlanningToolOutput(part.output)
  ) {
    return (
      <PlanningToolOutputView
        label={label}
        payload={part.output}
      />
    );
  }

  switch (part.state) {
    case "input-streaming":
      return (
        <div className="text-xs text-muted-foreground italic">
          {label}: preparing input…
        </div>
      );
    case "input-available":
      return (
        <div className="rounded-xl bg-muted/30 p-3 text-xs text-muted-foreground ring-1 ring-border/50">
          <p className="font-medium text-foreground/80">{label}</p>
          <pre className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground/90">
            {JSON.stringify(part.input, null, 2)}
          </pre>
        </div>
      );
    case "output-available":
      return (
        <div className="rounded-xl bg-primary/5 p-3 text-xs text-foreground ring-1 ring-primary/20">
          <p className="font-medium text-primary">{label} result</p>
          <p className="mt-1 text-sm font-semibold text-primary">
            {formatToolOutput(part.output)}
          </p>
        </div>
      );
    case "output-error":
      return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {label} error: {part.errorText ?? "Unknown error"}
        </div>
      );
    case "approval-requested":
      return (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-800">
          {label}: approval required
        </div>
      );
    default:
      return null;
  }
}

function formatToolOutput(output: unknown) {
  if (typeof output === "string") return output;
  if (output == null) return "No output.";
  return JSON.stringify(output);
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
        snapshot = (part as ToolPart).output.taskList;
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

function PlanningToolOutputView({
  label,
  payload,
}: {
  label: string;
  payload: PlanningToolLikeOutput;
}) {
  const taskCount = payload.taskList.tasks.length;
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
      <p className="text-sm font-semibold text-primary">
        {payload.message ?? label}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {taskCount} task{taskCount === 1 ? "" : "s"} tracked.
      </p>
    </div>
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
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs shadow-sm backdrop-blur-sm"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-primary">
            Agent Task List
          </p>
          <p className="text-sm font-semibold text-foreground">
            {snapshot.title ?? "Project Plan"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Updated {formatUpdatedTime(snapshot.updatedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          <span>
            {completed}/{total} complete
          </span>
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              open ? "rotate-180" : "rotate-0"
            )}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3 data-[state=closed]:animate-collapse-up data-[state=open]:animate-collapse-down">
        <div className="h-1.5 rounded-full bg-primary/10">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <ul className="space-y-1.5">
          {snapshot.tasks.length === 0 ? (
            <li className="text-[11px] text-muted-foreground">
              No tasks yet. Ask the agent to start planning.
            </li>
          ) : (
            <>
              {snapshot.tasks.slice(0, 6).map((task) => (
                <li
                  key={task.id}
                  className="flex items-start gap-2 rounded-md border border-border/40 bg-card/80 p-2"
                >
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide",
                      TASK_STATUS_STYLES[task.status] ??
                        "bg-muted text-muted-foreground"
                    )}
                  >
                    {TASK_STATUS_LABELS[task.status] ?? task.status}
                  </span>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-foreground">
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="text-[11px] text-muted-foreground">
                        {task.description}
                      </p>
                    )}
                  </div>
                </li>
              ))}
              {total > 6 && (
                <li className="text-[11px] text-muted-foreground">
                  +{total - 6} more task{total - 6 === 1 ? "" : "s"} tracked
                </li>
              )}
            </>
          )}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function formatUpdatedTime(updatedAt: string) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
