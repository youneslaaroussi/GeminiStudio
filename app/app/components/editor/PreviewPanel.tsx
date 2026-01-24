"use client";

import type { Player } from "@motion-canvas/core";
import { ScenePlayer } from "../ScenePlayer";
import type { VideoClip, AudioClip, TextClip, ImageClip } from "@/app/types/timeline";

interface PreviewPanelProps {
  onPlayerChange: (player: Player | null) => void;
  videoClips: VideoClip[];
  audioClips: AudioClip[];
  textClips: TextClip[];
  imageClips: ImageClip[];
  duration: number;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
}

export function PreviewPanel({
  onPlayerChange,
  videoClips,
  audioClips,
  textClips,
  imageClips,
  duration,
  currentTime,
  onTimeUpdate,
}: PreviewPanelProps) {
  const totalClips = videoClips.length + audioClips.length + textClips.length + imageClips.length;
  
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Preview</h2>
          <p className="text-xs text-muted-foreground">
            {totalClips} clip{totalClips !== 1 ? "s" : ""} on timeline
            {(videoClips.length > 0 || audioClips.length > 0 || textClips.length > 0 || imageClips.length > 0) && (
              <span className="ml-1">
                ({videoClips.length} video, {audioClips.length} audio, {textClips.length} text, {imageClips.length} image)
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
          imageClips={imageClips}
          duration={duration}
          currentTime={currentTime}
          onTimeUpdate={onTimeUpdate}
        />
      </div>
    </div>
  );
}
