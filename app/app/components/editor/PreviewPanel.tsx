"use client";

import type { Player } from "@motion-canvas/core";
import { ScenePlayer } from "../ScenePlayer";
import type { Layer } from "@/app/types/timeline";

interface PreviewPanelProps {
  onPlayerChange: (player: Player | null) => void;
  layers: Layer[];
  duration: number;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
}

export function PreviewPanel({
  onPlayerChange,
  layers,
  duration,
  currentTime,
  onTimeUpdate,
}: PreviewPanelProps) {
  const totalClips = layers.reduce((acc, layer) => acc + layer.clips.length, 0);
  const counts = layers.reduce<Record<"video" | "audio" | "text" | "image", number>>(
    (acc, layer) => {
      acc[layer.type] += layer.clips.length;
      return acc;
    },
    { video: 0, audio: 0, text: 0, image: 0 }
  );
  
  return (
    <div className="h-full flex flex-col">
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
      </div>
      <div className="flex-1 overflow-hidden">
        <ScenePlayer
          onPlayerChange={onPlayerChange}
          layers={layers}
          duration={duration}
          currentTime={currentTime}
          onTimeUpdate={onTimeUpdate}
        />
      </div>
    </div>
  );
}
