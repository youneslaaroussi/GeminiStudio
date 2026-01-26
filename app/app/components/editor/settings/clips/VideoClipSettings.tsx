"use client";

import { EditableInput } from "@/app/components/ui/EditableInput";
import type { VideoClip } from "@/app/types/timeline";
import { VideoEffectsPanel } from "../../VideoEffectsPanel";
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";
import { Button } from "@/components/ui/button";

interface VideoClipSettingsProps {
  clip: VideoClip;
  onUpdate: ClipUpdateHandler;
}

export function VideoClipSettings({ clip, onUpdate }: VideoClipSettingsProps) {
  return (
    <div className="space-y-3">
      <div className={cardClassName}>
        <div>
          <label className={labelClassName}>Fill Mode</label>
          <select
            value={clip.objectFit ?? "fill"}
            onChange={(e) => onUpdate({ objectFit: e.target.value as VideoClip["objectFit"] })}
            className={inputClassName}
          >
            <option value="fill">Stretch</option>
            <option value="contain">Fit</option>
            <option value="cover">Cover</option>
          </select>
        </div>

        <div>
          <label className={labelClassName}>Source URL</label>
          <EditableInput
            type="url"
            value={clip.src}
            className={inputClassName}
            onValueCommit={(val) => onUpdate({ src: val })}
          />
        </div>
      </div>

      {/* Focus Area */}
      <div className={cardClassName}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Focus Area</span>
          {!clip.focus ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-primary"
              onClick={() =>
                onUpdate({
                  focus: { x: 0, y: 0, width: 400, height: 400, padding: 50 },
                })
              }
            >
              Add
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-destructive"
              onClick={() => onUpdate({ focus: undefined })}
            >
              Remove
            </Button>
          )}
        </div>

        {clip.focus && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClassName}>X</label>
                <EditableInput
                  type="number"
                  value={clip.focus.x}
                  className={inputClassName}
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    onUpdate({ focus: { ...clip.focus!, x: next } });
                  }}
                />
              </div>
              <div>
                <label className={labelClassName}>Y</label>
                <EditableInput
                  type="number"
                  value={clip.focus.y}
                  className={inputClassName}
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    onUpdate({ focus: { ...clip.focus!, y: next } });
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClassName}>Width</label>
                <EditableInput
                  type="number"
                  value={clip.focus.width}
                  min={1}
                  className={inputClassName}
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    onUpdate({ focus: { ...clip.focus!, width: Math.max(1, next) } });
                  }}
                />
              </div>
              <div>
                <label className={labelClassName}>Height</label>
                <EditableInput
                  type="number"
                  value={clip.focus.height}
                  min={1}
                  className={inputClassName}
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    onUpdate({ focus: { ...clip.focus!, height: Math.max(1, next) } });
                  }}
                />
              </div>
            </div>
            <div>
              <label className={labelClassName}>Padding</label>
              <EditableInput
                type="number"
                value={clip.focus.padding}
                min={0}
                className={inputClassName}
                onValueCommit={(val) => {
                  const next = toNumber(val);
                  if (next === null) return;
                  onUpdate({ focus: { ...clip.focus!, padding: Math.max(0, next) } });
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Video Effects */}
      <VideoEffectsPanel clip={clip} />
    </div>
  );
}
