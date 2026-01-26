"use client";

import { Volume2 } from "lucide-react";
import { EditableInput } from "@/app/components/ui/EditableInput";
import type { AudioClip } from "@/app/types/timeline";
import {
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
  const volumePercent = Math.round(clip.volume * 100);

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
  );
}
