"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Player } from "@motion-canvas/core";
import { ScenePlayer } from "../ScenePlayer";
import type { Layer, CaptionSettings } from "@/app/types/timeline";
import type { ProjectTranscription } from "@/app/types/transcription";

interface PreviewPanelProps {
  onPlayerChange: (player: Player | null) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  layers: Layer[];
  duration: number;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  transcriptions: Record<string, ProjectTranscription>;
  transitions?: Record<string, any>;
  captionSettings?: CaptionSettings;
  sceneConfig: {
    resolution: { width: number; height: number };
    renderScale: number;
    background: string;
  };
}

export function PreviewPanel({
  onPlayerChange,
  onCanvasReady,
  layers,
  duration,
  currentTime,
  onTimeUpdate,
  transcriptions,
  transitions,
  captionSettings,
  sceneConfig,
}: PreviewPanelProps) {
  const [showUpdateIndicator, setShowUpdateIndicator] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleVariablesUpdated = useCallback(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowUpdateIndicator(true);
    timeoutRef.current = setTimeout(() => setShowUpdateIndicator(false), 600);
  }, []);

  const totalClips = layers.reduce((acc, layer) => acc + layer.clips.length, 0);
  const counts = layers.reduce<Record<"video" | "audio" | "text" | "image", number>>(
    (acc, layer) => {
      acc[layer.type] += layer.clips.length;
      return acc;
    },
    { video: 0, audio: 0, text: 0, image: 0 }
  );
  
  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Preview</h2>
          <p className="text-xs text-muted-foreground">
            {totalClips} clip{totalClips !== 1 ? "s" : ""} on timeline
            {totalClips > 0 && (
              <span className="ml-1">
                ({counts.video} video, {counts.audio} audio, {counts.text} text, {counts.image} image)
              </span>
            )}
          </p>
        </div>
        {/* Update indicator dot */}
        <div
          className={`size-2 rounded-full bg-emerald-500 transition-opacity duration-300 ${
            showUpdateIndicator ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            boxShadow: showUpdateIndicator ? '0 0 6px rgba(16, 185, 129, 0.8)' : 'none',
          }}
        />
      </div>
      <div className="flex-1 overflow-hidden">
          <ScenePlayer
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
            sceneConfig={sceneConfig}
          />
      </div>
    </div>
  );
}
