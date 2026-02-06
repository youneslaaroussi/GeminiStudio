"use client";

import { useRef, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
} from "lucide-react";
import { cn } from "@/lib/utils";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export interface MobileTimelineControlsProps {
  hasPlayer: boolean;
  playing: boolean;
  onTogglePlay: () => void;
  muted: boolean;
  loop: boolean;
  speed: number;
  onToggleMute: () => void;
  onToggleLoop: () => void;
  onSpeedChange: (speed: number) => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];

export function MobileTimelineControls({
  hasPlayer,
  playing,
  onTogglePlay,
  muted,
  loop,
  speed,
  onToggleMute,
  onToggleLoop,
  onSpeedChange,
  currentTime,
  duration,
  onSeek,
}: MobileTimelineControlsProps) {
  const progressBarRef = useRef<HTMLDivElement>(null);

  const handleProgressBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = progressBarRef.current;
      if (!bar || duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const time = Math.max(0, Math.min(duration, x * duration));
      onSeek(time);
    },
    [duration, onSeek]
  );

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="shrink-0 flex flex-col border-t border-border bg-card/95 backdrop-blur-sm safe-area-pb">
      {/* Time + seek bar */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="font-mono text-sm tabular-nums text-foreground font-medium">
            {formatTime(currentTime)}
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatTime(duration)}
          </span>
        </div>
        <div
          ref={progressBarRef}
          role="progressbar"
          aria-valuenow={duration > 0 ? progress : 0}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full rounded-full bg-muted cursor-pointer touch-none active:bg-muted/80 transition-colors"
          onClick={handleProgressBarClick}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-75"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Transport: skip back | play/pause | skip forward — large touch targets */}
      <div className="flex items-center justify-center gap-4 px-3 py-3">
        <button
          type="button"
          onClick={() => onSeek(0)}
          className="flex size-11 items-center justify-center rounded-full bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition-all touch-manipulation"
          aria-label="Go to start"
        >
          <SkipBack className="size-5" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={!hasPlayer}
          className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none active:scale-95 transition-all touch-manipulation shadow-md"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <Pause className="size-6 fill-current" />
          ) : (
            <Play className="size-6 fill-current ml-0.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onSeek(duration)}
          className="flex size-11 items-center justify-center rounded-full bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-95 transition-all touch-manipulation"
          aria-label="Go to end"
        >
          <SkipForward className="size-5" />
        </button>
      </div>

      {/* Mute, Loop, Speed — single row, compact */}
      <div className="flex items-center justify-center gap-2 px-3 pb-3 pt-0">
        <button
          type="button"
          onClick={onToggleMute}
          className={cn(
            "flex size-9 items-center justify-center rounded-lg transition-colors touch-manipulation",
            muted
              ? "bg-destructive/15 text-destructive"
              : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onToggleLoop}
          className={cn(
            "flex size-9 items-center justify-center rounded-lg transition-colors touch-manipulation",
            loop
              ? "bg-primary/15 text-primary"
              : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          aria-label={loop ? "Disable loop" : "Enable loop"}
        >
          <Repeat className="size-4" />
        </button>
        <select
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="h-9 rounded-lg bg-muted/50 px-3 text-sm text-foreground border-0 cursor-pointer focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background touch-manipulation"
          aria-label="Playback speed"
        >
          {SPEED_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}x
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
