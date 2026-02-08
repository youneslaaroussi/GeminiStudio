"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pause,
  Play,
  ZoomIn,
  ZoomOut,
  Scissors,
  SkipBack,
  SkipForward,
  Plus,
  Volume2,
  VolumeX,
  Repeat,
  MousePointer2,
  Hand,
} from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { cn } from "@/lib/utils";
import { TimeRuler } from "../timeline/TimeRuler";
import { LayerTrackLabel, LayerTrackBody } from "../timeline/LayerTrack";
import { Playhead } from "../timeline/Playhead";
import type { ClipType } from "@/app/types/timeline";
import { createLayerTemplate } from "@/app/lib/store/project-store";
import { TRACK_LABEL_WIDTH } from "../timeline/constants";
import { addAssetToTimeline } from "@/app/lib/assets/add-asset-to-timeline";
import {
  hasAssetDragData,
  readDraggedAsset,
  hasTemplateDragData,
  readDraggedTemplate,
  createClipFromTemplate,
} from "@/app/lib/assets/drag";
import { usePlaybackResolvedLayers } from "@/app/lib/hooks/usePlaybackResolvedLayers";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

export type TimelineTool = "selection" | "hand";

interface TimelinePanelProps {
  hasPlayer: boolean;
  playing: boolean;
  onTogglePlay: () => void;
  muted: boolean;
  loop: boolean;
  speed: number;
  onToggleMute: () => void;
  onToggleLoop: () => void;
  onSpeedChange: (speed: number) => void;
  timelineTool?: TimelineTool;
  onTimelineToolChange?: (tool: TimelineTool) => void;
}

