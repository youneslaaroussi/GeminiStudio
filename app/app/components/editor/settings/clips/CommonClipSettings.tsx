"use client";

import { EditableInput } from "@/app/components/ui/EditableInput";
import type { TimelineClip, VideoClip, AudioClip } from "@/app/types/timeline";
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";
import { ClipTransitionSettings } from "./ClipTransitionSettings";

interface CommonClipSettingsProps {
  clip: TimelineClip;
  onUpdate: ClipUpdateHandler;
}

export function CommonClipSettings({ clip, onUpdate }: CommonClipSettingsProps) {
  // Get source duration for video/audio clips
  const sourceDuration = (clip.type === "video" || clip.type === "audio")
    ? (clip as VideoClip | AudioClip).sourceDuration
    : undefined;

  // Calculate max allowed duration based on current offset and source duration
  const maxDuration = sourceDuration != null 
    ? Math.max(0.1, sourceDuration - clip.offset) 
    : undefined;

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
            max={maxDuration}
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              let clamped = Math.max(0.1, next);
              // For video/audio, don't allow duration + offset to exceed source
              if (maxDuration != null) {
                clamped = Math.min(clamped, maxDuration);
              }
              onUpdate({ duration: clamped });
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
            max={sourceDuration != null ? Math.max(0, sourceDuration - 0.1) : undefined}
            className={inputClassName}
            onValueCommit={(val) => {
              const next = toNumber(val);
              if (next === null) return;
              let clamped = Math.max(0, next);
              // For video/audio, don't allow offset to exceed source - min duration
              if (sourceDuration != null) {
                clamped = Math.min(clamped, Math.max(0, sourceDuration - 0.1));
                // Also clamp duration if needed
                const newMaxDuration = sourceDuration - clamped;
                if (clip.duration > newMaxDuration) {
                  onUpdate({ offset: clamped, duration: Math.max(0.1, newMaxDuration) });
                  return;
                }
              }
              onUpdate({ offset: clamped });
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

      {/* Transitions */}
      <ClipTransitionSettings clip={clip} onUpdate={onUpdate} />
    </div>
  );
}
