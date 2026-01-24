"use client";

import { useCallback, useRef, useState } from "react";
import { Pause, Play, ZoomIn, ZoomOut, Scissors, SkipBack, SkipForward } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { TimeRuler } from "../timeline/TimeRuler";
import { VideoTrack } from "../timeline/VideoTrack";
import { AudioTrack } from "../timeline/AudioTrack";
import { TextTrack } from "../timeline/TextTrack";
import { ImageTrack } from "../timeline/ImageTrack";
import { Playhead } from "../timeline/Playhead";

interface TimelinePanelProps {
  hasPlayer: boolean;
  playing: boolean;
  onTogglePlay: () => void;
}

export function TimelinePanel({
  hasPlayer,
  playing,
  onTogglePlay,
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
      const x = e.clientX - rect.left - 80; // 80px track label offset
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
          className="relative min-w-full"
          onClick={handleTimelineClick}
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
            <div className="w-20 shrink-0 bg-muted/30 border-r border-border" />
            <TimeRuler width={containerWidth - 80} />
          </div>

          {/* Tracks */}
          <VideoTrack width={containerWidth} />
          <AudioTrack width={containerWidth} />
          <TextTrack width={containerWidth} />
          <ImageTrack width={containerWidth} />

          {/* Playhead */}
          <Playhead />
        </div>
      </div>
    </div>
  );
}
