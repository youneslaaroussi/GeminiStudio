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
} from "lucide-react";
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
  onRefresh: () => void;
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
  onRefresh,
}: AssetListProps) {
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const dragFromReorderHandleRef = useRef(false);

  useEffect(() => {
    if (editingAssetId) {
      setEditingName(assets.find((a) => a.id === editingAssetId)?.name ?? "");
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingAssetId, assets]);

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
          width: assetMeta?.width,
          height: assetMeta?.height,
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

  return (
    <div className="divide-y divide-border">
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

        return (
          <ContextMenu key={asset.id}>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  "group flex items-center gap-2 p-2 cursor-grab hover:bg-muted/50 transition-colors",
                  dragOverId === asset.id && "bg-primary/10 ring-1 ring-primary/30"
                )}
                draggable
                onDragStart={(e) => handleDragStart(asset, e)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, asset.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, asset.id)}
              >
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
                    <p className="text-sm font-medium truncate">{asset.name}</p>
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
                      <DropdownMenuItem onClick={() => onAddToTimeline(asset)}>
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
              <ContextMenuItem onClick={() => onAddToTimeline(asset)}>
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
  );
}
