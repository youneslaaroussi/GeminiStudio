"use client";

import { EditableInput } from "@/app/components/ui/EditableInput";
import { Textarea } from "@/components/ui/textarea";
import type { TextClip } from "@/app/types/timeline";
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";

interface TextClipSettingsProps {
  clip: TextClip;
  onUpdate: ClipUpdateHandler;
}

export function TextClipSettings({ clip, onUpdate }: TextClipSettingsProps) {
  return (
    <div className={cardClassName}>
      <div>
        <label className={labelClassName}>Text Content</label>
        <Textarea
          value={clip.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClassName}>Font Size</label>
          <EditableInput
            type="number"
            value={clip.fontSize ?? 48}
            min={1}
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              onUpdate({ fontSize: Math.max(1, next) });
            }}
          />
        </div>
        <div>
          <label className={labelClassName}>Opacity</label>
          <EditableInput
            type="number"
            value={clip.opacity ?? 1}
            step="0.1"
            min={0}
            max={1}
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              onUpdate({ opacity: Math.max(0, Math.min(1, next)) });
            }}
          />
        </div>
      </div>

      <div>
        <label className={labelClassName}>Color</label>
        <div className="flex items-center gap-2">
          <EditableInput
            type="color"
            value={clip.fill ?? "#ffffff"}
            commitOnChange
            onValueCommit={(val) => onUpdate({ fill: val })}
            className="size-8 rounded-md border border-border cursor-pointer shrink-0"
          />
          <EditableInput
            type="text"
            value={clip.fill ?? "#ffffff"}
            onValueCommit={(val) => onUpdate({ fill: val })}
            className={inputClassName}
            placeholder="#ffffff"
          />
        </div>
      </div>
    </div>
  );
}
