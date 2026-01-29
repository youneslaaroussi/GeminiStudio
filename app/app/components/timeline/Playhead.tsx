"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { TRACK_LABEL_WIDTH } from "./constants";

interface PlayheadProps {
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Left offset in px (e.g. 0 when playhead is inside the scrollable timeline column) */
  labelOffset?: number;
}

export function Playhead({ onPointerDown, labelOffset = TRACK_LABEL_WIDTH }: PlayheadProps) {
  const currentTime = useProjectStore((s) => s.currentTime);
  const zoom = useProjectStore((s) => s.zoom);

  const left = currentTime * zoom + labelOffset;

  return (
    <div
      className="absolute top-0 bottom-0 z-10 cursor-col-resize"
      style={{ left }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown?.(event);
      }}
      role="separator"
      aria-label="Timeline playhead"
      aria-valuenow={currentTime}
      aria-orientation="vertical"
    >
      {/* Playhead marker */}
      <div className="absolute -top-1 -translate-x-1/2 pointer-events-none">
        <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-red-500" />
      </div>
      {/* Playhead line */}
      <div className="w-px h-full bg-red-500 pointer-events-none" />
    </div>
  );
}
