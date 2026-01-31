'use client';

import { ClipTransition, TimelineClip } from '@/app/types/timeline';
import { cn } from '@/lib/utils';
import { ArrowLeftRight } from 'lucide-react';

interface TransitionHandleProps {
  prevClip: TimelineClip;
  nextClip: TimelineClip;
  transition?: ClipTransition;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
}

export function TransitionHandle({
  prevClip,
  nextClip,
  transition,
  zoom,
  selected,
  onSelect,
}: TransitionHandleProps) {
  // Only supported for video clips for now
  if (prevClip.type !== 'video' || nextClip.type !== 'video') return null;

  // Calculate position: at the junction
  // prevClip end time
  const endTime = prevClip.start + prevClip.duration / prevClip.speed;
  const position = endTime * zoom;

  // Calculate transition duration width (centered on junction)
  const transitionWidth = transition ? transition.duration * zoom : 0;

  return (
    <div
      className={cn(
        "absolute top-0 bottom-0 z-20 flex items-center justify-center -translate-x-1/2 cursor-pointer group",
        "hover:z-30"
      )}
      style={{
        left: position,
        width: Math.max(24, transitionWidth), // Minimum 24px for interaction
      }}
      onMouseDown={(e) => {
        e.stopPropagation(); // Prevent timeline seek
        onSelect();
      }}
      data-transition-handle
    >
      {/* Transition Duration Overlay - visual representation of the overlap */}
      {transition && transitionWidth > 0 && (
        <div
          className={cn(
            "absolute top-1 bottom-1 rounded-sm pointer-events-none",
            selected
              ? "bg-primary/30 border border-primary/60"
              : "bg-primary/15 border border-primary/30 group-hover:bg-primary/25"
          )}
          style={{
            width: transitionWidth,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          {/* Diagonal stripes pattern to indicate overlap */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: `repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 3px,
                currentColor 3px,
                currentColor 4px
              )`,
            }}
          />
        </div>
      )}

      {/* Visual Guide Line - center line at junction */}
      <div
        className={cn(
          "absolute w-px h-full z-10",
          selected ? "bg-primary" : "bg-transparent group-hover:bg-primary/50"
        )}
        style={{ left: '50%', transform: 'translateX(-50%)' }}
      />

      {/* Icon Badge */}
      <div className={cn(
        "relative z-20 w-5 h-5 rounded-full flex items-center justify-center shadow-sm border transform scale-0 group-hover:scale-100",
        selected && "scale-100",
        transition
          ? (selected ? "bg-primary border-primary text-primary-foreground" : "bg-secondary border-primary/20 text-secondary-foreground scale-100")
          : "bg-background border-border"
      )}>
        {transition ? (
          <ArrowLeftRight className="size-2.5" />
        ) : (
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        )}
      </div>
    </div>
  );
}
