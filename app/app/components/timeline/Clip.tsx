"use client";

import { useCallback, useRef, useState } from "react";
import type { VideoClip, AudioClip, TextClip } from "@/app/types/timeline";
import { getClipEnd } from "@/app/types/timeline";
import { useProjectStore } from "@/app/lib/store/project-store";
import { cn } from "@/lib/utils";

interface ClipProps {
  clip: VideoClip | AudioClip | TextClip;
  type: "video" | "audio" | "text";
}

export function Clip({ clip, type }: ClipProps) {
  const zoom = useProjectStore((s) => s.zoom);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const setSelectedClip = useProjectStore((s) => s.setSelectedClip);
  const updateVideoClip = useProjectStore((s) => s.updateVideoClip);
  const updateAudioClip = useProjectStore((s) => s.updateAudioClip);
  const updateTextClip = useProjectStore((s) => s.updateTextClip);
  const deleteClip = useProjectStore((s) => s.deleteClip);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
  const dragStartRef = useRef({ x: 0, start: 0, duration: 0, offset: 0 });

  const isSelected = selectedClipId === clip.id;
  const displayDuration = clip.duration / clip.speed;
  const left = clip.start * zoom;
  const width = displayDuration * zoom;

  const updateClip =
    type === "video"
      ? updateVideoClip
      : type === "audio"
      ? updateAudioClip
      : updateTextClip;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, action: "drag" | "resize-left" | "resize-right") => {
      e.stopPropagation();
      setSelectedClip(clip.id);

      dragStartRef.current = {
        x: e.clientX,
        start: clip.start,
        duration: clip.duration,
        offset: clip.offset,
      };

      if (action === "drag") {
        setIsDragging(true);
      } else {
        setIsResizing(action === "resize-left" ? "left" : "right");
      }

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - dragStartRef.current.x;
        const deltaTime = deltaX / zoom;

        if (action === "drag") {
          const newStart = Math.max(0, dragStartRef.current.start + deltaTime);
          updateClip(clip.id, { start: newStart });
        } else if (action === "resize-left") {
          // Resize from left: adjust start, offset, and duration
          const maxDelta = dragStartRef.current.duration / clip.speed - 0.1;
          const clampedDelta = Math.max(
            -dragStartRef.current.start,
            Math.min(maxDelta, deltaTime)
          );
          const newStart = dragStartRef.current.start + clampedDelta;
          const durationChange = clampedDelta * clip.speed;
          const newDuration = dragStartRef.current.duration - durationChange;
          const newOffset = dragStartRef.current.offset + durationChange;
          updateClip(clip.id, {
            start: newStart,
            duration: Math.max(0.1, newDuration),
            offset: Math.max(0, newOffset),
          });
        } else if (action === "resize-right") {
          // Resize from right: only adjust duration
          const durationChange = deltaTime * clip.speed;
          const newDuration = Math.max(
            0.1,
            dragStartRef.current.duration + durationChange
          );
          updateClip(clip.id, { duration: newDuration });
        }
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        setIsResizing(null);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [clip, zoom, updateClip, setSelectedClip]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteClip(clip.id);
      }
    },
    [clip.id, deleteClip]
  );

  return (
    <div
      className={cn(
        "absolute top-1 bottom-1 rounded border cursor-move select-none overflow-hidden",
        type === "video"
          ? "bg-blue-500/80 border-blue-400"
          : type === "audio"
          ? "bg-green-500/80 border-green-400"
          : "bg-purple-500/80 border-purple-400",
        isSelected && "ring-2 ring-white ring-offset-1 ring-offset-background",
        (isDragging || isResizing) && "opacity-80"
      )}
      style={{ left, width: Math.max(width, 4) }}
      onMouseDown={(e) => handleMouseDown(e, "drag")}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`${type} clip: ${clip.name}`}
    >
      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20"
        onMouseDown={(e) => handleMouseDown(e, "resize-left")}
      />

      {/* Clip content */}
      <div className="px-2 py-1 text-xs text-white truncate pointer-events-none">
        {clip.name}
        {clip.speed !== 1 && (
          <span className="ml-1 opacity-70">{clip.speed}x</span>
        )}
      </div>

      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/20"
        onMouseDown={(e) => handleMouseDown(e, "resize-right")}
      />
    </div>
  );
}
