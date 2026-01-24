"use client";

import { useProjectStore } from "@/app/lib/store/project-store";
import { Clip } from "./Clip";
import { Type } from "lucide-react";

interface TextTrackProps {
  width: number;
}

export function TextTrack({ width }: TextTrackProps) {
  const textClips = useProjectStore((s) => s.project.textClips);
  const zoom = useProjectStore((s) => s.zoom);
  const duration = useProjectStore((s) => s.getDuration());

  return (
    <div className="flex items-stretch border-b border-border">
      {/* Track label */}
      <div className="flex w-20 shrink-0 items-center gap-1.5 border-r border-border bg-muted/30 px-2 py-2">
        <Type className="size-3.5 text-purple-400" />
        <span className="text-xs font-medium text-muted-foreground">Text</span>
      </div>

      {/* Track content */}
      <div
        className="relative h-12 bg-muted/10"
        style={{ width: Math.max(width - 80, duration * zoom) }}
      >
        {textClips.map((clip) => (
          <Clip key={clip.id} clip={clip} type="text" />
        ))}
      </div>
    </div>
  );
}
