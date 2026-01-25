"use client";

import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { Wrench, PlayIcon, History, ListChecks } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { toolRegistry, executeTool } from "@/app/lib/tools/tool-registry";
import type { ToolDefinition, ToolOutput } from "@/app/lib/tools/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useToolboxStore } from "@/app/lib/store/toolbox-store";

type ToolFormValues = Record<string, string>;

interface HistoryEntry {
  id: string;
  toolName: string;
  startedAt: number;
  durationMs: number;
  status: "success" | "error";
  inputSnapshot: Record<string, unknown>;
  outputs?: ToolOutput[];
  error?: string;
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function ToolboxPanel() {
  const tools = useMemo(() => toolRegistry.list(), []);
  const project = useProjectStore((state) => state.project);
  const currentTime = useProjectStore((state) => state.currentTime);
  const capturedAssets = useToolboxStore((state) => state.capturedAssets);

  const [selectedTool, setSelectedTool] = useState<ToolDefinition | null>(
    () => tools[0] ?? null
  );
  const [formState, setFormState] = useState<Record<string, ToolFormValues>>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const activeToolForm = selectedTool
    ? formState[selectedTool.name] ?? {}
    : {};

  const handleFieldChange = useCallback(
    (toolName: string, field: string, value: string) => {
      setFormState((prev) => ({
        ...prev,
        [toolName]: {
          ...(prev[toolName] ?? {}),
          [field]: value,
        },
      }));
    },
    []
  );

  const computeDefaultValue = useCallback(
    (fieldName: string, fallback?: string) => {
      if (fieldName === "timecode") {
        return currentTime.toFixed(2);
      }
      return fallback ?? "";
    },
    [currentTime]
  );

  const handleSelectTool = useCallback((tool: ToolDefinition) => {
    setSelectedTool(tool);
    setLastError(null);
  }, []);

  const resetForm = useCallback(() => {
    if (!selectedTool) return;
    setFormState((prev) => {
      const defaults: ToolFormValues = {};
      selectedTool.fields.forEach((field) => {
        defaults[field.name] = computeDefaultValue(
          field.name,
          field.defaultValue
        );
      });
      return {
        ...prev,
        [selectedTool.name]: defaults,
      };
    });
    setLastError(null);
  }, [computeDefaultValue, selectedTool]);

  const parsedFormInput = useMemo(() => {
    if (!selectedTool) return {};
    const values = formState[selectedTool.name] ?? {};
    const result: Record<string, unknown> = {};
    selectedTool.fields.forEach((field) => {
      const raw = values[field.name];
      if (raw == null || raw === "") return;
      switch (field.type) {
        case "number":
          result[field.name] = Number(raw);
          break;
        case "select":
          if (raw === "true") {
            result[field.name] = true;
          } else if (raw === "false") {
            result[field.name] = false;
          } else {
            result[field.name] = raw;
          }
          break;
        case "json":
          try {
            result[field.name] = JSON.parse(raw);
          } catch {
            result[field.name] = raw;
          }
          break;
        default:
          result[field.name] = raw;
      }
    });
    return result;
  }, [formState, selectedTool]);

  const handleRunTool = useCallback(async () => {
    if (!selectedTool) return;
    setIsRunning(true);
    setLastError(null);
    const start = performance.now();
    const result = await executeTool({
      toolName: selectedTool.name,
      input: parsedFormInput,
      context: { project },
    });
    const durationMs = performance.now() - start;
    const entry: HistoryEntry = {
      id: createId(),
      durationMs,
      startedAt: Date.now(),
      status: result.status,
      toolName: selectedTool.name,
      inputSnapshot: parsedFormInput,
      outputs: result.status === "success" ? result.outputs : undefined,
      error: result.status === "error" ? result.error : undefined,
    };
    setHistory((prev) => [entry, ...prev]);
    if (result.status === "error") {
      setLastError(result.error);
    }
    setIsRunning(false);
  }, [parsedFormInput, project, selectedTool]);

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Wrench className="size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Toolbox</h2>
            <p className="text-xs text-muted-foreground">
              {tools.length} tools • {capturedAssets.length} captured assets
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={resetForm}
          disabled={!selectedTool}
        >
          Refresh form
        </Button>
      </div>

      <div className="flex flex-1 min-h-0 divide-x divide-border">
        <aside className="w-52 overflow-y-auto">
          <div className="space-y-1 p-2">
            {tools.map((tool) => (
              <button
                key={tool.name}
                type="button"
                onClick={() => handleSelectTool(tool)}
                className={cn(
                  "w-full rounded-md border border-transparent px-3 py-2 text-left text-sm transition hover:bg-muted/40",
                  selectedTool?.name === tool.name
                    ? "border-primary bg-primary/10 text-primary-foreground"
                    : "text-foreground"
                )}
              >
                <p className="font-medium">{tool.label}</p>
                <p className="text-xs text-muted-foreground">
                  {tool.description}
                </p>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex flex-1 min-w-0 flex-col">
          <div className="border-b border-border p-4 space-y-4">
            {selectedTool ? (
              <>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Configure and run <span className="font-semibold">{selectedTool.label}</span>
                  </p>
                </div>
                {selectedTool.fields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    This tool does not require any parameters. Hit run when
                    you&apos;re ready.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {selectedTool.fields.map((field) => {
                      const value =
                        activeToolForm[field.name] ??
                        computeDefaultValue(field.name, field.defaultValue);
                      const commonProps = {
                        id: `${selectedTool.name}-${field.name}`,
                        value,
                        onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                          handleFieldChange(
                            selectedTool.name,
                            field.name,
                            event.target.value
                          ),
                      };
                      return (
                        <div key={field.name} className="space-y-1.5">
                          <label
                            htmlFor={commonProps.id}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            {field.label}
                          </label>
                          {renderField(field, commonProps)}
                          {field.description && (
                            <p className="text-[11px] text-muted-foreground">
                              {field.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {lastError && (
                  <p className="text-xs text-destructive">{lastError}</p>
                )}
                <Button
                  type="button"
                  className="inline-flex items-center"
                  disabled={isRunning || !selectedTool}
                  onClick={handleRunTool}
                >
                  <PlayIcon className="size-4" />
                  {isRunning ? "Running..." : "Run tool"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a tool from the list to begin.
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center gap-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <History className="size-3.5" />
              Execution history
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No tool runs yet. Executions will be logged here with their outputs.
              </p>
            ) : (
              <div className="space-y-3">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border/80 bg-background/80 p-3 text-sm shadow-sm"
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5 font-medium">
                        <ListChecks className="size-3.5" />
                        {entry.toolName}
                      </div>
                      <span>
                        {(entry.durationMs / 1000).toFixed(2)}s •{" "}
                        {new Date(entry.startedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mt-2 text-xs">
                      Status:{" "}
                      <span
                        className={
                          entry.status === "success"
                            ? "text-emerald-500"
                            : "text-destructive"
                        }
                      >
                        {entry.status}
                      </span>
                    </div>
                    {entry.status === "error" && entry.error && (
                      <p className="mt-1 text-xs text-destructive">
                        {entry.error}
                      </p>
                    )}
                    {entry.outputs && entry.outputs.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {entry.outputs.map((output, index) => (
                          <ToolOutputView
                            key={`${entry.id}-${index}`}
                            output={output}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function renderField(
  field: ToolDefinition["fields"][number],
  props: {
    id: string;
    value: string;
    onChange: (
      event: ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >
    ) => void;
  }
) {
  switch (field.type) {
    case "textarea":
      return <Textarea {...props} rows={3} />;
    case "number":
      return <Input {...props} type="number" step="0.01" />;
    case "json":
      return <Textarea {...props} rows={4} spellCheck={false} />;
    case "datetime":
      return <Input {...props} type="datetime-local" />;
    case "select":
      return (
        <select
          {...props}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    default:
      return <Input {...props} type="text" />;
  }
}

function ToolOutputView({ output }: { output: ToolOutput }) {
  switch (output.type) {
    case "text":
      return (
        <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          {output.text}
        </p>
      );
    case "json":
      return (
        <pre className="overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed">
          {JSON.stringify(output.data, null, 2)}
        </pre>
      );
    case "image":
      return (
        <div className="rounded-md border border-border/70 bg-background p-2">
          <Image
            src={output.url}
            alt={output.alt ?? "Tool output"}
            width={output.width ?? 640}
            height={output.height ?? 360}
            className="h-auto w-full rounded object-cover"
          />
        </div>
      );
    case "list":
      return (
        <div className="space-y-1 rounded-md border border-border/70 p-2">
          {output.title && (
            <p className="text-xs font-medium text-muted-foreground">
              {output.title}
            </p>
          )}
          <ul className="space-y-1 text-xs text-muted-foreground">
            {output.items.map((item, index) => (
              <li
                key={index}
                className="rounded bg-muted/40 px-2 py-1 text-[11px]"
              >
                <ToolOutputView output={item} />
              </li>
            ))}
          </ul>
        </div>
      );
    default:
      return null;
  }
}
