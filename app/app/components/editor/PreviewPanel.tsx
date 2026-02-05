"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef, useMemo } from "react";
import type { Player } from "@motion-canvas/core";
import { ScenePlayer, type ScenePlayerHandle } from "../ScenePlayer";
import { useProjectStore, setOnFirebaseSync } from "@/app/lib/store/project-store";
import type { Layer, CaptionSettings, TextClipSettings } from "@/app/types/timeline";
import type { ProjectTranscription } from "@/app/types/transcription";
import { Button } from "@/components/ui/button";
import { Crosshair, Maximize2, Minimize2, Play, Pause, RotateCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { SharedMediaLoader } from "@/app/lib/media/shared-media-loader";
import { usePreloadTimelineMedia } from "@/app/hooks/use-preload-timeline-media";

/**
 * Small pie chart indicator for asset preloading progress.
 */
function PreloadPieIndicator({ loaded, total }: { loaded: number; total: number }) {
  if (total === 0) return null;
  
  const progress = total > 0 ? loaded / total : 0;
  const isComplete = loaded >= total;
  
  // Don't show when complete (all assets loaded)
  if (isComplete) return null;
  
  // SVG pie chart using stroke-dasharray technique
  const size = 12;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = `${progress * circumference} ${circumference}`;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div 
          className="relative flex items-center justify-center"
          style={{ width: size, height: size }}
        >
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="transform -rotate-90"
          >
            {/* Background circle */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              className="text-muted-foreground/30"
            />
            {/* Progress arc */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              strokeLinecap="round"
              className="text-amber-500 transition-all duration-150"
            />
          </svg>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>Preloading assets: {loaded}/{total}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export interface PreviewPanelHandle {
  recenter: () => void;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
  isFullscreen: boolean;
}

interface PreviewPanelProps {
  onPlayerChange: (player: Player | null) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onRecenterReady?: (recenter: () => void) => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  onSeek?: (time: number) => void;
  layers: Layer[];
  duration: number;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  transcriptions: Record<string, ProjectTranscription>;
  transitions?: Record<string, any>;
  captionSettings?: CaptionSettings;
  textClipSettings?: TextClipSettings;
  sceneConfig: {
    resolution: { width: number; height: number };
    renderScale: number;
    background: string;
  };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const PreviewPanel = forwardRef<PreviewPanelHandle, PreviewPanelProps>(function PreviewPanel({
  onPlayerChange,
  onCanvasReady,
  onRecenterReady,
  onFullscreenChange,
  isPlaying = false,
  onTogglePlay,
  onSeek,
  layers,
  duration,
  currentTime,
  onTimeUpdate,
  transcriptions,
  transitions,
  captionSettings,
  textClipSettings,
  sceneConfig,
}, ref) {
  const [showUpdateIndicator, setShowUpdateIndicator] = useState(false);
  const [showFirebaseIndicator, setShowFirebaseIndicator] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerKey, setPlayerKey] = useState(0);
  const [fullscreenControlsVisible, setFullscreenControlsVisible] = useState(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const firebaseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fullscreenControlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scenePlayerRef = useRef<ScenePlayerHandle>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Notify SharedMediaLoader of playback state to pause extractions during playback
  useEffect(() => {
    SharedMediaLoader.setPlaybackActive(isPlaying);
  }, [isPlaying]);

  const handleRecenter = useCallback(() => {
    scenePlayerRef.current?.recenter();
  }, []);

  const handleRefresh = useCallback(() => {
    setPlayerKey((k) => k + 1);
  }, []);

  const enterFullscreen = useCallback(() => {
    const el = fullscreenRef.current;
    if (!el) return;
    el.requestFullscreen?.().then(() => {
      setIsFullscreen(true);
      onFullscreenChange?.(true);
      setFullscreenControlsVisible(true);
      if (fullscreenControlsTimeoutRef.current) {
        clearTimeout(fullscreenControlsTimeoutRef.current);
      }
      fullscreenControlsTimeoutRef.current = setTimeout(() => setFullscreenControlsVisible(false), 2500);
    }).catch(() => {});
  }, [onFullscreenChange]);

  const exitFullscreen = useCallback(() => {
    if (!document.fullscreenElement) return;
    document.exitFullscreen?.().then(() => {
      setIsFullscreen(false);
      onFullscreenChange?.(false);
    }).catch(() => {});
  }, [onFullscreenChange]);

  useImperativeHandle(ref, () => ({
    recenter: handleRecenter,
    enterFullscreen,
    exitFullscreen,
    isFullscreen,
  }), [handleRecenter, enterFullscreen, exitFullscreen, isFullscreen]);

  useEffect(() => {
    const onFullscreenChangeEvent = () => {
      const now = !!document.fullscreenElement;
      setIsFullscreen(now);
      onFullscreenChange?.(now);
    };
    document.addEventListener("fullscreenchange", onFullscreenChangeEvent);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChangeEvent);
  }, [onFullscreenChange]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onMove = () => {
      setFullscreenControlsVisible(true);
      if (fullscreenControlsTimeoutRef.current) clearTimeout(fullscreenControlsTimeoutRef.current);
      fullscreenControlsTimeoutRef.current = setTimeout(() => setFullscreenControlsVisible(false), 2500);
    };
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mousemove", onMove);
      if (fullscreenControlsTimeoutRef.current) clearTimeout(fullscreenControlsTimeoutRef.current);
    };
  }, [isFullscreen]);

  const handleProgressBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onSeek || !progressBarRef.current || duration <= 0) return;
      const rect = progressBarRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const time = Math.max(0, Math.min(duration, x * duration));
      onSeek(time);
    },
    [onSeek, duration]
  );

  // Expose recenter function to parent
  useEffect(() => {
    onRecenterReady?.(handleRecenter);
  }, [onRecenterReady, handleRecenter]);

  const handleVariablesUpdated = useCallback(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowUpdateIndicator(true);
    timeoutRef.current = setTimeout(() => setShowUpdateIndicator(false), 600);
  }, []);

  const handleFirebaseSync = useCallback(() => {
    if (firebaseTimeoutRef.current) {
      clearTimeout(firebaseTimeoutRef.current);
    }
    setShowFirebaseIndicator(true);
    firebaseTimeoutRef.current = setTimeout(() => setShowFirebaseIndicator(false), 600);
  }, []);

  useEffect(() => {
    setOnFirebaseSync(handleFirebaseSync);
    return () => {
      setOnFirebaseSync(null);
    };
  }, [handleFirebaseSync]);

  const totalClips = layers.reduce((acc, layer) => acc + layer.clips.length, 0);
  const counts = useMemo(
    () =>
      layers.reduce<Record<"video" | "audio" | "text" | "image", number>>(
        (acc, layer) => {
          acc[layer.type] += layer.clips.length;
          return acc;
        },
        { video: 0, audio: 0, text: 0, image: 0 }
      ),
    [layers]
  );

  // Preload timeline media assets
  const preloadProgress = usePreloadTimelineMedia(layers);

  return (
    <div ref={fullscreenRef} className="h-full flex flex-col min-w-0 bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Preview</h2>
          <p className="text-xs text-muted-foreground">
            {totalClips} clip{totalClips !== 1 ? "s" : ""} on timeline
            <span className="ml-1">
              ({counts.video} video, {counts.audio} audio, {counts.text} text, {counts.image} image)
            </span>
          </p>
        </div>
        {/* Controls and indicator dots */}
        <div className="flex items-center gap-2">
          <TooltipProvider delayDuration={300}>
            {/* Refresh button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={handleRefresh}
                >
                  <RotateCw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Refresh preview (restart player)</p>
              </TooltipContent>
            </Tooltip>
            {/* Recenter button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={handleRecenter}
                >
                  <Crosshair className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Recenter preview (0)</p>
              </TooltipContent>
            </Tooltip>
            {/* Fullscreen button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={isFullscreen ? exitFullscreen : enterFullscreen}
                >
                  {isFullscreen ? (
                    <Minimize2 className="size-4" />
                  ) : (
                    <Maximize2 className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen preview (F)"}</p>
              </TooltipContent>
            </Tooltip>
            {/* Asset preload pie indicator */}
            <PreloadPieIndicator loaded={preloadProgress.loaded} total={preloadProgress.total} />
          </TooltipProvider>
          {/* Motion Canvas update dot */}
          <div
            className={`size-2 rounded-full bg-emerald-500 transition-opacity duration-300 ${
              showUpdateIndicator ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              boxShadow: showUpdateIndicator ? '0 0 6px rgba(16, 185, 129, 0.8)' : 'none',
            }}
            title="Motion Canvas variables updated"
          />
          {/* Firebase sync dot */}
          <div
            className={`size-2 rounded-full bg-blue-500 transition-opacity duration-300 ${
              showFirebaseIndicator ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              boxShadow: showFirebaseIndicator ? '0 0 6px rgba(59, 130, 246, 0.8)' : 'none',
            }}
            title="Firebase state synced"
          />
        </div>
      </div>
      <div className="flex-1 overflow-hidden relative">
        <ScenePlayer
          key={playerKey}
          ref={scenePlayerRef}
          onPlayerChange={onPlayerChange}
          onCanvasReady={onCanvasReady}
          onVariablesUpdated={handleVariablesUpdated}
          layers={layers}
          duration={duration}
          currentTime={currentTime}
          onTimeUpdate={onTimeUpdate}
          transcriptions={transcriptions}
          transitions={transitions}
          captionSettings={captionSettings}
          textClipSettings={textClipSettings}
          sceneConfig={sceneConfig}
        />
        {/* Fullscreen overlay controls */}
        {isFullscreen && (
          <div
            className={`absolute bottom-0 left-0 right-0 z-10 flex flex-col bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${
              fullscreenControlsVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            {/* Progress bar */}
            <div
              ref={progressBarRef}
              role="progressbar"
              aria-valuenow={duration > 0 ? (currentTime / duration) * 100 : 0}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 w-full cursor-pointer bg-white/20 hover:bg-white/30 transition-colors"
              onClick={handleProgressBarClick}
            >
              <div
                className="h-full bg-white/90 transition-[width] duration-75"
                style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%" }}
              />
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-2">
              <div className="flex items-center gap-3">
                {onTogglePlay && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 text-white hover:bg-white/20"
                    onClick={onTogglePlay}
                  >
                    {isPlaying ? (
                      <Pause className="size-5" />
                    ) : (
                      <Play className="size-5" />
                    )}
                  </Button>
                )}
                <span className="text-sm text-white/90 tabular-nums">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 text-white hover:bg-white/20"
                onClick={exitFullscreen}
                title="Exit fullscreen (Esc)"
              >
                <Minimize2 className="size-5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
