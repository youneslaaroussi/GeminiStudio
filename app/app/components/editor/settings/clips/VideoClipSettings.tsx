"use client";

import { useProjectStore } from "@/app/lib/store/project-store";
import { EditableInput } from "@/app/components/ui/EditableInput";
import type { VideoClip } from "@/app/types/timeline";
import { DEFAULT_CAPTION_SETTINGS } from "@/app/types/timeline";
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
  const project = useProjectStore((s) => s.project);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);

  const hasTranscriptions = project.transcriptions &&
    Object.values(project.transcriptions).some(t => t.assetUrl === clip.src);

  const captionSettings = project.captionSettings ?? DEFAULT_CAPTION_SETTINGS;

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

      {/* Caption Settings */}
      {hasTranscriptions && (
        <div className={cardClassName}>
          <h3 className="text-xs font-medium mb-3">Caption Settings</h3>

          <div>
            <label className={labelClassName}>Font Family</label>
            <select
              value={captionSettings.fontFamily}
              onChange={(e) => updateProjectSettings({
                captionSettings: { ...captionSettings, fontFamily: e.target.value as any }
              })}
              className={inputClassName}
            >
              <option value="Inter Variable">Inter</option>
              <option value="Roboto">Roboto</option>
              <option value="Montserrat">Montserrat</option>
              <option value="Poppins">Poppins</option>
            </select>
          </div>

          <div className="pt-2">
            <label className={labelClassName}>Font Weight</label>
            <select
              value={captionSettings.fontWeight}
              onChange={(e) => updateProjectSettings({
                captionSettings: { ...captionSettings, fontWeight: Number(e.target.value) as any }
              })}
              className={inputClassName}
            >
              <option value="400">Regular</option>
              <option value="500">Medium</option>
              <option value="700">Bold</option>
            </select>
          </div>

          <div className="pt-2">
            <label className={labelClassName}>Distance from Bottom (px)</label>
            <EditableInput
              type="number"
              value={captionSettings.distanceFromBottom}
              min={0}
              max={500}
              className={inputClassName}
              onValueCommit={(val) => {
                const next = toNumber(val);
                if (next === null) return;
                updateProjectSettings({
                  captionSettings: { ...captionSettings, distanceFromBottom: Math.max(0, Math.min(500, next)) }
                });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
