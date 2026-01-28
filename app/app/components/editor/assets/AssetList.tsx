"use client";

import { useCallback, useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RemoteAsset, AssetDragPayload } from "@/app/types/assets";
import { ASSET_DRAG_DATA_MIME } from "@/app/types/assets";
import type { ProjectTranscription } from "@/app/types/transcription";
import { Button } from "@/components/ui/button";
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
  onDelete,
  onRefresh,
}: AssetListProps) {
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

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
    },
    [metadata, resolveAssetDuration]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        <span className="text-sm">Loading assets...</span>
      </div>
    );
  }

  if (error) {
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
                className="group flex items-center gap-2 p-2 cursor-grab hover:bg-muted/50 transition-colors"
                draggable
                onDragStart={(e) => handleDragStart(asset, e)}
              >
                <GripVertical className="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />

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
                  <p className="text-sm font-medium truncate">{asset.name}</p>
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