export function TimelinePanel({
  hasPlayer,
  playing,
  onTogglePlay,
  muted,
  loop,
  speed,
  onToggleMute,
  onToggleLoop,
  onSpeedChange,
  timelineTool = "selection",
  onTimelineToolChange,
}: TimelinePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const horizontalScrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  const currentTime = useProjectStore((s) => s.currentTime);
  const setCurrentTime = useProjectStore((s) => s.setCurrentTime);
  const zoom = useProjectStore((s) => s.zoom);
  const setZoom = useProjectStore((s) => s.setZoom);
  const duration = useProjectStore((s) => s.getDuration());
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const splitClipAtTime = useProjectStore((s) => s.splitClipAtTime);
  const layers = useProjectStore((s) => s.project.layers);
  const projectId = useProjectStore((s) => s.projectId);
  const { layers: resolvedLayers } = usePlaybackResolvedLayers(layers, projectId);
  const addLayer = useProjectStore((s) => s.addLayer);
  const addClip = useProjectStore((s) => s.addClip);
  const reorderLayers = useProjectStore((s) => s.reorderLayers);
  const addingAssetToTimelineCount = useProjectStore((s) => s.addingAssetToTimelineCount);
  const startAddingAssetToTimeline = useProjectStore((s) => s.startAddingAssetToTimeline);
  const finishAddingAssetToTimeline = useProjectStore((s) => s.finishAddingAssetToTimeline);

  const [draggedLayerIndex, setDraggedLayerIndex] = useState<number | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<"above" | "below">("below");
  const [isEmptyDropTarget, setIsEmptyDropTarget] = useState(false);

  const handleLayerDragStart = useCallback((index: number) => {
    setDraggedLayerIndex(index);
  }, []);

  const handleLayerDragOver = useCallback((index: number, position: "above" | "below") => {
    setDragTargetIndex(index);
    setDropPosition(position);
  }, []);

  const handleLayerDrop = useCallback((targetIndex: number, position: "above" | "below") => {
    if (draggedLayerIndex === null) return;

    let insertIndex = position === "above" ? targetIndex : targetIndex + 1;
    // Adjust if dragging from above the target
    if (draggedLayerIndex < insertIndex) {
      insertIndex -= 1;
    }
    if (draggedLayerIndex !== insertIndex) {
      reorderLayers(draggedLayerIndex, insertIndex);
    }
    setDraggedLayerIndex(null);
    setDragTargetIndex(null);
  }, [draggedLayerIndex, reorderLayers]);

  const handleLayerDragEnd = useCallback(() => {
    setDraggedLayerIndex(null);
    setDragTargetIndex(null);
  }, []);

  const timelineAreaRef = useRef<HTMLDivElement>(null);
  const [newLayerType, setNewLayerType] = useState<ClipType>("video");
  const hasClips = useMemo(() => layers.some((layer) => layer.clips.length > 0), [layers]);
  const scrubTargetRef = useRef<EventTarget | null>(null);
  const scrubPointerIdRef = useRef<number | null>(null);
  const pointerMoveHandlerRef = useRef<((event: PointerEvent) => void) | null>(null);
  const pointerUpHandlerRef = useRef<((event: PointerEvent) => void) | null>(null);
  const gestureScaleRef = useRef(1);
  const [isHandPanning, setIsHandPanning] = useState(false);
  const handPanStartRef = useRef<{ scrollLeft: number; scrollTop: number; clientX: number; clientY: number } | null>(null);

  const layerCounts = useMemo(() => {
    return layers.reduce<Record<ClipType, number>>(
      (acc, layer) => {
        acc[layer.type] += 1;
        return acc;
      },
      { video: 0, audio: 0, text: 0, image: 0, component: 0 }
    );
  }, [layers]);

  const handleAddLayer = useCallback(() => {
    const count = layerCounts[newLayerType] + 1;
    addLayer(createLayerTemplate(newLayerType, `${newLayerType} ${count}`));
  }, [addLayer, newLayerType, layerCounts]);

  const handleTimelineDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event) && !hasTemplateDragData(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    []
  );

  const handleTimelineDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      const area = timelineAreaRef.current;
      if (!area) return;
      const rect = area.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const start = Math.max(0, x / zoom);

      // Handle asset drops (same path as Add button: fetch playback URL then add)
      if (hasAssetDragData(event)) {
        event.preventDefault();
        const asset = readDraggedAsset(event);
        if (!asset) return;
        const duration =
          asset.type === "image" ? 5 : (asset.duration ?? 10);
        startAddingAssetToTimeline();
        try {
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
            addClip,
            componentName: asset.componentName,
            inputDefs: asset.inputDefs,
          });
        } finally {
          finishAddingAssetToTimeline();
        }
        return;
      }

      // Handle template drops
      if (hasTemplateDragData(event)) {
        event.preventDefault();
        const template = readDraggedTemplate(event);
        if (!template) return;
        const clip = createClipFromTemplate(template, start);
        addClip(clip);
        return;
      }
    },
    [addClip, projectId, zoom, startAddingAssetToTimeline, finishAddingAssetToTimeline]
  );

  // Handlers for empty state drop zone
  const handleEmptyDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event) && !hasTemplateDragData(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!isEmptyDropTarget) setIsEmptyDropTarget(true);
    },
    [isEmptyDropTarget]
  );

  const handleEmptyDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setIsEmptyDropTarget(false);
  }, []);

  const handleEmptyDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      // Handle asset drops (same path as Add button: fetch playback URL then add)
      if (hasAssetDragData(event)) {
        event.preventDefault();
        setIsEmptyDropTarget(false);
        const asset = readDraggedAsset(event);
        if (!asset) return;
        const duration =
          asset.type === "image" ? 5 : (asset.duration ?? 10);
        startAddingAssetToTimeline();
        try {
          await addAssetToTimeline({
            assetId: asset.id,
            projectId,
            type: asset.type,
            name: asset.name || "Asset",
            duration,
            start: 0,
            width: asset.width,
            height: asset.height,
            sourceDuration: asset.duration,
            addClip,
            componentName: asset.componentName,
            inputDefs: asset.inputDefs,
          });
        } finally {
          finishAddingAssetToTimeline();
        }
        return;
      }

      // Handle template drops
      if (hasTemplateDragData(event)) {
        event.preventDefault();
        setIsEmptyDropTarget(false);
        const template = readDraggedTemplate(event);
        if (!template) return;
        const clip = createClipFromTemplate(template, 0);
        addClip(clip);
        return;
      }
    },
    [addClip, projectId, startAddingAssetToTimeline, finishAddingAssetToTimeline]
  );

  // Update container width on resize
  useEffect(() => {
    if (!containerRef.current) return;
    const element = containerRef.current;
    const updateWidth = () => setContainerWidth(element.clientWidth);
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(updateWidth);
    setContainerWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = timelineAreaRef.current;
    if (!node) return;
    type GestureEventLike = Event & { scale?: number };

    const handleGestureStart = (event: GestureEventLike) => {
      event.preventDefault();
      gestureScaleRef.current = event.scale ?? 1;
    };

    const handleGestureChange = (event: GestureEventLike) => {
      event.preventDefault();
      const scale = event.scale ?? 1;
      const deltaScale = scale - gestureScaleRef.current;
      gestureScaleRef.current = scale;
      if (Math.abs(deltaScale) < 0.005) {
        return;
      }
      const scroller = horizontalScrollRef.current;
      if (!scroller) return;
      const sensitivity = 500;
      scroller.scrollLeft -= deltaScale * sensitivity;
    };

    const handleGestureEnd = (event: GestureEventLike) => {
      event.preventDefault();
      gestureScaleRef.current = 1;
    };

    const passiveOptions = { passive: false } as AddEventListenerOptions;
    node.addEventListener("gesturestart", handleGestureStart, passiveOptions);
    node.addEventListener("gesturechange", handleGestureChange, passiveOptions);
    node.addEventListener("gestureend", handleGestureEnd, passiveOptions);
    return () => {
      node.removeEventListener("gesturestart", handleGestureStart, passiveOptions);
      node.removeEventListener("gesturechange", handleGestureChange, passiveOptions);
      node.removeEventListener("gestureend", handleGestureEnd, passiveOptions);
    };
  }, []);

  useEffect(
    () => () => {
      if (pointerMoveHandlerRef.current) {
        window.removeEventListener("pointermove", pointerMoveHandlerRef.current);
        pointerMoveHandlerRef.current = null;
      }
      if (pointerUpHandlerRef.current) {
        window.removeEventListener("pointerup", pointerUpHandlerRef.current);
        pointerUpHandlerRef.current = null;
      }
      const target = scrubTargetRef.current as HTMLElement | null;
      if (target) {
        try {
          const pointerId = scrubPointerIdRef.current;
          if (pointerId !== null) {
            target.releasePointerCapture?.(pointerId);
          }
        } catch {
          // Ignore release issues
        }
      }
      scrubPointerIdRef.current = null;
    },
    []
  );

    const convertClientXToTime = useCallback(
    (clientX: number) => {
      const area = timelineAreaRef.current;
      if (!area) return 0;
      const rect = area.getBoundingClientRect();
      // timelineAreaRef is the right column; content starts at rect.left
      const x = clientX - rect.left;
      const seconds = x / zoom;
      return Math.min(Math.max(seconds, 0), duration);
    },
    [duration, zoom]
  );

  const handleScrubPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const captureTarget = event.currentTarget;
      scrubTargetRef.current = captureTarget;
      scrubPointerIdRef.current = event.pointerId;
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore if pointer capture isn't supported.
      }
      const updateFromClientX = (clientX: number) => {
        setCurrentTime(convertClientXToTime(clientX));
      };
      updateFromClientX(event.clientX);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updateFromClientX(moveEvent.clientX);
      };
      const handlePointerUp = () => {
        scrubTargetRef.current = null;
        scrubPointerIdRef.current = null;
        try {
          captureTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore release failures
        }
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        pointerMoveHandlerRef.current = null;
        pointerUpHandlerRef.current = null;
      };

      pointerMoveHandlerRef.current = handlePointerMove;
      pointerUpHandlerRef.current = handlePointerUp;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [convertClientXToTime, setCurrentTime]
  );

  const handleHandPanPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const horizontalScroller = horizontalScrollRef.current;
      const verticalScroller = scrollContainerRef.current;
      if (!horizontalScroller && !verticalScroller) return;
      event.preventDefault();
      setIsHandPanning(true);
      handPanStartRef.current = {
        scrollLeft: horizontalScroller?.scrollLeft ?? 0,
        scrollTop: verticalScroller?.scrollTop ?? 0,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      const captureTarget = event.currentTarget;
      try {
        captureTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore
      }
      const handlePointerMove = (e: PointerEvent) => {
        const start = handPanStartRef.current;
        if (!start) return;
        const dx = e.clientX - start.clientX;
        const dy = e.clientY - start.clientY;
        if (horizontalScroller) {
          horizontalScroller.scrollLeft = start.scrollLeft - dx;
        }
        if (verticalScroller) {
          verticalScroller.scrollTop = start.scrollTop - dy;
        }
      };
      const handlePointerUp = () => {
        handPanStartRef.current = null;
        setIsHandPanning(false);
        try {
          captureTarget.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore
        }
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    []
  );

  const handleTimelinePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("[data-clip-id]") ||
        target?.closest("[data-transition-handle]") ||
        target?.closest("button") ||
        target?.closest("[draggable]")
      ) {
        return;
      }
      if (timelineTool === "hand") {
        handleHandPanPointerDown(event);
      } else {
        handleScrubPointerDown(event);
      }
    },
    [handleScrubPointerDown, handleHandPanPointerDown, timelineTool]
  );

  const handleTimelineWheel = useCallback(
    (
      event: Pick<
        WheelEvent,
        "preventDefault" | "stopPropagation" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "deltaX" | "deltaY"
      >
    ) => {
      event.preventDefault();
      event.stopPropagation();

      const verticalScroller = scrollContainerRef.current;
      const horizontalScroller = horizontalScrollRef.current;

      if (event.shiftKey) {
        // Shift + wheel: vertical scroll (layers)
        if (verticalScroller) verticalScroller.scrollTop += event.deltaY;
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        const direction = Math.sign(event.deltaY || event.deltaX || 1);
        const magnitude = Math.max(0.5, Math.abs(event.deltaY) * 0.05);
        const nextZoom = zoom - direction * magnitude * 10;
        setZoom(nextZoom);
        return;
      }

      // Default: horizontal scroll (time) on the right column only
      const dominantDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (horizontalScroller) horizontalScroller.scrollLeft += dominantDelta;
    },
    [setZoom, zoom]
  );

  useEffect(() => {
    const node = timelineAreaRef.current;
    if (!node) return;
    const handleWheel = (event: WheelEvent) => {
      handleTimelineWheel(event);
    };
    const options = { passive: false } as AddEventListenerOptions;
    node.addEventListener("wheel", handleWheel, options);
    return () => {
      node.removeEventListener("wheel", handleWheel, options);
    };
  }, [handleTimelineWheel]);

  // Handle split action
  const handleSplit = useCallback(() => {
    if (selectedClipId) {
      splitClipAtTime(selectedClipId, currentTime);
    }
  }, [selectedClipId, currentTime, splitClipAtTime]);

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30);
    return `${mins}:${secs.toString().padStart(2, "0")}:${frames.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex h-full flex-col min-w-0" ref={containerRef}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 h-11 bg-card/50">
        {/* Time Display */}
        <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1 font-mono text-xs tabular-nums">
          <span className="text-foreground font-medium">{formatTime(currentTime)}</span>
          <span className="text-muted-foreground/60">/</span>
          <span className="text-muted-foreground">{formatTime(duration)}</span>
        </div>

        {/* Transport Controls */}
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCurrentTime(0)}
                  className="p-1.5 rounded-md hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
                >
                  <SkipBack className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Go to Start</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onTogglePlay}
                  disabled={!hasPlayer}
                  className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 transition-colors"
                >
                  {playing ? (
                    <Pause className="size-3.5 fill-current" />
                  ) : (
                    <Play className="size-3.5 fill-current ml-0.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Play / Pause (Space)</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCurrentTime(duration)}
                  className="p-1.5 rounded-md hover:bg-background text-muted-foreground hover:text-foreground transition-colors"
                >
                  <SkipForward className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Go to End</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>

        {/* Playback Options */}
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={onToggleMute}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              muted
                ? "text-destructive bg-destructive/10"
                : "text-muted-foreground hover:bg-background hover:text-foreground"
            )}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={onToggleLoop}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              loop
                ? "text-primary bg-primary/10"
                : "text-muted-foreground hover:bg-background hover:text-foreground"
            )}
            title={loop ? "Disable loop" : "Enable loop"}
          >
            <Repeat className="size-3.5" />
          </button>
          <select
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="h-7 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
            title="Playback speed"
          >
            {[0.25, 0.5, 0.75, 1, 1.5, 2, 4].map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        {/* Timeline tools: Selection (V) / Hand (H) — Premiere-style names */}
        {onTimelineToolChange && (
          <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onTimelineToolChange("selection")}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    timelineTool === "selection"
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:bg-background hover:text-foreground"
                  )}
                  title="Selection (V)"
                  aria-pressed={timelineTool === "selection"}
                >
                  <MousePointer2 className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Selection (V)</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onTimelineToolChange("hand")}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    timelineTool === "hand"
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:bg-background hover:text-foreground"
                  )}
                  title="Hand (H)"
                  aria-pressed={timelineTool === "hand"}
                >
                  <Hand className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Hand (H) — drag to pan timeline</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Edit Tools */}
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={handleSplit}
            disabled={!selectedClipId}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors"
            title="Split clip at playhead (C)"
          >
            <Scissors className="size-3.5" />
          </button>
        </div>

        {/* Add Layer */}
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
          <select
            value={newLayerType}
            onChange={(e) => setNewLayerType(e.target.value as ClipType)}
            className="h-7 rounded-md bg-transparent pl-2 pr-1 text-xs text-muted-foreground cursor-pointer focus:outline-none"
          >
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="text">Text</option>
            <option value="image">Image</option>
          </select>
          <button
            type="button"
            className="flex items-center gap-1 rounded-md bg-background px-2 py-1 text-xs font-medium hover:bg-accent transition-colors"
            onClick={handleAddLayer}
            title="Add new layer"
          >
            <Plus className="size-3" />
            <span className="hidden sm:inline">Layer</span>
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => setZoom(zoom - 10)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <span className="w-12 text-center text-[10px] text-muted-foreground font-mono tabular-nums">
            {zoom}px/s
          </span>
          <button
            type="button"
            onClick={() => setZoom(zoom + 10)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Timeline content: scroll = time, Shift+scroll = layers, Ctrl/Cmd+scroll = zoom. Two columns: fixed labels (left) + scrollable timeline (right). */}
      <div className="relative flex-1 overflow-hidden min-w-0 flex flex-col" title="Scroll: time. Shift+scroll: layers. Ctrl/Cmd+scroll: zoom.">
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        >
          <div className="flex min-h-full">
            {/* Fixed left column: layer labels (always visible) */}
            <div
              className="shrink-0 flex flex-col border-r border-border bg-card"
              style={{ width: TRACK_LABEL_WIDTH }}
            >
              <div
                className="shrink-0 h-6 border-b border-border bg-muted/30"
                style={{ width: TRACK_LABEL_WIDTH }}
              />
              {resolvedLayers.map((layer, index) => (
                <LayerTrackLabel
                  key={layer.id}
                  layer={layer}
                  layerIndex={index}
                  labelWidth={TRACK_LABEL_WIDTH}
                  onDragStart={handleLayerDragStart}
                  onDragOver={handleLayerDragOver}
                  onDrop={handleLayerDrop}
                  onDragEnd={handleLayerDragEnd}
                  isDragTarget={dragTargetIndex === index && draggedLayerIndex !== index}
                  dropPosition={dragTargetIndex === index ? dropPosition : null}
                />
              ))}
            </div>

            {/* Scrollable right column: ruler + tracks + playhead */}
            <div
              ref={horizontalScrollRef}
              className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden flex flex-col"
            >
            <div
              ref={timelineAreaRef}
              className={cn(
                "relative touch-none flex flex-col",
                timelineTool === "hand" && (isHandPanning ? "cursor-grabbing" : "cursor-grab")
              )}
              style={{
                width: Math.max(containerWidth - TRACK_LABEL_WIDTH, duration * zoom),
              }}
              onPointerDown={handleTimelinePointerDown}
                onDragOver={handleTimelineDragOver}
                onDrop={handleTimelineDrop}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    setCurrentTime(currentTime - 1);
                  }
                  if (e.key === "ArrowRight") {
                    e.preventDefault();
                    setCurrentTime(currentTime + 1);
                  }
                }}
                tabIndex={0}
                role="slider"
                aria-label="Timeline"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={currentTime}
              >
                <TimeRuler
                  width={Math.max(containerWidth - TRACK_LABEL_WIDTH, duration * zoom)}
                />
                <div className="relative">
                  {resolvedLayers.map((layer) => (
                    <LayerTrackBody
                      key={layer.id}
                      layer={layer}
                      trackWidth={Math.max(containerWidth - TRACK_LABEL_WIDTH, duration * zoom)}
                    />
                  ))}
                  <Playhead
                    labelOffset={0}
                    onPointerDown={handleScrubPointerDown}
                  />
                </div>
                {/* When Hand tool is active, overlay blocks clip/layer interaction and captures pan */}
                {timelineTool === "hand" && (
                  <div
                    className={cn(
                      "absolute inset-0 touch-none",
                      isHandPanning ? "cursor-grabbing" : "cursor-grab"
                    )}
                    style={{ pointerEvents: "auto" }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      handleHandPanPointerDown(e);
                    }}
                    aria-hidden
                  />
                )}
                {/* Shimmer overlay while adding asset to timeline (e.g. from Assets tab) */}
                {addingAssetToTimelineCount > 0 && (
                  <div
                    className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center bg-background/40 rounded"
                    aria-hidden
                  >
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted/30 overflow-hidden rounded-b">
                      <div
                        className="h-full w-1/3 bg-primary/70 rounded-full"
                        style={{ animation: "asset-shimmer 1s ease-in-out infinite" }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {layers.length === 0 && (
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center transition-colors",
              isEmptyDropTarget && "bg-primary/5"
            )}
            onDragOver={handleEmptyDragOver}
            onDragLeave={handleEmptyDragLeave}
            onDrop={handleEmptyDrop}
          >
            {addingAssetToTimelineCount > 0 && (
              <div className="absolute inset-0 flex items-end justify-center pointer-events-none">
                <div className="w-full max-w-md h-1 bg-muted/30 overflow-hidden rounded-b">
                  <div
                    className="h-full w-1/3 bg-primary/70 rounded-full"
                    style={{ animation: "asset-shimmer 1s ease-in-out infinite" }}
                  />
                </div>
              </div>
            )}
            <div
              className={cn(
                "rounded-lg border border-dashed px-6 py-5 text-center transition-all",
                isEmptyDropTarget
                  ? "border-primary bg-primary/10 scale-105"
                  : "border-border/80 bg-background/90"
              )}
            >
              <img src="/gemini-logo.png" alt="Gemini" className="size-8 mx-auto mb-3 opacity-60" />
              <p className="text-sm text-muted-foreground">
                {addingAssetToTimelineCount > 0
                  ? "Adding to timeline…"
                  : isEmptyDropTarget
                    ? "Drop to add to timeline"
                    : "Drag assets here or add clips to start building your project."}
              </p>
              <p className="text-xs text-muted-foreground/80 mt-1">
                0 clips on timeline (0 video, 0 audio, 0 text, 0 image)
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
