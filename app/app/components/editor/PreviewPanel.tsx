"use client";

import type { Player } from "@motion-canvas/core";
import { ScenePlayer } from "../ScenePlayer";
import type { VideoClip, AudioClip, TextClip } from "@/app/types/timeline";

interface PreviewPanelProps {
  onPlayerChange: (player: Player | null) => void;
  videoClips: VideoClip[];
  audioClips: AudioClip[];
  textClips: TextClip[];
  duration: number;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
}

export function PreviewPanel({
  onPlayerChange,
  videoClips,
  audioClips,
  textClips,
  duration,
  currentTime,
  onTimeUpdate,
}: PreviewPanelProps) {
  const totalClips = videoClips.length + audioClips.length + textClips.length;
  
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Preview</h2>
          <p className="text-xs text-muted-foreground">
            {totalClips} clip{totalClips !== 1 ? "s" : ""} on timeline
            {(videoClips.length > 0 || audioClips.length > 0 || textClips.length > 0) && (
              <span className="ml-1">
                ({videoClips.length} video, {audioClips.length} audio, {textClips.length} text)
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ScenePlayer
          onPlayerChange={onPlayerChange}
          videoClips={videoClips}
          audioClips={audioClips}
          textClips={textClips}
          duration={duration}
          currentTime={currentTime}
          onTimeUpdate={onTimeUpdate}
        />
      </div>
    </div>
  );
}
