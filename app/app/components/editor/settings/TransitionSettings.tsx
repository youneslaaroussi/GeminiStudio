"use client";

import { ArrowLeftRight } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { EditableInput } from "@/app/components/ui/EditableInput";
import {
  parseTransitionKey,
  DEFAULT_TRANSITION,
  type TransitionType,
} from "@/app/types/timeline";
import { toNumber, inputClassName, labelClassName, cardClassName } from "./utils";
import { cn } from "@/lib/utils";

interface TransitionSettingsProps {
  transitionKey: string;
}

export function TransitionSettings({ transitionKey }: TransitionSettingsProps) {
  const project = useProjectStore((s) => s.project);
  const addTransition = useProjectStore((s) => s.addTransition);
  const removeTransition = useProjectStore((s) => s.removeTransition);

  const transition = project.transitions?.[transitionKey];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <ArrowLeftRight className="size-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium">Transition</p>
          <p className="text-xs text-muted-foreground">
            {transition?.type ?? "None"}
          </p>
        </div>
      </div>

      <div className={cardClassName}>
        <div>
          <label className={labelClassName}>Type</label>
          <select
            value={transition?.type ?? "none"}
            onChange={(e) => {
              const type = e.target.value as TransitionType | "none";
              const { fromId, toId } = parseTransitionKey(transitionKey);

              if (type === "none") {
                removeTransition(fromId, toId);
              } else {
                addTransition(fromId, toId, {
                  type,
                  duration: transition?.duration ?? DEFAULT_TRANSITION.duration,
                });
              }
            }}
            className={inputClassName}
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
            <option value="slide-left">Slide Left</option>
            <option value="slide-right">Slide Right</option>
            <option value="slide-up">Slide Up</option>
            <option value="slide-down">Slide Down</option>
          </select>
        </div>

        {transition && (
          <div>
            <label className={labelClassName}>Duration (s)</label>
            <EditableInput
              type="number"
              value={transition.duration}
              step="0.1"
              min="0.1"
              className={inputClassName}
              onValueCommit={(val) => {
                const next = toNumber(val);
                if (next === null) return;
                const { fromId, toId } = parseTransitionKey(transitionKey);
                addTransition(fromId, toId, {
                  ...transition,
                  duration: Math.max(0.1, next),
                });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
