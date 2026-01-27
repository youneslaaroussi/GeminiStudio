"use client";

import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import {
  PlayIcon,
  ChevronDown,
  ChevronRight,
  Check,
  RotateCcw,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { toolRegistry, executeTool } from "@/app/lib/tools/tool-registry";
import type { ToolDefinition, ToolOutput } from "@/app/lib/tools/types";
import type { Project } from "@/app/types/timeline";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useToolboxStore } from "@/app/lib/store/toolbox-store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type ToolFormValues = Record<string, string>;

interface HistoryEntry {
  id: string;
  toolName: string;
  toolLabel: string;
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

  const [selectedTool, setSelectedTool] = useState<ToolDefinition<z.ZodTypeAny, Project> | null>(
    () => tools[0] ?? null
  );
  const [formState, setFormState] = useState<Record<string, ToolFormValues>>(
    {}
  );
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

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

  const handleSelectTool = useCallback((tool: ToolDefinition<z.ZodTypeAny, Project>) => {
    setSelectedTool(tool);
    setLastError(null);
    setToolPickerOpen(false);
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
      toolLabel: selectedTool.label,
      inputSnapshot: parsedFormInput,
      outputs: result.status === "success" ? result.outputs : undefined,
      error: result.status === "error" ? result.error : undefined,
    };
    setHistory((prev) => [entry, ...prev]);
    if (result.status === "error") {
      setLastError(result.error);
    }
    setIsRunning(false);
    // Auto-expand history on new entry
    setHistoryOpen(true);
  }, [parsedFormInput, project, selectedTool]);

  return (
    <div className="flex h-full flex-col">
      {/* Tool Selector */}
      <div className="border-b border-border p-3 space-y-3">
        <Popover open={toolPickerOpen} onOpenChange={setToolPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={toolPickerOpen}
              className="w-full justify-between font-normal"
            >
              {selectedTool ? selectedTool.label : "Select a tool..."}
              <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search tools..." />
              <CommandList>
                <CommandEmpty>No tool found.</CommandEmpty>
                <CommandGroup>
                  {tools.map((tool) => (
                    <CommandItem
                      key={tool.name}
                      value={tool.label}
                      onSelect={() => handleSelectTool(tool)}
                      className="flex items-center gap-2"
                    >
                      <Check
                        className={cn(
                          "size-4",
                          selectedTool?.name === tool.name
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{tool.label}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {tool.description}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {selectedTool && (
          <p className="text-xs text-muted-foreground">
            {selectedTool.description}
          </p>
        )}
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-3">
        {selectedTool ? (
          <div className="space-y-4">
            {selectedTool.fields.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                This tool has no parameters.
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
                    onChange: (
                      event: ChangeEvent<
                        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
                      >
                    ) =>
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
                        className="text-xs font-medium"
                      >
                        {field.label}
                        {field.description && (
                          <span className="font-normal text-muted-foreground ml-1">
                            — {field.description}
                          </span>
                        )}
                      </label>
                      {renderField(field, commonProps)}
                    </div>
                  );
                })}
              </div>
            )}

            {lastError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-2 text-xs text-destructive">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <p>{lastError}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a tool to get started
          </div>
        )}
      </div>

      {/* Actions */}
      {selectedTool && (
        <div className="border-t border-border p-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={resetForm}
            className="shrink-0"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
          <Button
            size="sm"
            className="flex-1"
            disabled={isRunning}
            onClick={handleRunTool}
          >
            {isRunning ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <PlayIcon className="size-3.5" />
                Run
              </>
            )}
          </Button>
        </div>
      )}

      {/* Collapsible History */}
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-2 px-3 py-2 border-t border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">
            {historyOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <Clock className="size-3.5" />
            History
            {history.length > 0 && (
              <span className="ml-auto bg-muted rounded-full px-1.5 py-0.5 text-[10px]">
                {history.length}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="max-h-64 overflow-y-auto border-t border-border">
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3 text-center">
                No runs yet
              </p>
            ) : (
              <div className="divide-y divide-border">
                {history.map((entry) => (
                  <HistoryEntryRow key={entry.id} entry={entry} />
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function HistoryEntryRow({ entry }: { entry: HistoryEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
      >
        {entry.status === "success" ? (
          <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
        ) : (
          <AlertCircle className="size-3.5 text-destructive shrink-0" />
        )}
        <span className="font-medium truncate flex-1">{entry.toolLabel}</span>
        <span className="text-muted-foreground shrink-0">
          {(entry.durationMs / 1000).toFixed(1)}s
        </span>
        {expanded ? (
          <ChevronDown className="size-3 shrink-0" />
        ) : (
          <ChevronRight className="size-3 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-muted-foreground">
            {new Date(entry.startedAt).toLocaleTimeString()}
          </p>
          {entry.error && (
            <p className="text-destructive bg-destructive/10 rounded p-2">
              {entry.error}
            </p>
          )}
          {entry.outputs && entry.outputs.length > 0 && (
            <div className="space-y-2">
              {entry.outputs.map((output, index) => (
                <ToolOutputView
                  key={`${entry.id}-${index}`}
                  output={output}
                />
              ))}
            </div>
          )}
        </div>
      )}
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
      return <Textarea {...props} rows={3} className="text-sm" />;
    case "number":
      return <Input {...props} type="number" step="0.01" className="text-sm" />;
    case "json":
      return (
        <Textarea
          {...props}
          rows={4}
          spellCheck={false}
          className="font-mono text-xs"
        />
      );
    case "datetime":
      return <Input {...props} type="datetime-local" className="text-sm" />;
    case "select":
      return (
        <select
          {...props}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    default:
      return <Input {...props} type="text" className="text-sm" />;
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
        <pre className="overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed font-mono">
          {JSON.stringify(output.data, null, 2)}
        </pre>
      );
    case "image":
      return (
        <div className="rounded-md border border-border/70 bg-background p-1">
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
          <ul className="space-y-1">
            {output.items.map((item, index) => (
              <li key={index} className="rounded bg-muted/40 px-2 py-1">
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
