"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { cn } from "@/lib/utils";
import { TimeRuler } from "../timeline/TimeRuler";
import { LayerTrack } from "../timeline/LayerTrack";
import { Playhead } from "../timeline/Playhead";
import type { ClipType } from "@/app/types/timeline";
import { createLayerTemplate } from "@/app/lib/store/project-store";
import { TRACK_LABEL_WIDTH } from "../timeline/constants";
import { createClipFromAsset, hasAssetDragData, readDraggedAsset } from "@/app/lib/assets/drag";

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
}: TimelinePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  const currentTime = useProjectStore((s) => s.currentTime);
  const setCurrentTime = useProjectStore((s) => s.setCurrentTime);
  const zoom = useProjectStore((s) => s.zoom);
  const setZoom = useProjectStore((s) => s.setZoom);
  const duration = useProjectStore((s) => s.getDuration());
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const splitClipAtTime = useProjectStore((s) => s.splitClipAtTime);
  const layers = useProjectStore((s) => s.project.layers);
  const addLayer = useProjectStore((s) => s.addLayer);
  const addClip = useProjectStore((s) => s.addClip);

  const timelineAreaRef = useRef<HTMLDivElement>(null);
  const [newLayerType, setNewLayerType] = useState<ClipType>("video");
  const hasClips = useMemo(() => layers.some((layer) => layer.clips.length > 0), [layers]);

  const layerCounts = useMemo(() => {
    return layers.reduce<Record<ClipType, number>>(
      (acc, layer) => {
        acc[layer.type] += 1;
        return acc;
      },
      { video: 0, audio: 0, text: 0, image: 0 }
    );
  }, [layers]);

  const handleAddLayer = useCallback(() => {
    const count = layerCounts[newLayerType] + 1;
    addLayer(createLayerTemplate(newLayerType, `${newLayerType} ${count}`));
  }, [addLayer, newLayerType, layerCounts]);

  const handleTimelineDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    []
  );

  const handleTimelineDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event)) return;
      event.preventDefault();
      const asset = readDraggedAsset(event);
      if (!asset) return;
      const area = timelineAreaRef.current;
      if (!area) return;
      const rect = area.getBoundingClientRect();
      const x = event.clientX - rect.left - TRACK_LABEL_WIDTH;
      const start = Math.max(0, x / zoom);
      const clip = createClipFromAsset(asset, start);
      addClip(clip);
    },
    [addClip, zoom]
  );

  // Update container width on resize
  const updateWidth = useCallback(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.clientWidth);
    }
  }, []);

  // Handle clicking on timeline to seek
  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left - TRACK_LABEL_WIDTH;
      const time = Math.max(0, x / zoom);
      setCurrentTime(time);
    },
    [zoom, setCurrentTime]
  );

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
    <div className="flex h-full flex-col" ref={containerRef}>
      {/* Header */}
      <div className="relative flex items-center justify-between border-b border-border px-3 py-2 h-12">
        {/* Left: Time Display */}
        <div className="flex items-center gap-4 z-10 w-1/3">
          <div>
            <p className="text-xs text-muted-foreground font-mono">
              <span className="text-foreground font-medium">{formatTime(currentTime)}</span>
              <span className="opacity-50 mx-1">/</span>
              {formatTime(duration)}
            </p>
          </div>
        </div>

        {/* Center: Transport Controls */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 z-10">
          <button
            type="button"
            onClick={() => setCurrentTime(0)}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Go to Start"
          >
            <SkipBack className="size-4" />
          </button>
          
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!hasPlayer}
            className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 transition-colors shadow-sm"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause className="size-4 fill-current" />
            ) : (
              <Play className="size-4 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setCurrentTime(duration)}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="Go to End"
          >
            <SkipForward className="size-4" />
          </button>
        </div>

        {/* Right: Tools & Zoom */}
        <div className="flex items-center gap-2 z-10 justify-end w-1/3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <select
              value={newLayerType}
              onChange={(e) => setNewLayerType(e.target.value as ClipType)}
              className="rounded border border-border bg-background px-2 py-1"
            >
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="text">Text</option>
              <option value="image">Image</option>
            </select>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
              onClick={handleAddLayer}
              title="Add new layer"
            >
              <Plus className="size-3" />
              Add Layer
            </button>
          </div>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Mute toggle */}
          <button
            type="button"
            onClick={onToggleMute}
            className="flex size-7 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
            title={muted ? "Unmute preview audio" : "Mute preview audio"}
          >
            {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
          </button>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Loop toggle */}
          <button
            type="button"
            onClick={onToggleLoop}
            className={cn(
              "flex size-7 items-center justify-center rounded-md border border-transparent hover:bg-accent text-muted-foreground",
              loop && "text-primary border-primary/40 bg-primary/10"
            )}
            title={loop ? "Disable looping" : "Enable looping"}
          >
            <Repeat className="size-3.5" />
          </button>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Speed */}
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
            Speed
            <select
              value={speed}
              onChange={(e) => onSpeedChange(Number(e.target.value))}
              className="rounded border border-border bg-background px-2 py-1 text-xs"
            >
              {[0.25, 0.5, 0.75, 1, 1.5, 2, 4].map((value) => (
                <option key={value} value={value}>
                  {value}x
                </option>
              ))}
            </select>
          </label>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Split button */}
          <button
            type="button"
            onClick={handleSplit}
            disabled={!selectedClipId}
            className="flex size-7 items-center justify-center rounded-md hover:bg-accent disabled:opacity-30 disabled:pointer-events-none text-muted-foreground hover:text-foreground mr-2 border border-transparent hover:border-border"
            title="Split clip at playhead"
          >
            <Scissors className="size-3.5" />
          </button>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Zoom controls */}
          <button
            type="button"
            onClick={() => setZoom(zoom - 10)}
            className="flex size-7 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
            title="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <div className="flex flex-col items-center w-16">
            {/* Slider could go here, text for now */}
            <span className="text-[10px] text-muted-foreground font-mono">
              {zoom}px/s
            </span>
          </div>
          <button
            type="button"
            onClick={() => setZoom(zoom + 10)}
            className="flex size-7 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
            title="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Timeline content */}
      <div className="flex-1 overflow-auto" onLoad={updateWidth}>
        <div
          ref={timelineAreaRef}
          className="relative min-w-full min-h-full"
          onClick={handleTimelineClick}
          onDragOver={handleTimelineDragOver}
          onDrop={handleTimelineDrop}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setCurrentTime(currentTime - 1);
            if (e.key === "ArrowRight") setCurrentTime(currentTime + 1);
          }}
          tabIndex={0}
          role="slider"
          aria-label="Timeline"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
        >
          {/* Time ruler with track label offset */}
          <div className="flex">
            <div
              className="shrink-0 bg-muted/30 border-r border-border"
              style={{ width: TRACK_LABEL_WIDTH }}
            />
            <TimeRuler width={containerWidth - TRACK_LABEL_WIDTH} />
          </div>

          {/* Tracks */}
          {layers.map((layer) => (
            <LayerTrack
              key={layer.id}
              layer={layer}
              width={containerWidth}
              labelWidth={TRACK_LABEL_WIDTH}
            />
          ))}

          {/* Playhead */}
          <Playhead />

          {!hasClips && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="rounded-lg border border-dashed border-border/80 bg-background/90 px-6 py-4 text-center text-sm text-muted-foreground">
                Timeline is empty. Upload assets or add clips to start building your project.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
