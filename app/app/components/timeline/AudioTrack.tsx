"use client";

import { useProjectStore } from "@/app/lib/store/project-store";
import { Clip } from "./Clip";
import { Music } from "lucide-react";

interface AudioTrackProps {
  width: number;
}

export function AudioTrack({ width }: AudioTrackProps) {
  const audioClips = useProjectStore((s) => s.project.audioClips);
  const zoom = useProjectStore((s) => s.zoom);
  const duration = useProjectStore((s) => s.getDuration());

  return (
    <div className="flex items-stretch border-b border-border">
      {/* Track label */}
      <div className="flex w-20 shrink-0 items-center gap-1.5 border-r border-border bg-muted/30 px-2 py-2">
        <Music className="size-3.5 text-green-400" />
        <span className="text-xs font-medium text-muted-foreground">Audio</span>
      </div>

      {/* Track content */}
      <div
        className="relative h-12 bg-muted/10"
        style={{ width: Math.max(width - 80, duration * zoom) }}
      >
        {audioClips.map((clip) => (
          <Clip key={clip.id} clip={clip} type="audio" />
        ))}
      </div>
    </div>
  );
}
