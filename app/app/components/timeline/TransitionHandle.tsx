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

  return (
    <div
      className={cn(
        "absolute top-0 bottom-0 z-20 flex items-center justify-center -translate-x-1/2 w-6 cursor-pointer group",
        "hover:z-30"
      )}
      style={{ left: position }}
      onMouseDown={(e) => {
        e.stopPropagation(); // Prevent timeline seek
        onSelect();
      }}
      data-transition-handle
    >
      {/* Visual Guide Line */}
      <div 
        className={cn(
          "absolute w-px h-full transition-all",
           selected ? "bg-primary" : "bg-transparent group-hover:bg-primary/50"
        )}
      />
      
      {/* Icon Badge */}
      <div className={cn(
        "relative w-5 h-5 rounded-full flex items-center justify-center shadow-sm border transition-all transform scale-0 group-hover:scale-100",
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
