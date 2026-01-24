"use client";

import { useProjectStore } from "@/app/lib/store/project-store";

interface TimeRulerProps {
  width: number;
}

export function TimeRuler({ width }: TimeRulerProps) {
  const zoom = useProjectStore((s) => s.zoom);
  const duration = useProjectStore((s) => s.getDuration());

  // Calculate tick marks
  const tickInterval = zoom >= 100 ? 1 : zoom >= 50 ? 2 : zoom >= 25 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += tickInterval) {
    ticks.push(t);
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className="relative h-6 border-b border-border bg-muted/30"
      style={{ width: Math.max(width, duration * zoom) }}
    >
      {ticks.map((t) => (
        <div
          key={t}
          className="absolute top-0 flex h-full flex-col items-center"
          style={{ left: t * zoom }}
        >
          <div className="h-2 w-px bg-border" />
          <span className="text-[10px] text-muted-foreground">{formatTime(t)}</span>
        </div>
      ))}
      {/* Sub-ticks */}
      {zoom >= 50 &&
        Array.from({ length: Math.ceil(duration) }).map((_, i) => (
          <div
            key={`sub-${i}`}
            className="absolute top-0 h-1 w-px bg-border/50"
            style={{ left: (i + 0.5) * zoom }}
          />
        ))}
    </div>
  );
}
