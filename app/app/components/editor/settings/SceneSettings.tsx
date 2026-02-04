"use client";

import { Settings2 } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { EditableInput } from "@/app/components/ui/EditableInput";
import { Combobox } from "@/components/ui/combobox";
import { DEFAULT_TEXT_CLIP_SETTINGS } from "@/app/types/timeline";
import { FONT_FAMILIES } from "@/fonts-config";
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
          <Settings2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">Scene</span>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
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

          {/* Frame Rate */}
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

          {/* Preview Quality */}
          <div>
            <label className={labelClassName}>Preview Quality</label>
            <select
              value={project.previewRenderScale ?? 0.5}
              onChange={(e) =>
                updateProjectSettings({ previewRenderScale: Number(e.target.value) })
              }
              className={inputClassName}
            >
              <option value={0.25}>Quarter (0.25x)</option>
              <option value={0.5}>Half (0.5x)</option>
              <option value={1}>Full (1x)</option>
              <option value={2}>Double (2x)</option>
            </select>
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

          {/* Text clip defaults (font etc., reused from caption settings) */}
          <div className="pt-3 border-t border-border">
            <h3 className="text-xs font-medium mb-3">Text clip defaults</h3>
            {(() => {
              const textClipSettings = project.textClipSettings ?? DEFAULT_TEXT_CLIP_SETTINGS;
              return (
                <>
                  <div>
                    <label className={labelClassName}>Font family</label>
                    <Combobox
                      items={FONT_FAMILIES}
                      value={textClipSettings.fontFamily}
                      onValueChange={(fontFamily) =>
                        updateProjectSettings({
                          textClipSettings: {
                            ...textClipSettings,
                            fontFamily: fontFamily as typeof textClipSettings.fontFamily,
                          },
                        })
                      }
                      placeholder="Select font..."
                      emptyText="No fonts found."
                      itemToStringValue={(fontFamily) => fontFamily.replace(' Variable', '')}
                      itemToFontFamily={(fontFamily) => fontFamily}
                    />
                  </div>
                  <div className="pt-2">
                    <label className={labelClassName}>Font weight</label>
                    <select
                      value={textClipSettings.fontWeight}
                      onChange={(e) =>
                        updateProjectSettings({
                          textClipSettings: {
                            ...textClipSettings,
                            fontWeight: Number(e.target.value) as typeof textClipSettings.fontWeight,
                          },
                        })
                      }
                      className={inputClassName}
                    >
                      <option value="400">Regular</option>
                      <option value="500">Medium</option>
                      <option value="700">Bold</option>
                    </select>
                  </div>
                  <div className="pt-2">
                    <label className={labelClassName}>Default font size</label>
                    <EditableInput
                      type="number"
                      value={textClipSettings.defaultFontSize}
                      min={1}
                      className={inputClassName}
                      onValueCommit={(val) => {
                        const next = toNumber(val);
                        if (next === null) return;
                        updateProjectSettings({
                          textClipSettings: {
                            ...textClipSettings,
                            defaultFontSize: Math.max(1, next),
                          },
                        });
                      }}
                    />
                  </div>
                  <div className="pt-2">
                    <label className={labelClassName}>Default color</label>
                    <div className="flex items-center gap-2">
                      <EditableInput
                        type="color"
                        value={textClipSettings.defaultFill}
                        commitOnChange
                        onValueCommit={(val) =>
                          updateProjectSettings({
                            textClipSettings: { ...textClipSettings, defaultFill: val },
                          })
                        }
                        className="size-8 rounded-md border border-border cursor-pointer shrink-0"
                      />
                      <EditableInput
                        type="text"
                        value={textClipSettings.defaultFill}
                        onValueCommit={(val) =>
                          updateProjectSettings({
                            textClipSettings: { ...textClipSettings, defaultFill: val },
                          })
                        }
                        className={inputClassName}
                        placeholder="#ffffff"
                      />
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
