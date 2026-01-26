"use client";

import { Settings2 } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { EditableInput } from "@/app/components/ui/EditableInput";
import { toNumber, inputClassName, labelClassName, cardClassName } from "./utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function SceneSettings() {
  const project = useProjectStore((s) => s.project);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="w-full flex items-center justify-between py-2 hover:bg-muted/30 rounded-md px-1 -mx-1 transition-colors">
        <div className="flex items-center gap-2">
          <Settings2 className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Scene</span>
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={cn(cardClassName, "mt-2")}>
          {/* Resolution */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClassName}>Width</label>
              <EditableInput
                type="number"
                value={project.resolution.width}
                min={320}
                className={inputClassName}
                onValueCommit={(val) => {
                  const next = toNumber(val);
                  if (next === null) return;
                  updateProjectSettings({
                    resolution: { ...project.resolution, width: next },
                  });
                }}
              />
            </div>
            <div>
              <label className={labelClassName}>Height</label>
              <EditableInput
                type="number"
                value={project.resolution.height}
                min={240}
                className={inputClassName}
                onValueCommit={(val) => {
                  const next = toNumber(val);
                  if (next === null) return;
                  updateProjectSettings({
                    resolution: { ...project.resolution, height: next },
                  });
                }}
              />
            </div>
          </div>

          {/* FPS & Scale */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClassName}>Frame Rate</label>
              <select
                value={project.fps}
                onChange={(e) =>
                  updateProjectSettings({ fps: Number(e.target.value) })
                }
                className={inputClassName}
              >
                {[24, 25, 30, 50, 60].map((fps) => (
                  <option key={fps} value={fps}>
                    {fps} fps
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClassName}>
                Scale ({project.renderScale.toFixed(1)}x)
              </label>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={project.renderScale}
                onChange={(e) =>
                  updateProjectSettings({ renderScale: Number(e.target.value) })
                }
                className="w-full h-8"
              />
            </div>
          </div>

          {/* Background */}
          <div>
            <label className={labelClassName}>Background</label>
            <div className="flex items-center gap-2">
              <EditableInput
                type="color"
                value={project.background}
                commitOnChange
                onValueCommit={(val) => updateProjectSettings({ background: val })}
                className="size-8 rounded-md border border-border cursor-pointer shrink-0"
              />
              <EditableInput
                type="text"
                value={project.background}
                onValueCommit={(val) => updateProjectSettings({ background: val })}
                className={inputClassName}
              />
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
