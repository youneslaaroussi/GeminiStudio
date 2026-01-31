"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import {
  FileVideo,
  FileAudio,
  FileImage,
  File as FileIcon,
  Plus,
  Loader2,
  FileText,
  MoreHorizontal,
  GripVertical,
  Trash2,
  Pencil,
  Download,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import type { RemoteAsset, AssetDragPayload } from "@/app/types/assets";
import { ASSET_DRAG_DATA_MIME } from "@/app/types/assets";
import type { ProjectTranscription } from "@/app/types/transcription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes, formatDuration } from "./utils";

const ASSET_REORDER_MIME = "application/x-gemini-asset-reorder";

interface AssetListProps {
  assets: RemoteAsset[];
  isLoading: boolean;
  error: string | null;
  metadata: Record<string, { duration?: number; width?: number; height?: number }>;
  transcriptions: Record<string, ProjectTranscription>;
  resolveAssetDuration: (asset: RemoteAsset) => number;
  onAddToTimeline: (asset: RemoteAsset) => void;
  onStartTranscription: (asset: RemoteAsset) => void;
  onViewTranscription: (assetId: string) => void;
  onViewDetails: (assetId: string) => void;
  onRename: (assetId: string, name: string) => Promise<boolean>;
  onReorder: (orderedIds: string[]) => Promise<boolean>;
  onDelete: (assetId: string) => Promise<boolean>;
  onDeleteMany?: (assetIds: string[]) => Promise<void>;
  onRefresh: () => void;
  /** Asset IDs currently transcoding (locked, no drag, shimmer overlay) */
  transcodingAssetIds?: ReadonlySet<string>;
}

function AssetIcon({ type }: { type: RemoteAsset["type"] }) {
  if (type === "video")
    return <FileVideo className="size-4 text-blue-500" />;
  if (type === "audio")
    return <FileAudio className="size-4 text-emerald-500" />;
  if (type === "image")
    return <FileImage className="size-4 text-amber-500" />;
  return <FileIcon className="size-4 text-muted-foreground" />;
}

