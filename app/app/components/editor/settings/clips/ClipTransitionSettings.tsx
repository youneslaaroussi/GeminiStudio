"use client";

import { ChevronDown } from "lucide-react";
import { EditableInput } from "@/app/components/ui/EditableInput";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { TimelineClip, TransitionType, ClipTransition } from "@/app/types/timeline";
import {
  toNumber,
  inputClassName,
  labelClassName,
  type ClipUpdateHandler,
} from "../utils";
import { cn } from "@/lib/utils";
import { useState } from "react";

const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "slide-left", label: "Slide Left" },
  { value: "slide-right", label: "Slide Right" },
  { value: "slide-up", label: "Slide Up" },
  { value: "slide-down", label: "Slide Down" },
  { value: "zoom", label: "Zoom" },
  { value: "dip-to-black", label: "Dip to Black" },
];

interface ClipTransitionSettingsProps {
  clip: TimelineClip;
  onUpdate: ClipUpdateHandler;
}

export function ClipTransitionSettings({ clip, onUpdate }: ClipTransitionSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const enterType = clip.enterTransition?.type ?? "none";
  const enterDuration = clip.enterTransition?.duration ?? 0.5;
  const exitType = clip.exitTransition?.type ?? "none";
  const exitDuration = clip.exitTransition?.duration ?? 0.5;

  const handleEnterTypeChange = (type: TransitionType) => {
    if (type === "none") {
      onUpdate({ enterTransition: undefined });
    } else {
      onUpdate({
        enterTransition: {
          type,
          duration: clip.enterTransition?.duration ?? 0.5,
        },
      });
    }
  };

  const handleEnterDurationChange = (duration: number) => {
    if (!clip.enterTransition || clip.enterTransition.type === "none") return;
    onUpdate({
      enterTransition: {
        ...clip.enterTransition,
        duration,
      },
    });
  };

  const handleExitTypeChange = (type: TransitionType) => {
    if (type === "none") {
      onUpdate({ exitTransition: undefined });
    } else {
      onUpdate({
        exitTransition: {
          type,
          duration: clip.exitTransition?.duration ?? 0.5,
        },
      });
    }
  };

  const handleExitDurationChange = (duration: number) => {
    if (!clip.exitTransition || clip.exitTransition.type === "none") return;
    onUpdate({
      exitTransition: {
        ...clip.exitTransition,
        duration,
      },
    });
  };

  const hasTransitions = enterType !== "none" || exitType !== "none";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
        <span className="flex items-center gap-1.5">
          Transitions
          {hasTransitions && (
            <span className="size-1.5 rounded-full bg-primary" />
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-2">
        {/* Enter Transition */}
        <div className="space-y-2">
          <label className={labelClassName}>Enter Transition</label>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={enterType}
              onChange={(e) => handleEnterTypeChange(e.target.value as TransitionType)}
              className={inputClassName}
            >
              {TRANSITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <EditableInput
              type="number"
              value={enterDuration}
              step="0.1"
              min="0.1"
              max="5"
              disabled={enterType === "none"}
              className={cn(inputClassName, enterType === "none" && "opacity-50")}
              onValueCommit={(val) => {
                const next = toNumber(val);
                if (next === null) return;
                handleEnterDurationChange(Math.max(0.1, Math.min(5, next)));
              }}
            />
          </div>
        </div>

        {/* Exit Transition */}
        <div className="space-y-2">
          <label className={labelClassName}>Exit Transition</label>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={exitType}
              onChange={(e) => handleExitTypeChange(e.target.value as TransitionType)}
              className={inputClassName}
            >
              {TRANSITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <EditableInput
              type="number"
              value={exitDuration}
              step="0.1"
              min="0.1"
              max="5"
              disabled={exitType === "none"}
              className={cn(inputClassName, exitType === "none" && "opacity-50")}
              onValueCommit={(val) => {
                const next = toNumber(val);
                if (next === null) return;
                handleExitDurationChange(Math.max(0.1, Math.min(5, next)));
              }}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
