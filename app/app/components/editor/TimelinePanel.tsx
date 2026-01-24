"use client";

import { useCallback, useRef, useState } from "react";
import { Pause, Play, ZoomIn, ZoomOut, Scissors } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { TimeRuler } from "../timeline/TimeRuler";
import { VideoTrack } from "../timeline/VideoTrack";
import { AudioTrack } from "../timeline/AudioTrack";
import { TextTrack } from "../timeline/TextTrack";
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
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Timeline</h2>
            <p className="text-xs text-muted-foreground font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <button
            type="button"
            onClick={() => setZoom(zoom - 10)}
            className="flex size-7 items-center justify-center rounded-md hover:bg-accent"
            title="Zoom out"
          >
            <ZoomOut className="size-4 text-muted-foreground" />
          </button>
          <span className="text-xs text-muted-foreground w-12 text-center">
            {zoom}px/s
          </span>
          <button
            type="button"
            onClick={() => setZoom(zoom + 10)}
            className="flex size-7 items-center justify-center rounded-md hover:bg-accent"
            title="Zoom in"
          >
            <ZoomIn className="size-4 text-muted-foreground" />
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Split button */}
          <button
            type="button"
            onClick={handleSplit}
            disabled={!selectedClipId}
            className="flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
            title="Split clip at playhead"
          >
            <Scissors className="size-4 text-muted-foreground" />
          </button>

          {/* Play/Pause */}
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={!hasPlayer}
            className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
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

          {/* Playhead */}
          <Playhead />
        </div>
      </div>
    </div>
  );
}