export function AssetList({
  assets,
  isLoading,
  error,
  metadata,
  transcriptions,
  resolveAssetDuration,
  onAddToTimeline,
  onStartTranscription,
  onViewTranscription,
  onViewDetails,
  onRename,
  onReorder,
  onDelete,
  onDeleteMany,
  onRefresh,
  transcodingAssetIds = new Set<string>(),
}: AssetListProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const dragFromReorderHandleRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingAssetId) {
      setEditingName(assets.find((a) => a.id === editingAssetId)?.name ?? "");
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingAssetId, assets]);

  useEffect(() => {
    const assetIds = new Set(assets.map((a) => a.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of next) {
        if (!assetIds.has(id)) next.delete(id);
      }
      return next;
    });
  }, [assets]);

  const handleDelete = useCallback(
    async (assetId: string) => {
      setDeletingIds((prev) => new Set(prev).add(assetId));
      try {
        await onDelete(assetId);
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(assetId);
          return next;
        });
      }
    },
    [onDelete]
  );

  const handleDownload = useCallback(
    async (asset: RemoteAsset) => {
      setDownloadingIds((prev) => new Set(prev).add(asset.id));
      try {
        const base = asset.url;
        const sep = base.includes("?") ? "&" : "?";
        const downloadUrl = `${base}${sep}download=1`;
        const res = await fetch(downloadUrl, { credentials: "include" });
        if (!res.ok) throw new Error(res.statusText);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = asset.name || "download";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(objectUrl);
      } finally {
        setDownloadingIds((prev) => {
          const next = new Set(prev);
          next.delete(asset.id);
          return next;
        });
      }
    },
    []
  );

  const handleDragStart = useCallback(
    (asset: RemoteAsset, event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer) return;
      // Row is the draggable element so event.target is often the row; we track
      // pointer-down on the grip instead to distinguish reorder vs timeline drag.
      const isReorder = dragFromReorderHandleRef.current;
      dragFromReorderHandleRef.current = false;

      if (isReorder) {
        event.dataTransfer.setData(ASSET_REORDER_MIME, asset.id);
        event.dataTransfer.effectAllowed = "move";
        setReordering(true);
      } else {
        const assetMeta = metadata[asset.id];
        const payload: AssetDragPayload = {
          id: asset.id,
          name: asset.name,
          url: asset.url,
          type: asset.type,
          duration: resolveAssetDuration(asset),
          width: asset.width ?? assetMeta?.width,
          height: asset.height ?? assetMeta?.height,
        };
        event.dataTransfer.setData(ASSET_DRAG_DATA_MIME, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = "copy";
      }
    },
    [metadata, resolveAssetDuration]
  );

  const handleDragEnd = useCallback(() => {
    dragFromReorderHandleRef.current = false;
    setReordering(false);
    setDragOverId(null);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, assetId: string) => {
      if (!e.dataTransfer.types.includes(ASSET_REORDER_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverId(assetId);
    },
    []
  );

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverId(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, dropTargetId: string) => {
      if (!e.dataTransfer.types.includes(ASSET_REORDER_MIME)) return;
      e.preventDefault();
      setDragOverId(null);
      setReordering(false);
      const draggedId = e.dataTransfer.getData(ASSET_REORDER_MIME);
      if (!draggedId || draggedId === dropTargetId) return;
      const ids = assets.map((a) => a.id);
      const fromIdx = ids.indexOf(draggedId);
      const toIdx = ids.indexOf(dropTargetId);
      if (fromIdx === -1 || toIdx === -1) return;
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, draggedId);
      void onReorder(ids);
    },
    [assets, onReorder]
  );

  const submitRename = useCallback(
    async (assetId: string) => {
      const trimmed = editingName.trim();
      setEditingAssetId(null);
      if (!trimmed) return;
      await onRename(assetId, trimmed);
    },
    [editingName, onRename]
  );

  const toggleSelect = useCallback((assetId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const allSelected = assets.length > 0 && selectedIds.size === assets.length;
  const someSelected = selectedIds.size > 0;

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(assets.map((a) => a.id)));
    }
  }, [allSelected, assets]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const inList = containerRef.current?.contains(active);

      if (e.key === "Escape") {
        if (inList && !editingAssetId && someSelected) {
          e.preventDefault();
          handleClearSelection();
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        const isInput = active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
        if (inList && !isInput && assets.length > 0 && !allSelected) {
          e.preventDefault();
          setSelectedIds(new Set(assets.map((a) => a.id)));
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingAssetId, someSelected, allSelected, assets, handleClearSelection]);

  const handleDeleteSelected = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (onDeleteMany) {
      setDeletingIds((prev) => new Set([...prev, ...ids]));
      setSelectedIds(new Set());
      try {
        await onDeleteMany(ids);
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }
    } else {
      for (const id of ids) {
        await handleDelete(id);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  }, [selectedIds, onDeleteMany, handleDelete]);

  const handleOpenDeleteConfirm = useCallback(() => {
    if (selectedIds.size === 0) return;
    setDeleteConfirmIds([...selectedIds]);
  }, [selectedIds]);

  const handleConfirmDeleteMany = useCallback(async () => {
    const ids = deleteConfirmIds ?? [];
    if (ids.length === 0) return;
    setDeleteConfirmIds(null);
    setDeletingIds((prev) => new Set([...prev, ...ids]));
    setSelectedIds(new Set());
    try {
      if (onDeleteMany) {
        await onDeleteMany(ids);
      } else {
        for (const id of ids) {
          await handleDelete(id);
        }
      }
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  }, [deleteConfirmIds, onDeleteMany, handleDelete]);

  // Full-screen loader only on initial load (no assets yet)
  if (isLoading && assets.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        <span className="text-sm">Loading assets...</span>
      </div>
    );
  }

  // Full error UI only when we have no assets (initial load failed)
  if (error && assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-destructive mb-2">{error}</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Try again
        </Button>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <FileIcon className="size-8 mb-2 opacity-50" />
        <p className="text-sm">No assets yet</p>
        <p className="text-xs">Upload or generate some media to get started</p>
      </div>
    );
  }

  const pendingDeleteCount = deleteConfirmIds?.length ?? 0;

  return (
    <>
    <div
      ref={containerRef}
      className="divide-y divide-border outline-none"
      tabIndex={-1}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (
          t.closest("button, input, textarea, select") ||
          t.closest("[data-drag-handle]")
        )
          return;
        containerRef.current?.focus();
      }}
    >
      {/* Multiselect toolbar */}
      {assets.length > 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border bg-muted/30">
          <button
            type="button"
            onClick={handleSelectAll}
            className={cn(
              "flex items-center justify-center size-5 rounded border shrink-0 transition-colors",
              allSelected
                ? "bg-primary border-primary text-primary-foreground"
                : someSelected
                  ? "bg-primary/50 border-primary/50 text-primary-foreground"
                  : "border-muted-foreground/50 hover:border-muted-foreground"
            )}
            title={allSelected ? "Deselect all" : "Select all"}
          >
            {allSelected && <Check className="size-3" />}
            {someSelected && !allSelected && (
              <div className="size-1.5 bg-primary-foreground rounded-sm" />
            )}
          </button>
          {someSelected && (
            <>
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} selected
              </span>
              <Button
                variant="destructive"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleOpenDeleteConfirm}
                disabled={[...selectedIds].some((id) => deletingIds.has(id))}
              >
                {[...selectedIds].some((id) => deletingIds.has(id)) ? (
                  <Loader2 className="size-3 animate-spin mr-1" />
                ) : (
                  <Trash2 className="size-3 mr-1" />
                )}
                Delete
              </Button>
            </>
          )}
        </div>
      )}
      {error && assets.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-destructive bg-destructive/10">
          <span className="truncate">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 shrink-0" onClick={onRefresh}>
            Try again
          </Button>
        </div>
      )}
      {assets.map((asset) => {
        const transcription = transcriptions[asset.id];
        const canTranscribe = asset.type === "audio" || asset.type === "video";
        const isTranscribing = transcription?.status === "processing" || transcription?.status === "pending";
        const hasTranscript = transcription?.status === "completed";
        const duration = resolveAssetDuration(asset);
        const isTranscoding = transcodingAssetIds.has(asset.id);

        return (
          <ContextMenu key={asset.id}>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  "group relative flex items-center gap-2 p-2 hover:bg-muted/50 transition-colors rounded-md",
                  isTranscoding ? "cursor-not-allowed opacity-90" : "cursor-grab",
                  dragOverId === asset.id && "bg-primary/10 ring-1 ring-primary/30"
                )}
                draggable={!downloadingIds.has(asset.id) && !deletingIds.has(asset.id) && !isTranscoding}
                onClick={
                  someSelected
                    ? (e) => {
                        if (
                          !(e.target as HTMLElement).closest("button, [data-drag-handle], input")
                        ) {
                          toggleSelect(asset.id);
                        }
                      }
                    : undefined
                }
                onDragStart={(e) => handleDragStart(asset, e)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, asset.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, asset.id)}
              >
                {(downloadingIds.has(asset.id) || deletingIds.has(asset.id) || isTranscoding) && (
                  <div className="absolute inset-0 z-10 rounded-md overflow-hidden pointer-events-none" aria-hidden>
                    <div className="absolute inset-0 bg-background/50" />
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted/50 overflow-hidden">
                      <div
                        className="h-full w-1/3 bg-primary/80 rounded-full"
                        style={{ animation: "asset-shimmer 1s ease-in-out infinite" }}
                      />
                    </div>
                  </div>
                )}
                <div
                  data-drag-handle="reorder"
                  className="shrink-0 touch-none cursor-grab active:cursor-grabbing p-1 -m-1"
                  title="Drag to reorder"
                  onPointerDown={() => {
                    dragFromReorderHandleRef.current = true;
                  }}
                  onPointerUp={() => {
                    dragFromReorderHandleRef.current = false;
                  }}
                >
                  <GripVertical className="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Select checkbox */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(asset.id);
                  }}
                  className={cn(
                    "flex items-center justify-center size-5 rounded border shrink-0 transition-colors",
                    selectedIds.has(asset.id)
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-muted-foreground/50 hover:border-muted-foreground",
                    someSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  )}
                  title={selectedIds.has(asset.id) ? "Deselect" : "Select"}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {selectedIds.has(asset.id) && <Check className="size-3" />}
                </button>

                {/* Thumbnail / Icon */}
                <div className="size-10 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                  {asset.type === "image" ? (
                    <img
                      src={asset.thumbnailUrl || asset.url}
                      alt=""
                      className="size-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                  ) : asset.type === "video" ? (
                    <video
                      src={asset.url}
                      className="size-full object-cover"
                      muted
                      preload="metadata"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                  ) : null}
                  <div className={cn(
                    "flex items-center justify-center",
                    (asset.type === "image" || asset.type === "video") && "hidden"
                  )}>
                    <AssetIcon type={asset.type} />
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {editingAssetId === asset.id ? (
                    <Input
                      ref={editInputRef}
                      className="h-7 text-sm font-medium"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => void submitRename(asset.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitRename(asset.id);
                        if (e.key === "Escape") setEditingAssetId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="relative overflow-hidden">
                      <AnimatePresence mode="wait">
                        <motion.p
                          key={asset.description ? "description" : "name"}
                          className="text-sm font-medium line-clamp-3 break-words"
                          title={asset.name}
                          initial={{ opacity: 0, filter: "blur(8px)", y: 4 }}
                          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                          exit={{ opacity: 0, filter: "blur(8px)", y: -4 }}
                          transition={{
                            duration: 0.4,
                            ease: [0.4, 0, 0.2, 1],
                          }}
                        >
                          {asset.description || asset.name}
                        </motion.p>
                      </AnimatePresence>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="uppercase">{asset.type}</span>
                    <span>•</span>
                    <span>{formatBytes(asset.size)}</span>
                    {duration > 0 && asset.type !== "image" && (
                      <>
                        <span>•</span>
                        <span>{formatDuration(duration)}</span>
                      </>
                    )}
                  </div>
                  {isTranscribing && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <Loader2 className="size-3 animate-spin" />
                      <span>Transcribing...</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {hasTranscript && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewTranscription(asset.id);
                      }}
                    >
                      <FileText className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={isTranscoding}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToTimeline(asset);
                    }}
                  >
                    <Plus className="size-3.5 mr-1" />
                    Add
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => {
                          setEditingAssetId(asset.id);
                          setEditingName(asset.name);
                        }}
                      >
                        <Pencil className="size-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={isTranscoding}
                        onClick={() => onAddToTimeline(asset)}
                      >
                        <Plus className="size-4 mr-2" />
                        Add to timeline
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={!canTranscribe || isTranscribing}
                        onClick={() => onStartTranscription(asset)}
                      >
                        <FileText className="size-4 mr-2" />
                        {isTranscribing ? "Transcribing..." : "Transcribe"}
                      </DropdownMenuItem>
                      {hasTranscript && (
                        <DropdownMenuItem
                          onClick={() => onViewTranscription(asset.id)}
                        >
                          <FileText className="size-4 mr-2" />
                          View transcript
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onViewDetails(asset.id)}>
                        <FileIcon className="size-4 mr-2" />
                        View details
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={downloadingIds.has(asset.id)}
                        onClick={() => void handleDownload(asset)}
                      >
                        {downloadingIds.has(asset.id) ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <Download className="size-4 mr-2" />
                        )}
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        disabled={deletingIds.has(asset.id)}
                        onClick={() => handleDelete(asset.id)}
                      >
                        {deletingIds.has(asset.id) ? (
                          <Loader2 className="size-4 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="size-4 mr-2" />
                        )}
                        {deletingIds.has(asset.id) ? "Deleting..." : "Delete"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() => {
                  setEditingAssetId(asset.id);
                  setEditingName(asset.name);
                }}
              >
                <Pencil className="size-4 mr-2" />
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                disabled={isTranscoding}
                onClick={() => onAddToTimeline(asset)}
              >
                <Plus className="size-4 mr-2" />
                Add to timeline
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={!canTranscribe || isTranscribing}
                onClick={() => onStartTranscription(asset)}
              >
                <FileText className="size-4 mr-2" />
                {isTranscribing ? "Transcribing..." : "Transcribe"}
              </ContextMenuItem>
              {hasTranscript && (
                <ContextMenuItem onClick={() => onViewTranscription(asset.id)}>
                  <FileText className="size-4 mr-2" />
                  View transcript
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onViewDetails(asset.id)}>
                <FileIcon className="size-4 mr-2" />
                View details
              </ContextMenuItem>
              <ContextMenuItem
                disabled={downloadingIds.has(asset.id)}
                onClick={() => void handleDownload(asset)}
              >
                {downloadingIds.has(asset.id) ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Download className="size-4 mr-2" />
                )}
                Download
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                disabled={deletingIds.has(asset.id)}
                onClick={() => handleDelete(asset.id)}
              >
                {deletingIds.has(asset.id) ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="size-4 mr-2" />
                )}
                {deletingIds.has(asset.id) ? "Deleting..." : "Delete"}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>

    {/* Destructive action: delete selected assets confirmation */}
    <Dialog
      open={deleteConfirmIds !== null}
      onOpenChange={(open) => !open && setDeleteConfirmIds(null)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">Delete assets</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete {pendingDeleteCount} asset{pendingDeleteCount !== 1 ? "s" : ""}? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setDeleteConfirmIds(null)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleConfirmDeleteMany()}>
            Delete {pendingDeleteCount} asset{pendingDeleteCount !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
