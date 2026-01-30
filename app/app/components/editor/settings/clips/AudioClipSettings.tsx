"use client";

import { Volume2 } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { EditableInput } from "@/app/components/ui/EditableInput";
import type { AudioClip } from "@/app/types/timeline";
import { DEFAULT_CAPTION_SETTINGS } from "@/app/types/timeline";
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";

interface AudioClipSettingsProps {
  clip: AudioClip;
  onUpdate: ClipUpdateHandler;
}

export function AudioClipSettings({ clip, onUpdate }: AudioClipSettingsProps) {
  const project = useProjectStore((s) => s.project);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  
  const volumePercent = Math.round(clip.volume * 100);
  const captionSettings = project.captionSettings ?? DEFAULT_CAPTION_SETTINGS;

  return (
    <div className="space-y-3">
      <div className={cardClassName}>
        <div>
          <label className={labelClassName}>Source URL</label>
          <EditableInput
            type="url"
            value={clip.src}
            className={inputClassName}
            onValueCommit={(val) => onUpdate({ src: val })}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={labelClassName}>Volume</label>
            <span className="text-xs font-mono text-muted-foreground">
              {volumePercent}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Volume2 className="size-4 text-muted-foreground shrink-0" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={clip.volume}
              onChange={(e) => onUpdate({ volume: Number(e.target.value) })}
              className="flex-1 h-2"
            />
          </div>
        </div>
      </div>

      {/* Caption Settings - project-wide, applies to audio transcription captions */}
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
    </div>
  );
}
