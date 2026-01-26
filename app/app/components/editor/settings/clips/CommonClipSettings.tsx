"use client";

import { EditableInput } from "@/app/components/ui/EditableInput";
import type { TimelineClip } from "@/app/types/timeline";
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";

interface CommonClipSettingsProps {
  clip: TimelineClip;
  onUpdate: ClipUpdateHandler;
}

export function CommonClipSettings({ clip, onUpdate }: CommonClipSettingsProps) {
  return (
    <div className={cardClassName}>
      {/* Name */}
      <div>
        <label className={labelClassName}>Name</label>
        <EditableInput
          value={clip.name}
          className={inputClassName}
          onValueCommit={(val) => onUpdate({ name: val })}
        />
      </div>

      {/* Timing */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClassName}>Start (s)</label>
          <EditableInput
            type="number"
            value={clip.start}
            step="0.1"
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              onUpdate({ start: Math.max(0, next) });
            }}
          />
        </div>
        <div>
          <label className={labelClassName}>Duration (s)</label>
          <EditableInput
            type="number"
            value={clip.duration}
            step="0.1"
            min="0.1"
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              onUpdate({ duration: Math.max(0.1, next) });
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClassName}>Offset (s)</label>
          <EditableInput
            type="number"
            value={clip.offset}
            step="0.1"
            min="0"
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              onUpdate({ offset: Math.max(0, next) });
            }}
          />
        </div>
        <div>
          <label className={labelClassName}>Speed</label>
          <EditableInput
            type="number"
            value={clip.speed}
            step="0.1"
            min="0.1"
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              onUpdate({ speed: Math.max(0.1, next) });
            }}
          />
        </div>
      </div>

      {/* Position */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClassName}>Position X</label>
          <EditableInput
            type="number"
            value={clip.position.x}
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              onUpdate({ position: { ...clip.position, x: next } });
            }}
          />
        </div>
        <div>
          <label className={labelClassName}>Position Y</label>
          <EditableInput
            type="number"
            value={clip.position.y}
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              onUpdate({ position: { ...clip.position, y: next } });
            }}
          />
        </div>
      </div>

      {/* Scale */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClassName}>Scale X</label>
          <EditableInput
            type="number"
            value={clip.scale.x}
            step="0.1"
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              onUpdate({ scale: { ...clip.scale, x: Math.max(0.1, next) } });
            }}
          />
        </div>
        <div>
          <label className={labelClassName}>Scale Y</label>
          <EditableInput
            type="number"
            value={clip.scale.y}
            step="0.1"
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              onUpdate({ scale: { ...clip.scale, y: Math.max(0.1, next) } });
            }}
          />
        </div>
      </div>
    </div>
  );
}
