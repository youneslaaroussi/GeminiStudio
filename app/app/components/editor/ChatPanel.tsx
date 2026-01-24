"use client";

import { FormEvent, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { Bot, Loader2, Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineChatMessage } from "@/app/types/chat";
import { MemoizedMarkdown } from "../MemoizedMarkdown";

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

export function ChatPanel() {
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, error, clearError, stop } =
    useChat<TimelineChatMessage>({
      transport: new DefaultChatTransport({
        api: "/api/chat",
      }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    });

  const isBusy = status === "submitted" || status === "streaming";

  const hasMessages = messages && messages.length > 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    sendMessage({ text: trimmed });
    setInput("");
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
      </div>

      <div className="relative flex-1 overflow-auto space-y-4 p-4 text-sm">
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
    return renderToolPart(part as ToolPart, key);
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

function renderToolPart(part: ToolPart, key: string) {
  const label = part.type.replace(/^tool-/, "").replace(/-/g, " ");

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
