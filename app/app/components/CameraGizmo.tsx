"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

// Dynamically import Joystick to avoid SSR issues
const Joystick = dynamic(
  () => import("react-joystick-component").then((mod) => mod.Joystick || mod.default),
  {
    ssr: false,
    loading: () => (
      <div className="size-20 rounded-full border-2 border-white/30 bg-black/60 flex items-center justify-center">
        <div className="size-6 rounded-full bg-blue-500/50" />
      </div>
    ),
  }
);

interface CameraGizmoProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPan: (deltaX: number, deltaY: number) => void;
  className?: string;
}

interface JoystickData {
  x: number | null;
  y: number | null;
  direction: string | null;
}

export function CameraGizmo({
  onZoomIn,
  onZoomOut,
  onPan,
  className,
}: CameraGizmoProps) {
  const handleMove = (data: JoystickData) => {
    if (data.x !== null && data.y !== null) {
      // Normalize to -1 to 1 range and apply sensitivity
      // Invert Y axis: dragging up (negative Y) should pan up (positive deltaY)
      const PAN_SENSITIVITY = 2;
      onPan(data.x * PAN_SENSITIVITY, -data.y * PAN_SENSITIVITY);
    }
  };

  const handleStop = () => {
    // Joystick released, panning stops automatically
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "absolute bottom-4 right-4 z-[100] flex items-end gap-3",
          className
        )}
      >
        {/* Joystick for panning */}
        <div className="relative rounded-lg border-2 border-white/30 bg-black/80 backdrop-blur-md shadow-xl p-2">
          <Joystick
            size={60}
            baseColor="#ffffff30"
            stickColor="#3b82f6"
            move={handleMove}
            stop={handleStop}
            throttle={16}
            sticky={false}
          />
        </div>

        {/* Zoom controls - vertical stack next to joystick */}
        <div className="flex flex-col gap-0.5 rounded-lg border-2 border-white/30 bg-black/80 backdrop-blur-md shadow-xl p-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-white hover:bg-white/20"
                onClick={onZoomIn}
              >
                <ZoomIn className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>Zoom in</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-white hover:bg-white/20"
                onClick={onZoomOut}
              >
                <ZoomOut className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p>Zoom out</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
