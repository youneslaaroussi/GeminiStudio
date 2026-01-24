"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipType, TimelineClip } from "@/app/types/timeline";
import { useProjectStore } from "@/app/lib/store/project-store";
import { cn } from "@/lib/utils";

interface ClipProps {
  clip: TimelineClip;
  layerId: string;
}

export function Clip({ clip, layerId }: ClipProps) {
  const zoom = useProjectStore((s) => s.zoom);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const setSelectedClip = useProjectStore((s) => s.setSelectedClip);
  const updateClip = useProjectStore((s) => s.updateClip);
  const deleteClip = useProjectStore((s) => s.deleteClip);
  const moveClipToLayer = useProjectStore((s) => s.moveClipToLayer);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<"left" | "right" | null>(null);
  const dragStartRef = useRef({ x: 0, start: 0, duration: 0, offset: 0 });
  const activeLayerIdRef = useRef(layerId);

  useEffect(() => {
    activeLayerIdRef.current = layerId;
  }, [layerId]);

  const maybeMoveToLayer = useCallback(
    (clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const layerElement = target?.closest("[data-layer-id]") as HTMLElement | null;
      const targetLayerId = layerElement?.dataset.layerId;
      const targetLayerType = layerElement?.dataset.layerType as ClipType | undefined;

      if (
        targetLayerId &&
        targetLayerType === clip.type &&
        targetLayerId !== activeLayerIdRef.current
      ) {
        moveClipToLayer(clip.id, targetLayerId);
        activeLayerIdRef.current = targetLayerId;
      }
    },
    [clip.id, clip.type, moveClipToLayer]
  );

  const isSelected = selectedClipId === clip.id;
  const displayDuration = clip.duration / clip.speed;
  const left = clip.start * zoom;
  const width = displayDuration * zoom;

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
          maybeMoveToLayer(moveEvent.clientX, moveEvent.clientY);
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

      const handleMouseUp = (upEvent: MouseEvent) => {
        setIsDragging(false);
        setIsResizing(null);
        if (action === "drag") {
          maybeMoveToLayer(upEvent.clientX, upEvent.clientY);
        }
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [clip, zoom, updateClip, setSelectedClip, maybeMoveToLayer]
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
        clip.type === "video"
          ? "bg-blue-500/80 border-blue-400"
          : clip.type === "audio"
          ? "bg-green-500/80 border-green-400"
          : clip.type === "text"
          ? "bg-purple-500/80 border-purple-400"
          : "bg-orange-500/80 border-orange-400",
        isSelected && "ring-2 ring-white ring-offset-1 ring-offset-background",
        (isDragging || isResizing) && "opacity-80"
      )}
      style={{ left, width: Math.max(width, 4) }}
      onMouseDown={(e) => handleMouseDown(e, "drag")}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`${clip.type} clip: ${clip.name}`}
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
