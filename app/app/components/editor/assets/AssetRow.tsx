"use client";

import { memo, useCallback, useState, useRef, useEffect } from "react";
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
  StickyNote,
  AlertCircle,
  Code2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import type { RemoteAsset } from "@/app/types/assets";
import type { ProjectTranscription } from "@/app/types/transcription";
import type { PipelineStepState } from "@/app/types/pipeline";
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
import { useAssetThumbnail } from "@/app/hooks/use-asset-thumbnail";
import { useProjectStore } from "@/app/lib/store/project-store";

function AssetIcon({ type }: { type: RemoteAsset["type"] }) {
  if (type === "video")
    return <FileVideo className="size-4 text-blue-500" />;
  if (type === "audio")
    return <FileAudio className="size-4 text-emerald-500" />;
  if (type === "image")
    return <FileImage className="size-4 text-amber-500" />;
  if (type === "component")
    return <Code2 className="size-4 text-violet-500" />;
  return <FileIcon className="size-4 text-muted-foreground" />;
}

/** Memoized thumbnail - uses asset service (no client-side extraction) */
const AssetThumbnail = memo(function AssetThumbnail({
  type,
  url,
  thumbnailUrl,
  assetId,
}: {
  type: RemoteAsset["type"];
  url: string;
  thumbnailUrl?: string;
  assetId: string;
}) {
  const [showFallback, setShowFallback] = useState(false);
  const projectId = useProjectStore((s) => s.projectId);
  const { thumbnailUrl: apiThumbnail, isLoading: isLoadingThumbnail } = useAssetThumbnail(
    type === "video" || type === "image" ? assetId : undefined,
    projectId
  );
  const displayThumbnail = apiThumbnail ?? thumbnailUrl ?? null;
  // Only use url for image if it's already on GCP (signed URL); don't load before upload is ready
  const imageLoadableUrl =
    displayThumbnail || (url && url.startsWith("http") ? url : null);

  // Components have no media thumbnail; show icon only (no loading state)
  if (type === "component") {
    return (
      <div className="flex items-center justify-center size-full">
        <AssetIcon type={type} />
      </div>
    );
  }

  if (type === "image") {
    if (imageLoadableUrl && !showFallback) {
      return (
        <>
          <img
            src={imageLoadableUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setShowFallback(true)}
          />
          {showFallback && (
            <div className="flex items-center justify-center">
              <AssetIcon type={type} />
            </div>
          )}
        </>
      );
    }
    return (
      <div className="flex items-center justify-center size-full">
        {isLoadingThumbnail ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <AssetIcon type={type} />
        )}
      </div>
    );
  }

  if (type === "video") {
    // Use thumbnail from API (fresh signed URL), or fallback to icon
    if (displayThumbnail && !showFallback) {
      return (
        <>
          <img
            src={displayThumbnail}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            onError={() => setShowFallback(true)}
          />
          {showFallback && (
            <div className="flex items-center justify-center">
              <AssetIcon type={type} />
            </div>
          )}
        </>
      );
    }

    // Show loading state or fallback icon
    if (isLoadingThumbnail) {
      return (
        <div className="flex items-center justify-center size-full">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center size-full">
        <AssetIcon type={type} />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center size-full">
      <AssetIcon type={type} />
    </div>
  );
});

export interface AssetRowProps {
  asset: RemoteAsset;
  transcription?: ProjectTranscription;
  duration: number;
  /** Pipeline steps for this asset (show progress when any step is running/queued/waiting) */
  pipelineSteps?: PipelineStepState[];
  isSelected: boolean;
  isDeleting: boolean;
  isDownloading: boolean;
  isTranscoding: boolean;
  isDragOver: boolean;
  someSelected: boolean;
  onToggleSelect: (assetId: string, e?: React.MouseEvent) => void;
  onAddToTimeline: (asset: RemoteAsset) => void;
  onStartTranscription: (asset: RemoteAsset) => void;
  onViewTranscription: (assetId: string) => void;
  onViewDetails: (assetId: string) => void;
  onRename: (assetId: string, name: string) => Promise<boolean>;
  onDelete: (assetId: string) => Promise<boolean | void>;
  onDownload: (asset: RemoteAsset) => Promise<void>;
  onDragStart: (asset: RemoteAsset, event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>, assetId: string) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>, assetId: string) => void;
  onReorderHandlePointerDown: () => void;
  onReorderHandlePointerUp: () => void;
  /** When true, show yellow highlight flash (e.g. from chat mention click) */
  isHighlighted?: boolean;
}

