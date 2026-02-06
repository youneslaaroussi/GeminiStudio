"use client";

import { EditableInput } from "@/app/components/ui/EditableInput";
import type { ResolvedImageClip, ImageClip, VisualEffectType } from "@/app/types/timeline";

const VISUAL_EFFECT_OPTIONS: { value: VisualEffectType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "glitch", label: "Glitch" },
  { value: "ripple", label: "Ripple" },
  { value: "vhs", label: "VHS" },
  { value: "pixelate", label: "Pixelate" },
  { value: "chromatic", label: "Chromatic" },
];
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";

interface ImageClipSettingsProps {
  clip: ResolvedImageClip;
  onUpdate: ClipUpdateHandler;
}

export function ImageClipSettings({ clip, onUpdate }: ImageClipSettingsProps) {
  return (
    <div className={cardClassName}>
      <div>
        <label className={labelClassName}>Visual effect</label>
        <select
          value={clip.effect ?? "none"}
          onChange={(e) => onUpdate({ effect: e.target.value as VisualEffectType })}
          className={inputClassName}
        >
          {VISUAL_EFFECT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClassName}>Width (px)</label>
          <EditableInput
            type="number"
            value={clip.width ?? ""}
            placeholder="Auto"
            className={inputClassName}
            onValueCommit={(val) =>
              onUpdate({
                width: val === "" ? undefined : toNumber(val) ?? undefined,
              })
            }
          />
        </div>
        <div>
          <label className={labelClassName}>Height (px)</label>
          <EditableInput
            type="number"
            value={clip.height ?? ""}
            placeholder="Auto"
            className={inputClassName}
            onValueCommit={(val) =>
              onUpdate({
                height: val === "" ? undefined : toNumber(val) ?? undefined,
              })
            }
          />
        </div>
      </div>
    </div>
  );
}
