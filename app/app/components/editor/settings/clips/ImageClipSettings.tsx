"use client";

import { EditableInput } from "@/app/components/ui/EditableInput";
import type { ImageClip } from "@/app/types/timeline";
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";

interface ImageClipSettingsProps {
  clip: ImageClip;
  onUpdate: ClipUpdateHandler;
}

export function ImageClipSettings({ clip, onUpdate }: ImageClipSettingsProps) {
  return (
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
