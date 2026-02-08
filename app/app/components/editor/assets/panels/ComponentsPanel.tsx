"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Plus,
  Trash2,
  GripVertical,
  Code2,
  ChevronDown,
  ChevronRight,
  X,
  Save,
  Loader2,
  Type,
  Hash,
  ToggleLeft,
  Palette,
  Undo2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { RemoteAsset, ComponentInputDef } from "@/app/types/assets";
import { ASSET_DRAG_DATA_MIME } from "@/app/types/assets";
import { getAuthHeaders } from "@/app/lib/hooks/useAuthFetch";
import { MOTION_CANVAS_TYPES } from "@/app/lib/monaco-types-data";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useAssetHighlightStore } from "@/app/lib/store/asset-highlight-store";
import {
  COMPONENT_TEMPLATES,
  CATEGORY_LABELS,
  groupTemplatesByCategory,
  type ComponentTemplate,
} from "@/app/lib/component-templates";

const INPUT_TYPE_OPTIONS: { value: ComponentInputDef["type"]; label: string; Icon: LucideIcon }[] = [
  { value: "string", label: "String", Icon: Type },
  { value: "number", label: "Number", Icon: Hash },
  { value: "boolean", label: "Boolean", Icon: ToggleLeft },
  { value: "color", label: "Color", Icon: Palette },
];

const DEFAULT_COMPONENT_CODE = `import {
  Circle,
  Node,
  NodeProps,
  Txt,
  signal,
  initial,
} from '@motion-canvas/2d';
import {
  SignalValue,
  SimpleSignal,
  createSignal,
  type ThreadGenerator,
} from '@motion-canvas/core';

export interface MyComponentProps extends NodeProps {
  label?: SignalValue<string>;
}

export class MyComponent extends Node {
  @initial('Hello')
  @signal()
  public declare readonly label: SimpleSignal<string, this>;

  public constructor(props?: MyComponentProps) {
    super({ ...props });

    this.add([
      <Circle
        width={200}
        height={200}
        stroke={'#68ABDF'}
        lineWidth={8}
      />,
      <Txt
        text={() => this.label()}
        fill={'#ffffff'}
        fontSize={32}
        fontFamily={'Inter Variable'}
        fontWeight={700}
      />,
    ]);
  }
}
`;

interface ComponentsPanelProps {
  projectId: string | null;
  assets: RemoteAsset[];
  onAssetsChanged: () => void;
  /** Optimistically update a single asset's fields in local state. */
  onAssetUpdated: (assetId: string, fields: Partial<RemoteAsset>) => void;
}

