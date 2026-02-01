"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import {
  File as FileIcon,
  Loader2,
  Trash2,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RemoteAsset, AssetDragPayload } from "@/app/types/assets";
import { ASSET_DRAG_DATA_MIME } from "@/app/types/assets";
import type { ProjectTranscription } from "@/app/types/transcription";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AssetRow } from "./AssetRow";

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
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null);
  const dragFromReorderHandleRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleDownload = useCallback(async (asset: RemoteAsset) => {
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
  }, []);

  const handleDragStart = useCallback(
    (asset: RemoteAsset, event: React.DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer) return;
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
        if (inList && someSelected) {
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
  }, [someSelected, allSelected, assets, handleClearSelection]);

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

  const handleReorderPointerDown = useCallback(() => {
    dragFromReorderHandleRef.current = true;
  }, []);

  const handleReorderPointerUp = useCallback(() => {
    dragFromReorderHandleRef.current = false;
  }, []);

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

        {assets.map((asset) => (
          <AssetRow
            key={asset.id}
            asset={asset}
            transcription={transcriptions[asset.id]}
            duration={resolveAssetDuration(asset)}
            isSelected={selectedIds.has(asset.id)}
            isDeleting={deletingIds.has(asset.id)}
            isDownloading={downloadingIds.has(asset.id)}
            isTranscoding={transcodingAssetIds.has(asset.id)}
            isDragOver={dragOverId === asset.id}
            someSelected={someSelected}
            onToggleSelect={toggleSelect}
            onAddToTimeline={onAddToTimeline}
            onStartTranscription={onStartTranscription}
            onViewTranscription={onViewTranscription}
            onViewDetails={onViewDetails}
            onRename={onRename}
            onDelete={handleDelete}
            onDownload={handleDownload}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onReorderHandlePointerDown={handleReorderPointerDown}
            onReorderHandlePointerUp={handleReorderPointerUp}
          />
        ))}
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
