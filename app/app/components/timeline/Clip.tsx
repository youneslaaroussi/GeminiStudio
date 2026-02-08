"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  ClipType,
  TimelineClip,
  VideoClip,
  AudioClip,
  ImageClip,
  ResolvedTimelineClip,
  ResolvedVideoClip,
  ResolvedAudioClip,
  ResolvedImageClip,
} from "@/app/types/timeline";
import { useProjectStore } from "@/app/lib/store/project-store";
import { addAssetToTimeline } from "@/app/lib/assets/add-asset-to-timeline";
import { hasAssetDragData, readDraggedAsset } from "@/app/lib/assets/drag";
import { cn } from "@/lib/utils";
import { useWaveform } from "@/app/hooks/use-waveform";
import { useAssetFrames } from "@/app/hooks/use-asset-frames";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ClipProps {
  clip: ResolvedTimelineClip;
  layerId: string;
}

export function Clip({ clip, layerId }: ClipProps) {
  const zoom = useProjectStore((s) => s.zoom);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const setSelectedClip = useProjectStore((s) => s.setSelectedClip);
  const updateClip = useProjectStore((s) => s.updateClip);
  const deleteClip = useProjectStore((s) => s.deleteClip);
  const moveClipToLayer = useProjectStore((s) => s.moveClipToLayer);
  const addClipOnNewLayerAbove = useProjectStore((s) => s.addClipOnNewLayerAbove);
  const layers = useProjectStore((s) => s.project.layers);
  const currentTime = useProjectStore((s) => s.currentTime);
  const projectId = useProjectStore((s) => s.projectId);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isAssetDragOver, setIsAssetDragOver] = useState(false);
  const dragStartRef = useRef({ x: 0, start: 0, duration: 0, offset: 0 });
  const activeLayerIdRef = useRef(layerId);
  const clipRef = useRef<HTMLDivElement>(null);
  const [clipHeight, setClipHeight] = useState(0);
  const SNAP_THRESHOLD_PIXELS = 10;

  useEffect(() => {
    activeLayerIdRef.current = layerId;
  }, [layerId]);

  useLayoutEffect(() => {
    if (!clipRef.current) return;
    const element = clipRef.current;
    const updateHeight = () => setClipHeight(element.clientHeight);
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const gridInterval = useMemo(() => {
    if (zoom >= 200) return 1 / 12; // ~5 frames at 60fps
    if (zoom >= 150) return 1 / 6;
    if (zoom >= 100) return 0.25;
    if (zoom >= 60) return 0.5;
    return 1;
  }, [zoom]);

  const snapTargets = useMemo(() => {
    const targets = new Set<number>();
    targets.add(0);
    targets.add(currentTime);
    layers.forEach((layer) => {
      layer.clips.forEach((layerClip) => {
        if (layerClip.id === clip.id) return;
        targets.add(layerClip.start);
        const end = layerClip.start + layerClip.duration / layerClip.speed;
        targets.add(end);
      });
    });
    return Array.from(targets);
  }, [layers, clip.id, currentTime]);

  const snapThresholdSeconds = SNAP_THRESHOLD_PIXELS / Math.max(zoom, 1);

  const snapTime = useCallback(
    (time: number) => {
      let bestTime = Math.max(0, time);
      let bestDiff = snapThresholdSeconds;

      for (const target of snapTargets) {
        const diff = Math.abs(target - time);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestTime = target;
        }
      }

      if (gridInterval > 0) {
        const gridTarget = Math.round(time / gridInterval) * gridInterval;
        const diff = Math.abs(gridTarget - time);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestTime = gridTarget;
        }
      }

      return Math.max(0, bestTime);
    },
    [gridInterval, snapTargets, snapThresholdSeconds]
  );

  const maybeMoveToLayer = useCallback(
    (clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const layerElement = target?.closest("[data-layer-id]") as HTMLElement | null;
      const targetLayerId = layerElement?.dataset.layerId;
      const targetLayerType = layerElement?.dataset.layerType as ClipType | undefined;

      if (
        targetLayerId &&
        targetLayerType === clip.type &&
        targetLayerId !== activeLayerIdRef.current
      ) {
        moveClipToLayer(clip.id, targetLayerId);
        activeLayerIdRef.current = targetLayerId;
      }
    },
    [clip.id, clip.type, moveClipToLayer]
  );

  const isSelected = selectedClipId === clip.id;
  const displayDuration = clip.duration / clip.speed;
  const left = clip.start * zoom;
  const width = displayDuration * zoom;
  const waveformWidth = Math.max(width, 4);
  const hasWaveform = clip.type === "audio" || clip.type === "video";
  const waveformAssetId = (clip as VideoClip | AudioClip).assetId;
  const waveformCacheKey = waveformAssetId;
  const { path: waveformPath, isLoading: waveformLoading } = useWaveform({
    src: hasWaveform ? (clip as ResolvedVideoClip | ResolvedAudioClip).src : undefined,
    cacheKey: hasWaveform ? waveformCacheKey : undefined,
    width: waveformWidth,
    height: clipHeight || 1,
    offsetSeconds: clip.offset,
    durationSeconds: clip.duration,
    mediaType: clip.type === "video" ? "video" : "audio",
    assetId: hasWaveform ? waveformAssetId : undefined,
    projectId,
  });

  const isVideo = clip.type === "video";
  const clipAssetId = (clip as VideoClip).assetId;
  const shouldLoadFilmstrip = isVideo && clipHeight >= 10 && !!clipAssetId;
  const { frames: filmstripFrames, duration: filmstripDuration, isLoading: filmstripLoading } = useAssetFrames(
    shouldLoadFilmstrip ? clipAssetId : undefined,
    projectId
  );

  // Build filmstrip from sampled frames - scale and crop for clip's visible region
  // Frame count scales with zoom: narrow clips use fewer frames, wide clips use more
  const FRAMES_PER_PIXEL = 25; // ~1 frame per 25px of clip width
  const filmstripData = useMemo(() => {
    if (!filmstripFrames.length || !filmstripDuration || filmstripDuration <= 0) return null;
    const clipVisibleDuration = clip.duration;
    const stripWidthPercent = (filmstripDuration / clipVisibleDuration) * 100;
    const offsetPercent = (clip.offset / filmstripDuration) * stripWidthPercent;

    const frameCount = Math.min(
      filmstripFrames.length,
      Math.max(3, Math.floor(waveformWidth / FRAMES_PER_PIXEL))
    );
    const framesToShow =
      frameCount >= filmstripFrames.length
        ? filmstripFrames
        : Array.from({ length: frameCount }, (_, i) =>
            filmstripFrames[Math.floor((i * (filmstripFrames.length - 1)) / (frameCount - 1 || 1))]
          );

    return { stripWidthPercent, offsetPercent, framesToShow };
  }, [
    filmstripFrames,
    filmstripDuration,
    clip.duration,
    clip.offset,
    waveformWidth,
  ]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, action: "drag" | "resize-left" | "resize-right") => {
      e.stopPropagation();
      if (e.button !== 0) {
        return;
      }
      setSelectedClip(clip.id);

      dragStartRef.current = {
        x: e.clientX,
        start: clip.start,
        duration: clip.duration,
        offset: clip.offset,
      };

      if (action === "drag") {
        setIsDragging(true);
      } else {
        setIsResizing(action === "resize-left" ? "left" : "right");
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - dragStartRef.current.x;
        const deltaTime = deltaX / zoom;

        if (action === "drag") {
          const newStart = Math.max(0, dragStartRef.current.start + deltaTime);
          const snappedStart = snapTime(newStart);
          updateClip(clip.id, { start: snappedStart });
          maybeMoveToLayer(moveEvent.clientX, moveEvent.clientY);
        } else if (action === "resize-left") {
          // Resize from left: adjust start, offset, and duration
          const maxDelta = dragStartRef.current.duration / clip.speed - 0.1;
          // For video/audio clips, don't allow offset to go below 0
          const minDelta = -dragStartRef.current.start;
          // Additional constraint: offset cannot go below 0
          const minDeltaForOffset = -dragStartRef.current.offset / clip.speed;
          const effectiveMinDelta = Math.max(minDelta, minDeltaForOffset);
          const clampedDelta = Math.max(effectiveMinDelta, Math.min(maxDelta, deltaTime));
          const newStart = dragStartRef.current.start + clampedDelta;
          const snappedStart = snapTime(newStart);
          const snappedDelta = Math.max(
            effectiveMinDelta,
            Math.min(maxDelta, snappedStart - dragStartRef.current.start)
          );
          const durationChange = snappedDelta * clip.speed;
          const newDuration = Math.max(0.1, dragStartRef.current.duration - durationChange);
          const newOffset = Math.max(0, dragStartRef.current.offset + durationChange);
          updateClip(clip.id, {
            start: dragStartRef.current.start + snappedDelta,
            duration: newDuration,
            offset: newOffset,
          });
        } else if (action === "resize-right") {
          // Resize from right: adjust duration using snapped end time
          const durationChange = deltaTime * clip.speed;
          let tentativeDuration = Math.max(
            0.1,
            dragStartRef.current.duration + durationChange
          );
          
          // For video/audio clips with sourceDuration, don't allow stretching beyond source
          const sourceDuration = (clip.type === "video" || clip.type === "audio") 
            ? (clip as VideoClip | AudioClip).sourceDuration 
            : undefined;
          if (sourceDuration != null) {
            const maxDuration = sourceDuration - dragStartRef.current.offset;
            tentativeDuration = Math.min(tentativeDuration, maxDuration);
          }
          
          const tentativeEnd =
            dragStartRef.current.start + tentativeDuration / clip.speed;
          const snappedEnd = Math.max(
            dragStartRef.current.start + 0.1 / clip.speed,
            snapTime(tentativeEnd)
          );
          let snappedDuration = Math.max(
            0.1,
            (snappedEnd - dragStartRef.current.start) * clip.speed
          );
          
          // Re-apply source duration constraint after snapping
          if (sourceDuration != null) {
            const maxDuration = sourceDuration - dragStartRef.current.offset;
            snappedDuration = Math.min(snappedDuration, maxDuration);
          }
          
          updateClip(clip.id, { duration: snappedDuration });
        }
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        setIsDragging(false);
        setIsResizing(null);
        if (action === "drag") {
          maybeMoveToLayer(upEvent.clientX, upEvent.clientY);
        }
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [clip, zoom, updateClip, setSelectedClip, maybeMoveToLayer, snapTime]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteClip(clip.id);
      }
    },
    [clip.id, deleteClip]
  );

  const handleOpenDeleteDialog = useCallback(
    (event?: Event | React.SyntheticEvent) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      setShowDeleteDialog(true);
    },
    []
  );

  const handleAssetDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasAssetDragData(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (!isAssetDragOver) setIsAssetDragOver(true);
  }, [isAssetDragOver]);

  const handleAssetDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setIsAssetDragOver(false);
  }, []);

  const handleAssetDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setIsAssetDragOver(false);
      const asset = readDraggedAsset(event);
      if (!asset) return;
      const rect = clipRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      const start = Math.max(0, clip.start + x / zoom);
      const duration =
        asset.type === "image" ? 5 : (asset.duration ?? 10);
      const addClipWithNewLayer = (c: Parameters<typeof addClipOnNewLayerAbove>[1]) => {
        addClipOnNewLayerAbove(layerId, c);
      };
      await addAssetToTimeline({
        assetId: asset.id,
        projectId,
        type: asset.type,
        name: asset.name || "Asset",
        duration,
        start,
        width: asset.width,
        height: asset.height,
        sourceDuration: asset.duration,
        addClip: addClipWithNewLayer,
      });
    },
    [clip.start, projectId, zoom, layerId, addClipOnNewLayerAbove]
  );

  return (
    <>
      <div
        ref={clipRef}
        className={cn(
          "absolute top-1 bottom-1 rounded border cursor-move select-none overflow-hidden",
          clip.type === "video"
            ? "bg-blue-500/80 border-blue-400"
            : clip.type === "audio"
            ? "bg-green-500/80 border-green-400"
            : clip.type === "text"
            ? "bg-purple-500/80 border-purple-400"
            : clip.type === "component"
            ? "bg-indigo-500/80 border-indigo-400"
            : "bg-orange-500/80 border-orange-400",
          isSelected && "ring-2 ring-white ring-offset-1 ring-offset-background",
          (isDragging || isResizing) && "opacity-80",
          isAssetDragOver && "ring-2 ring-primary ring-offset-1 ring-offset-background"
        )}
        style={{ left, width: waveformWidth }}
        onMouseDown={(e) => handleMouseDown(e, "drag")}
        onDragOver={handleAssetDragOver}
        onDragLeave={handleAssetDragLeave}
        onDrop={handleAssetDrop}
        onPointerDown={(e) => {
          if (e.button !== 0) {
            e.stopPropagation();
            return;
          }
        }}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={`${clip.type} clip: ${clip.name}`}
        data-clip-id={clip.id}
      >
        <button
          type="button"
          className="absolute right-1 top-1 z-10 rounded-sm bg-black/30 p-1 text-white transition-colors hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleOpenDeleteDialog}
          title="Delete clip"
        >
          <Trash2 className="size-3.5" />
        </button>
        {/* Video filmstrip: built from sampled frames, scaled/cropped via CSS */}
        {isVideo && (
          <div className="pointer-events-none absolute inset-[2px] rounded-sm overflow-hidden bg-black/30">
            {filmstripFrames.length > 0 && filmstripData ? (
              <div
                className="h-full flex"
                style={{
                  width: `${filmstripData.stripWidthPercent}%`,
                  marginLeft: `-${filmstripData.offsetPercent}%`,
                }}
              >
                {filmstripData.framesToShow.map((f) => (
                  <img
                    key={f.index}
                    src={f.url}
                    alt=""
                    className="h-full flex-1 min-w-0 object-cover"
                  />
                ))}
              </div>
            ) : (
              filmstripLoading && (
                <div className="h-full w-full animate-pulse bg-white/10" />
              )
            )}
          </div>
        )}

        {/* Image thumbnail on strip */}
        {clip.type === "image" && (clip as ResolvedImageClip).src && (
          <div className="pointer-events-none absolute inset-[2px] rounded-sm overflow-hidden bg-black/30">
            <img
              src={(clip as ResolvedImageClip).src}
              alt=""
              className="h-full w-full object-cover object-center"
            />
          </div>
        )}

        {hasWaveform && (
          <div className="pointer-events-none absolute inset-[2px] rounded-sm bg-black/20">
            {waveformPath ? (
              <svg
                className="h-full w-full"
                viewBox={`0 0 ${waveformWidth} ${clipHeight || 1}`}
                preserveAspectRatio="none"
              >
                <path
                  d={waveformPath}
                  fill="white"
                  fillOpacity={clip.type === "audio" ? 0.85 : 0.5}
                />
              </svg>
            ) : (
              waveformLoading && (
                <div className="h-full w-full animate-pulse bg-white/10" />
              )
            )}
          </div>
        )}

        {/* Enter transition indicator */}
        {clip.enterTransition && clip.enterTransition.type !== 'none' && (
          <div
            className="absolute left-0 top-0 bottom-0 bg-white/20 border-r border-white/40 pointer-events-none"
            style={{ width: Math.max(4, clip.enterTransition.duration * zoom) }}
          >
            <div
              className="absolute inset-0 opacity-50"
              style={{
                backgroundImage: `repeating-linear-gradient(
                  45deg,
                  transparent,
                  transparent 2px,
                  rgba(255,255,255,0.3) 2px,
                  rgba(255,255,255,0.3) 3px
                )`,
              }}
            />
          </div>
        )}

        {/* Exit transition indicator */}
        {clip.exitTransition && clip.exitTransition.type !== 'none' && (
          <div
            className="absolute right-0 top-0 bottom-0 bg-white/20 border-l border-white/40 pointer-events-none"
            style={{ width: Math.max(4, clip.exitTransition.duration * zoom) }}
          >
            <div
              className="absolute inset-0 opacity-50"
              style={{
                backgroundImage: `repeating-linear-gradient(
                  -45deg,
                  transparent,
                  transparent 2px,
                  rgba(255,255,255,0.3) 2px,
                  rgba(255,255,255,0.3) 3px
                )`,
              }}
            />
          </div>
        )}

        {/* Left resize handle */}
        <div
          className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 z-10"
          onMouseDown={(e) => handleMouseDown(e, "resize-left")}
        />

        {/* Clip content */}
        <div className="px-2 py-1 text-xs text-white truncate pointer-events-none">
          {clip.name}
          {clip.speed !== 1 && (
            <span className="ml-1 opacity-70">{clip.speed}x</span>
          )}
        </div>

        {/* Right resize handle */}
        <div
          className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20 z-10"
          onMouseDown={(e) => handleMouseDown(e, "resize-right")}
        />
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent onPointerDownCapture={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Delete clip?</DialogTitle>
            <DialogDescription>
              This will remove <strong>{clip.name}</strong> from the timeline.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onMouseDown={(e) => {
                e.stopPropagation();
                deleteClip(clip.id);
                setShowDeleteDialog(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
