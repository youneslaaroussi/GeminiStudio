"use client";

import { useProjectStore } from "@/app/lib/store/project-store";
import { Clip } from "./Clip";
import { Image as ImageIcon } from "lucide-react";

interface ImageTrackProps {
  width: number;
}

export function ImageTrack({ width }: ImageTrackProps) {
  const imageClips = useProjectStore((s) => s.project.imageClips);
  const zoom = useProjectStore((s) => s.zoom);
  const duration = useProjectStore((s) => s.getDuration());

  return (
    <div className="flex items-stretch border-b border-border">
      {/* Track label */}
      <div className="flex w-20 shrink-0 items-center gap-1.5 border-r border-border bg-muted/30 px-2 py-2">
        <ImageIcon className="size-3.5 text-orange-400" />
        <span className="text-xs font-medium text-muted-foreground">Image</span>
      </div>

      {/* Track content */}
      <div
        className="relative h-12 bg-muted/10"
        style={{ width: Math.max(width - 80, duration * zoom) }}
      >
        {imageClips.map((clip) => (
          <Clip key={clip.id} clip={clip} type="image" />
        ))}
      </div>
    </div>
  );
}
