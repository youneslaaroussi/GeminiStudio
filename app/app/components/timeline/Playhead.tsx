"use client";

import { useProjectStore } from "@/app/lib/store/project-store";
import { TRACK_LABEL_WIDTH } from "./constants";

export function Playhead() {
  const currentTime = useProjectStore((s) => s.currentTime);
  const zoom = useProjectStore((s) => s.zoom);

  const left = currentTime * zoom + TRACK_LABEL_WIDTH;

  return (
    <div
      className="absolute top-0 bottom-0 z-10 pointer-events-none"
      style={{ left }}
    >
      {/* Playhead marker */}
      <div className="absolute -top-1 -translate-x-1/2">
        <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500" />
      </div>
      {/* Playhead line */}
      <div className="w-px h-full bg-red-500" />
    </div>
  );
}