export function ComponentsPanel({ projectId, assets, onAssetsChanged, onAssetUpdated }: ComponentsPanelProps) {
  const componentAssets = useMemo(
    () => assets.filter((a) => a.type === "component"),
    [assets]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string>("");
  const [editingName, setEditingName] = useState<string>("");
  const [editingComponentName, setEditingComponentName] = useState<string>("");
  const [editingInputDefs, setEditingInputDefs] = useState<ComponentInputDef[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showInputDefs, setShowInputDefs] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
  const editorRef = useRef<unknown>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeClipsByAssetId = useProjectStore((s) => s.removeClipsByAssetId);
  const componentAssetsRef = useRef(componentAssets);
  componentAssetsRef.current = componentAssets;

  // Last-known-good snapshot per asset (before each save). Used for Undo.
  const lastGoodRef = useRef<Record<string, { code: string; name: string; componentName: string; inputDefs: ComponentInputDef[] }>>({});
  const [hasLastGood, setHasLastGood] = useState(false);

  // Refs that always hold the latest editing values.
  // handleSave reads from these so the debounced callback never sends stale data.
  const editingCodeRef = useRef(editingCode);
  const editingNameRef = useRef(editingName);
  const editingComponentNameRef = useRef(editingComponentName);
  const editingInputDefsRef = useRef(editingInputDefs);
  editingCodeRef.current = editingCode;
  editingNameRef.current = editingName;
  editingComponentNameRef.current = editingComponentName;
  editingInputDefsRef.current = editingInputDefs;

  const selectedAsset = useMemo(
    () => componentAssets.find((a) => a.id === selectedId) ?? null,
    [componentAssets, selectedId]
  );

  // When a component highlight is requested (e.g. from chat code block header click), select that component
  const highlightRequest = useAssetHighlightStore((s) => s.request);
  useEffect(() => {
    if (!highlightRequest || highlightRequest.target.type !== "component") return;
    const { id, name } = highlightRequest.target;
    const list = componentAssetsRef.current;
    if (id) {
      const byId = list.find((a) => a.id === id);
      if (byId) setSelectedId(byId.id);
      return;
    }
    if (name) {
      const normalized = name.replace(/\.[^.]+$/, "").trim();
      const byName = list.find(
        (a) =>
          a.name === normalized ||
          a.name === name ||
          (a.componentName && (a.componentName === normalized || a.componentName === name))
      );
      if (byName) setSelectedId(byName.id);
    }
  }, [highlightRequest]);

  // Track previously loaded asset ID so we only reset editing state when
  // the user selects a *different* asset, not when the same asset is
  // re-fetched (which may return stale data after a save).
  const loadedAssetIdRef = useRef<string | null>(null);

  // When selection changes, load the asset data into editing state and set last-good for Undo
  useEffect(() => {
    if (selectedAsset) {
      if (loadedAssetIdRef.current !== selectedAsset.id) {
        const code = selectedAsset.code ?? "";
        const name = selectedAsset.name;
        const componentName = selectedAsset.componentName ?? "MyComponent";
        const inputDefs = selectedAsset.inputDefs ?? [];
        setEditingCode(code);
        setEditingName(name);
        setEditingComponentName(componentName);
        setEditingInputDefs(inputDefs);
        setHasUnsavedChanges(false);
        setCompileError(null);
        loadedAssetIdRef.current = selectedAsset.id;
        lastGoodRef.current[selectedAsset.id] = { code, name, componentName, inputDefs };
        setHasLastGood(true);
      }
    } else {
      loadedAssetIdRef.current = null;
      setHasLastGood(false);
    }
  }, [selectedAsset]);

  const handleCreate = useCallback(async (template?: ComponentTemplate) => {
    if (!projectId) {
      toast.error("No project selected");
      return;
    }
    setIsCreating(true);
    setShowTemplatePicker(false);
    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch("/api/component-assets", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: template?.name ?? "New Component",
          code: template?.code ?? DEFAULT_COMPONENT_CODE,
          componentName: template?.componentName ?? "MyComponent",
          inputDefs: template?.inputDefs ?? [
            { name: "label", type: "string", default: "Hello", label: "Label" },
          ],
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create component");
      }

      const data = await response.json();
      toast.success(template ? `Added "${template.name}"` : "Component created");
      onAssetsChanged();
      setSelectedId(data.asset.id);
    } catch (err) {
      console.error("Failed to create component:", err);
      toast.error("Failed to create component", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsCreating(false);
    }
  }, [projectId, onAssetsChanged]);

  // Build component files map for compile check (same shape as ScenePlayer).
  const buildComponentFiles = useCallback(
    (currentAssetId: string, overrides: { code: string; componentName: string }) => {
      const files: Record<string, string> = {};
      const assets = componentAssetsRef.current;
      for (const a of assets) {
        if (a.type !== "component" || !a.componentName) continue;
        const path = `src/components/custom/${a.componentName}.tsx`;
        if (a.id === currentAssetId) {
          files[path] = overrides.code;
        } else if (a.code) {
          files[path] = a.code;
        }
      }
      return files;
    },
    []
  );

  // Parse compile error for display: try to extract file and line (e.g. "path:12:34" or "at path (line 12)").
  const formatCompileError = useCallback((message: string, currentComponentName?: string) => {
    const lineMatch = message.match(/(?:\.tsx?):(\d+)(?::(\d+))?/);
    const fileMatch = message.match(/([^/\\]+\.tsx?)(?::\d| \()/);
    const line = lineMatch ? lineMatch[1] : null;
    const file = fileMatch ? fileMatch[1] : currentComponentName ? `${currentComponentName}.tsx` : null;
    if (file && line) return `Line ${line} in ${file}: ${message.replace(/^[^:]*:\d+(?::\d+)?\s*/, "").slice(0, 120)}`;
    return message.slice(0, 200);
  }, []);

  // Stable save function: reads latest values from refs so it never sends stale data.
  // Before save, snapshot current state as last-known-good for Undo. After PATCH, runs compile check and shows errors.
  const handleSave = useCallback(async () => {
    if (!projectId || !selectedId) return;
    const code = editingCodeRef.current;
    const name = editingNameRef.current;
    const componentName = editingComponentNameRef.current;
    const inputDefs = editingInputDefsRef.current;
    lastGoodRef.current[selectedId] = { code, name, componentName, inputDefs };
    setHasLastGood(true);

    setIsSaving(true);
    setCompileError(null);
    try {
      const savePayload = { name, code, componentName, inputDefs };

      const authHeaders = await getAuthHeaders();
      const url = new URL(`/api/assets/${selectedId}`, window.location.origin);
      url.searchParams.set("projectId", projectId);
      const response = await fetch(url.toString(), {
        method: "PATCH",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(savePayload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save component");
      }

      setHasUnsavedChanges(false);
      onAssetUpdated(selectedId, savePayload);

      // Compile check: so user sees inline errors instead of only "Failed to load scene" in preview.
      const files = buildComponentFiles(selectedId, { code, componentName });
      if (Object.keys(files).length > 0) {
        try {
          const compileRes = await fetch("/api/compile-scene", {
            method: "POST",
            headers: { ...authHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ files }),
          });
          if (!compileRes.ok) {
            const errData = await compileRes.json().catch(() => ({}));
            const errMsg = (errData as { error?: string }).error ?? `Compilation failed (${compileRes.status})`;
            const formatted = formatCompileError(errMsg, componentName);
            setCompileError(formatted);
            toast.error("Component saved but has compile errors", {
              description: formatted,
              duration: 8000,
            });
          } else {
            setCompileError(null);
          }
        } catch {
          // Compiler unavailable; don't block or confuse the user
        }
      }
    } catch (err) {
      console.error("Failed to save component:", err);
      toast.error("Failed to save", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setIsSaving(false);
    }
  }, [projectId, selectedId, onAssetUpdated, buildComponentFiles, formatCompileError]);

  // Auto-save on code change (debounced).
  // handleSave is stable (no editing state in deps), so the timeout always
  // calls the same function which reads the latest values from refs.
  const handleCodeChange = useCallback(
    (value: string | undefined) => {
      const code = value ?? "";
      setEditingCode(code);
      setHasUnsavedChanges(true);
      setCompileError(null);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        handleSave();
      }, 2000);
    },
    [handleSave]
  );

  const handleUndo = useCallback(() => {
    if (!selectedId) return;
    const last = lastGoodRef.current[selectedId];
    if (!last) return;
    setEditingCode(last.code);
    setEditingName(last.name);
    setEditingComponentName(last.componentName);
    setEditingInputDefs(last.inputDefs);
    setHasUnsavedChanges(false);
    setCompileError(null);
  }, [selectedId]);

  const handleDelete = useCallback(
    async (assetId: string) => {
      if (!projectId) return;
      try {
        const authHeaders = await getAuthHeaders();
        const url = new URL(`/api/assets/${assetId}`, window.location.origin);
        url.searchParams.set("projectId", projectId);
        const response = await fetch(url.toString(), {
          method: "DELETE",
          headers: authHeaders,
        });
        if (!response.ok) throw new Error("Failed to delete");
        if (selectedId === assetId) setSelectedId(null);
        removeClipsByAssetId(assetId);
        onAssetsChanged();
        toast.success("Component deleted");
      } catch (err) {
        toast.error("Failed to delete component");
      }
    },
    [projectId, selectedId, onAssetsChanged, removeClipsByAssetId]
  );

  const handleAddInputDef = useCallback(() => {
    setEditingInputDefs((prev) => [
      ...prev,
      { name: "newInput", type: "string" as const, default: "", label: "New Input" },
    ]);
    setHasUnsavedChanges(true);
  }, []);

  const handleUpdateInputDef = useCallback(
    (index: number, updates: Partial<ComponentInputDef>) => {
      setEditingInputDefs((prev) =>
        prev.map((def, i) => (i === index ? { ...def, ...updates } : def))
      );
      setHasUnsavedChanges(true);
    },
    []
  );

  const handleRemoveInputDef = useCallback((index: number) => {
    setEditingInputDefs((prev) => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  }, []);

  const handleDragStart = useCallback(
    (e: React.DragEvent, asset: RemoteAsset) => {
      const payload = JSON.stringify({
        id: asset.id,
        name: asset.name,
        url: "",
        type: "component" as const,
        componentName: asset.componentName,
        inputDefs: asset.inputDefs,
      });
      e.dataTransfer.setData(ASSET_DRAG_DATA_MIME, payload);
      e.dataTransfer.effectAllowed = "copy";
    },
    []
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-muted-foreground">
          {componentAssets.length} component{componentAssets.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onAssetsChanged()}
            disabled={!projectId}
            title="Refresh components from assets"
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Popover open={showTemplatePicker} onOpenChange={setShowTemplatePicker}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 text-xs gap-1",
                  showTemplatePicker && "bg-primary/10 text-primary"
                )}
                disabled={isCreating || !projectId}
              >
                <Code2 className="size-3.5" />
                Templates
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[260px] p-0 overflow-hidden flex flex-col"
              align="start"
              sideOffset={6}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <TemplatePicker
                onSelect={(template) => handleCreate(template)}
                onClose={() => setShowTemplatePicker(false)}
                disabled={isCreating}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => handleCreate()}
            disabled={isCreating || !projectId}
          >
            {isCreating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Blank
          </Button>
        </div>
      </div>

      {/* Component List */}
      <div className="border-b border-border">
        <ScrollArea className="max-h-[200px]">
          {componentAssets.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No components yet. Click <strong>New</strong> to create one.
            </div>
          ) : (
            <div className="p-1">
              {componentAssets.map((asset) => (
                <div
                  key={asset.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, asset)}
                  onClick={() => setSelectedId(asset.id)}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm group",
                    selectedId === asset.id
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <GripVertical className="size-3.5 opacity-0 group-hover:opacity-50 cursor-grab shrink-0" />
                  <Code2 className="size-3.5 shrink-0 text-indigo-400" />
                  <span className="flex-1 truncate text-xs">{asset.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[80px]">
                    {asset.componentName}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(asset.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Editor Area */}
      {selectedAsset ? (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Component name / metadata */}
          <div className="px-3 py-2 border-b border-border space-y-2">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => setSelectedId(null)}
                title="Close"
              >
                <X className="size-3.5" />
              </Button>
              <Input
                value={editingName}
                onChange={(e) => {
                  setEditingName(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="h-7 text-xs flex-1"
                placeholder="Component name"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 shrink-0"
                onClick={handleUndo}
                disabled={!selectedId || !hasLastGood}
                title="Revert to last saved version"
              >
                <Undo2 className="size-3" />
                Undo
              </Button>
              <Button
                variant={hasUnsavedChanges ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs gap-1 shrink-0"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Save className="size-3" />
                )}
                Save
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground shrink-0">Class:</Label>
              <Input
                value={editingComponentName}
                onChange={(e) => {
                  setEditingComponentName(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                className="h-6 text-xs font-mono"
                placeholder="ClassName"
              />
            </div>
          </div>

          {/* Input Definitions (collapsible table) */}
          <div className="border-b border-border">
            <button
              className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground w-full"
              onClick={() => setShowInputDefs(!showInputDefs)}
            >
              {showInputDefs ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              Input Definitions ({editingInputDefs.length})
            </button>
            {showInputDefs && (
              <div className="px-3 pb-2">
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left font-medium text-muted-foreground px-3 py-2 w-[38%]">
                          Name
                        </th>
                        <th className="text-left font-medium text-muted-foreground px-3 py-2 w-[26%]">
                          Type
                        </th>
                        <th className="text-left font-medium text-muted-foreground px-3 py-2">
                          Default
                        </th>
                        <th className="w-10 px-2 py-2" aria-label="Remove" />
                      </tr>
                    </thead>
                    <tbody>
                      {editingInputDefs.map((def, i) => {
                        const typeOption = INPUT_TYPE_OPTIONS.find((o) => o.value === def.type);
                        return (
                          <tr
                            key={i}
                            className="border-b border-border/60 last:border-0 hover:bg-muted/20"
                          >
                            <td className="px-3 py-1.5">
                              <Input
                                value={def.name}
                                onChange={(e) =>
                                  handleUpdateInputDef(i, { name: e.target.value })
                                }
                                className="h-7 text-[11px] font-mono border border-border/60 rounded bg-background focus-visible:ring-1 px-2 min-w-0"
                                placeholder="name"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <Select
                                value={def.type}
                                onValueChange={(v) =>
                                  handleUpdateInputDef(i, {
                                    type: v as ComponentInputDef["type"],
                                    default:
                                      v === "number" ? 0 : v === "boolean" ? false : v === "color" ? "#ffffff" : "",
                                  })
                                }
                              >
                                <SelectTrigger className="h-7 w-full gap-2 rounded border border-border/60 bg-background px-2 text-[11px] focus:ring-1">
                                  <SelectValue>
                                    {typeOption && (
                                      <span className="flex items-center gap-2">
                                        <typeOption.Icon className="size-3.5 shrink-0 text-muted-foreground" />
                                        {typeOption.label}
                                      </span>
                                    )}
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {INPUT_TYPE_OPTIONS.map((opt) => (
                                    <SelectItem
                                      key={opt.value}
                                      value={opt.value}
                                      className="gap-2 py-2"
                                    >
                                      <opt.Icon className="size-3.5 shrink-0 text-muted-foreground" />
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                value={String(def.default)}
                                onChange={(e) => {
                                  let val: string | number | boolean = e.target.value;
                                  if (def.type === "number") val = Number(val) || 0;
                                  if (def.type === "boolean") val = val === "true";
                                  handleUpdateInputDef(i, { default: val });
                                }}
                                className="h-7 text-[11px] border border-border/60 rounded bg-background focus-visible:ring-1 px-2 w-full min-w-0"
                                placeholder="default"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleRemoveInputDef(i)}
                                title="Remove"
                              >
                                <X className="size-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {editingInputDefs.length === 0 && (
                  <p className="text-[11px] text-muted-foreground py-2 text-center">
                    No inputs. Add props the timeline can override.
                  </p>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] gap-1 w-full mt-1.5"
                  onClick={handleAddInputDef}
                >
                  <Plus className="size-3" /> Add Input
                </Button>
              </div>
            )}
          </div>

          {/* Compile error banner */}
          {compileError && (
            <div className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <p className="text-xs flex-1 break-words">{compileError}</p>
              <button
                type="button"
                onClick={() => setCompileError(null)}
                className="shrink-0 text-destructive/80 hover:text-destructive"
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {/* Monaco Editor */}
          <div className="flex-1 min-h-0">
            <MonacoEditor
              value={editingCode}
              onChange={handleCodeChange}
              editorRef={editorRef}
              onSave={handleSave}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center">
            {componentAssets.length > 0
              ? "Select a component to edit its code"
              : "Create a component to get started"}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template Picker
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  text: Type,
  data: Hash,
  shape: Palette,
  overlay: Code2,
};

function TemplatePicker({
  onSelect,
  onClose,
  disabled,
}: {
  onSelect: (template: ComponentTemplate) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const grouped = useMemo(() => groupTemplatesByCategory(), []);

  return (
    <>
      <PopoverHeader className="px-4 pt-4 pb-2">
        <PopoverTitle className="text-sm font-medium">Choose a template</PopoverTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Start from a preset or use Blank for an empty component.
        </p>
      </PopoverHeader>
      <ScrollArea className="h-[min(320px,60vh)] min-h-0 overflow-hidden">
        <div className="px-4 pb-4 space-y-4 min-w-0">
          {Object.entries(grouped).map(([category, templates]) => {
            const Icon = CATEGORY_ICONS[category] ?? Code2;
            return (
              <div key={category}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    {CATEGORY_LABELS[category] ?? category}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => onSelect(template)}
                      className={cn(
                        "rounded-lg border bg-card text-card-foreground shadow-sm w-full min-w-0",
                        "text-left transition-colors overflow-hidden",
                        "hover:bg-accent hover:text-accent-foreground hover:border-border",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        "disabled:opacity-50 disabled:pointer-events-none"
                      )}
                    >
                      <div className="flex gap-2 p-2">
                        {template.preview && (
                          <div className="h-10 w-14 shrink-0 rounded bg-muted/50 flex items-center justify-center overflow-hidden">
                            <div className="w-full h-full p-0.5 [&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:object-contain">
                              {template.preview()}
                            </div>
                          </div>
                        )}
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-xs font-medium truncate">
                            {template.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                            {template.description}
                          </p>
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {template.inputDefs.slice(0, 3).map((def) => (
                              <span
                                key={def.name}
                                className="text-[9px] rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground"
                              >
                                {def.label ?? def.name}
                              </span>
                            ))}
                            {template.inputDefs.length > 3 && (
                              <span className="text-[9px] text-muted-foreground">
                                +{template.inputDefs.length - 3}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </>
  );
}

// ---------------------------------------------------------------------------
// Monaco Editor
// ---------------------------------------------------------------------------

/** Lazy-loaded Monaco editor wrapper to avoid SSR issues */
function MonacoEditor({
  value,
  onChange,
  editorRef,
  onSave,
}: {
  value: string;
  onChange: (value: string | undefined) => void;
  editorRef: React.MutableRefObject<unknown>;
  onSave?: () => void;
}) {
  const [Editor, setEditor] = useState<React.ComponentType<{
    value: string;
    onChange: (value: string | undefined) => void;
    language: string;
    theme: string;
    path?: string;
    options: Record<string, unknown>;
    beforeMount?: (monaco: unknown) => void;
    onMount: (editor: unknown, monaco: unknown) => void;
  }> | null>(null);

  useEffect(() => {
    import("@monaco-editor/react").then((mod) => {
      setEditor(() => mod.default);
    });
  }, []);

  const beforeMount = useCallback((monaco: unknown) => {
    const m = monaco as {
      languages: {
        typescript: {
          typescriptDefaults: {
            setCompilerOptions: (opts: Record<string, unknown>) => void;
            addExtraLib: (content: string, path?: string) => unknown;
          };
          JsxEmit?: { React: number; ReactJSX: number };
        };
      };
    };
    const ts = m.languages?.typescript;
    if (!ts) return;

    // Use ReactJSX transform with Motion Canvas's jsx-runtime (no React in scope, no react/jsx-runtime)
    const JsxEmit = ts.JsxEmit ?? { React: 2, ReactJSX: 4 };
    // ES2015+ and downlevelIteration allow generator iteration (e.g. yield* with ThreadGenerator)
    const ScriptTarget = (m as { languages?: { typescript?: { ScriptTarget?: { ES2015?: number } } } }).languages?.typescript?.ScriptTarget;
    ts.typescriptDefaults.setCompilerOptions({
      target: ScriptTarget?.ES2015 ?? 2,
      downlevelIteration: true,
      experimentalDecorators: true,
      jsx: JsxEmit.ReactJSX ?? 4,
      jsxImportSource: "@motion-canvas/2d",
      moduleResolution: 2, // Node
      allowNonTsExtensions: true,
      noEmit: true,
      baseUrl: "file:///",
      paths: {
        "@motion-canvas/2d": ["node_modules/@motion-canvas/2d/lib/index.d.ts"],
        "@motion-canvas/2d/*": ["node_modules/@motion-canvas/2d/*"],
        "@motion-canvas/2d/jsx-runtime": ["node_modules/@motion-canvas/2d/lib/jsx-runtime.d.ts"],
        "@motion-canvas/2d/jsx-dev-runtime": ["node_modules/@motion-canvas/2d/lib/jsx-dev-runtime.d.ts"],
        "@motion-canvas/core": ["node_modules/@motion-canvas/core/lib/index.d.ts"],
        "@motion-canvas/core/*": ["node_modules/@motion-canvas/core/*"],
      },
    });

    // Load @motion-canvas types (copied into app via scripts/generate-motion-canvas-types.ts).
    for (const { path: filePath, content } of MOTION_CANVAS_TYPES) {
      ts.typescriptDefaults.addExtraLib(content, `file:///${filePath}`);
    }

    // Stub @motion-canvas/core so the editor always finds common symbols (Monaco often fails to
    // resolve export * from relative paths in extra libs). We add explicit declarations and the
    // real MOTION_CANVAS_TYPES above still provide full types when resolution works.
    const coreStub = `
declare module '@motion-canvas/core' {
  export function signal(): PropertyDecorator;
  export function initial<T>(value: T): PropertyDecorator;
  export function colorSignal(): PropertyDecorator;
  export type SignalValue<T> = T | (() => T);
  export type SimpleSignal<TValue = unknown, TReturn = unknown> = {
    (): TValue;
    (value: SignalValue<TValue>): TReturn;
  };
  export type Signal<TSetter = unknown, TValue = TSetter, TOwner = unknown> = SimpleSignal<TValue, TOwner>;
  export type ColorSignal<TOwner = unknown> = SimpleSignal<string, TOwner>;
  export type PossibleColor = string;
  export type ThreadGenerator = Generator<unknown, void, unknown>;
  export type Vector2 = { x: number; y: number };
  export function createSignal<T>(initial?: SignalValue<T>): SimpleSignal<T>;
  export function createRef<T>(): { (): T; current: T };
  export function waitFor(seconds?: number, after?: ThreadGenerator): ThreadGenerator;
  export function tween(duration: number, callback: (t: number) => void): ThreadGenerator;
  export function easeInOutCubic(t: number): number;
  export function easeInCubic(t: number): number;
  export function easeOutCubic(t: number): number;
  export function easeInOutQuad(t: number): number;
  export function all(...values: ThreadGenerator[]): ThreadGenerator;
  export function sequence(...values: ThreadGenerator[]): ThreadGenerator;
  export function loop(fn: () => ThreadGenerator, count?: number): ThreadGenerator;
  export function delay(duration: number, task: () => ThreadGenerator): ThreadGenerator;
  export function run(task: () => ThreadGenerator): ThreadGenerator;
  export function spawn(generator: () => ThreadGenerator): ThreadGenerator;
  export function cancel(token: unknown): void;
  export function join(token: unknown): ThreadGenerator;
  export function useContext(): unknown;
  export function useScene(): unknown;
  export function useThread(): unknown;
  export function useRandom(seed?: number): { next(): number; nextInt(a: number, b?: number): number };
  export function useDuration(): number;
  export function usePlayback(): unknown;
  export function useTime(): number;
  export function makeRef<T>(target: T): T;
  export const DEFAULT: unique symbol;
}
`;
    ts.typescriptDefaults.addExtraLib(
      coreStub,
      "file:///node_modules/@motion-canvas/core/lib/component-editor-stub.d.ts"
    );
  }, []);

  if (!Editor) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading editor...
      </div>
    );
  }

  return (
    <Editor
      value={value}
      onChange={onChange}
      language="typescript"
      path="file:///component.tsx"
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 12,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        automaticLayout: true,
        tabSize: 2,
        padding: { top: 8 },
      }}
      beforeMount={beforeMount}
      onMount={(editor: unknown, monaco: unknown) => {
        editorRef.current = editor;
        if (onSave && monaco) {
          const m = monaco as { KeyMod: { CtrlCmd: number }; KeyCode: { KeyS: number } };
          (editor as { addCommand: (id: number, run: () => void) => void }).addCommand(
            m.KeyMod.CtrlCmd | m.KeyCode.KeyS,
            () => onSave()
          );
        }
      }}
    />
  );
}