export const AssetRow = memo(function AssetRow({
  asset,
  transcription,
  duration,
  pipelineSteps = [],
  isSelected,
  isDeleting,
  isDownloading,
  isTranscoding,
  isDragOver,
  someSelected,
  onToggleSelect,
  onAddToTimeline,
  onStartTranscription,
  onViewTranscription,
  onViewDetails,
  onRename,
  onDelete,
  onDownload,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onReorderHandlePointerDown,
  onReorderHandlePointerUp,
  isHighlighted = false,
}: AssetRowProps) {
  const [editingName, setEditingName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const canTranscribe = asset.type === "audio" || asset.type === "video";
  const isTranscribing = transcription?.status === "processing" || transcription?.status === "pending";
  const hasTranscript = transcription?.status === "completed";
  const hasTranscodeError = asset.transcodeStatus === "error";

  // Pipeline progress: first running step, else first queued/waiting
  const activeStep = pipelineSteps.find(
    (s) => s.status === "running" || s.status === "queued" || s.status === "waiting"
  );
  const completedCount = pipelineSteps.filter(
    (s) => s.status === "succeeded" || s.status === "failed"
  ).length;
  const totalSteps = pipelineSteps.length;
  const allIdle =
    totalSteps > 0 && pipelineSteps.every((s) => s.status === "idle");

  // Required for playback: upload to GCP and metadata extraction must be done
  const REQUIRED_STEP_IDS = ["cloud-upload", "metadata"] as const;
  const stepDone = (id: string) => {
    const step = pipelineSteps.find((s) => s.id === id);
    return !step || step.status === "succeeded" || step.status === "failed";
  };
  const requiredStepsDone = REQUIRED_STEP_IDS.every(stepDone);
  /** Locked when pipeline not initialized yet (e.g. first ~seconds after upload) or when upload + metadata not done. Components have no pipeline. */
  const isPipelineLocked =
    asset.type !== "component" && (totalSteps === 0 || !requiredStepsDone);

  const isLocked = isTranscoding || isPipelineLocked;
  const isProcessing = isDeleting || isDownloading || isTranscoding || isPipelineLocked;

  const pipelineProgress =
    totalSteps > 0
      ? activeStep?.status === "running" && activeStep.progress != null
        ? (completedCount + activeStep.progress) / totalSteps
        : completedCount / totalSteps
      : 0;
  const showPipelineProgress = activeStep != null || allIdle;
  /** Don't show pipeline progress bar for components (they have no pipeline) */
  const showPipelineBar = asset.type !== "component" && showPipelineProgress;

  useEffect(() => {
    if (isEditing) {
      setEditingName(asset.name);
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [isEditing, asset.name]);

  const submitRename = useCallback(async () => {
    const trimmed = editingName.trim();
    setIsEditing(false);
    if (!trimmed || trimmed === asset.name) return;
    await onRename(asset.id, trimmed);
  }, [editingName, asset.id, asset.name, onRename]);

  const startEditing = useCallback(() => {
    setEditingName(asset.name);
    setIsEditing(true);
  }, [asset.name]);

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      if (someSelected) {
        const target = e.target as HTMLElement;
        if (!target.closest("button, [data-drag-handle], input")) {
          onToggleSelect(asset.id);
        }
      }
    },
    [someSelected, onToggleSelect, asset.id]
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-asset-id={asset.id}
          className={cn(
            "group relative flex items-center gap-2 p-2 min-h-[5rem] hover:bg-muted/50 transition-colors rounded-md",
            isLocked ? "cursor-not-allowed opacity-90" : "cursor-grab",
            isDragOver && "bg-primary/10 ring-1 ring-primary/30",
            isHighlighted && "highlight-flash",
            hasTranscodeError && "bg-destructive/5 border border-destructive/20"
          )}
          draggable={!isProcessing}
          onClick={handleRowClick}
          onDragStart={(e) => onDragStart(asset, e)}
          onDragEnd={onDragEnd}
          onDragOver={(e) => onDragOver(e, asset.id)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, asset.id)}
        >
          {/* Processing overlay */}
          {isProcessing && (
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

          {/* Drag handle */}
          <div
            data-drag-handle="reorder"
            className="shrink-0 touch-none cursor-grab active:cursor-grabbing p-1 -m-1"
            title="Drag to reorder"
            onPointerDown={onReorderHandlePointerDown}
            onPointerUp={onReorderHandlePointerUp}
          >
            <GripVertical className="size-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

          {/* Select checkbox */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(asset.id);
            }}
            className={cn(
              "flex items-center justify-center size-5 rounded border shrink-0 transition-colors",
              isSelected
                ? "bg-primary border-primary text-primary-foreground"
                : "border-muted-foreground/50 hover:border-muted-foreground",
              someSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            title={isSelected ? "Deselect" : "Select"}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {isSelected && <Check className="size-3" />}
          </button>

          {/* Thumbnail */}
          <div className="size-10 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
            <AssetThumbnail
              type={asset.type}
              url={asset.url}
              thumbnailUrl={asset.thumbnailUrl}
              assetId={asset.id}
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <Input
                ref={editInputRef}
                className="h-7 text-sm font-medium"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => void submitRename()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitRename();
                  if (e.key === "Escape") setIsEditing(false);
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
                    transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                  >
                    {asset.description || asset.name}
                  </motion.p>
                </AnimatePresence>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {asset.notes ? (
                <span
                  className="shrink-0 text-amber-600 dark:text-amber-500"
                  title={asset.notes}
                >
                  <StickyNote className="size-3.5 inline" />
                </span>
              ) : null}
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
            {showPipelineBar && (
              <div
                className="mt-1.5 flex flex-col gap-1 min-w-0"
                title={activeStep ? `${activeStep.label} · ${activeStep.status}` : "Pipeline idle"}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex-1 min-w-0 h-1 rounded-full bg-muted/80 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/90 transition-all duration-300"
                      style={{ width: `${Math.round(pipelineProgress * 100)}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground truncate shrink-0 max-w-[100px] capitalize">
                    {activeStep
                      ? `${activeStep.label}${activeStep.status === "running" && activeStep.progress != null ? ` ${Math.round(activeStep.progress * 100)}%` : ""}`
                      : "Idle"}
                  </span>
                </div>
              </div>
            )}
            {isTranscribing && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <Loader2 className="size-3 animate-spin" />
                <span>Transcribing...</span>
              </div>
            )}
            {hasTranscodeError && (
              <div
                className="flex items-center gap-1 text-xs text-destructive mt-0.5"
                title={asset.transcodeError || "Transcode failed"}
              >
                <AlertCircle className="size-3" />
                <span className="truncate max-w-[180px]">
                  {asset.transcodeError || "Transcode failed"}
                </span>
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
              disabled={isLocked}
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
                <DropdownMenuItem onClick={startEditing}>
                  <Pencil className="size-4 mr-2" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isLocked}
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
                  <DropdownMenuItem onClick={() => onViewTranscription(asset.id)}>
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
                  disabled={isDownloading}
                  onClick={() => void onDownload(asset)}
                >
                  {isDownloading ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="size-4 mr-2" />
                  )}
                  Download
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={isDeleting}
                  onClick={() => void onDelete(asset.id)}
                >
                  {isDeleting ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="size-4 mr-2" />
                  )}
                  {isDeleting ? "Deleting..." : "Delete"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={startEditing}>
          <Pencil className="size-4 mr-2" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          disabled={isLocked}
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
          disabled={isDownloading}
          onClick={() => void onDownload(asset)}
        >
          {isDownloading ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Download className="size-4 mr-2" />
          )}
          Download
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          disabled={isDeleting}
          onClick={() => void onDelete(asset.id)}
        >
          {isDeleting ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Trash2 className="size-4 mr-2" />
          )}
          {isDeleting ? "Deleting..." : "Delete"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
