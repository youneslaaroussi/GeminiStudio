"use client";

import { EditableInput } from "@/app/components/ui/EditableInput";
import type { TimelineClip, VideoClip, AudioClip, ClipAnimationType } from "@/app/types/timeline";
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";
import { ClipTransitionSettings } from "./ClipTransitionSettings";

const CLIP_ANIMATION_OPTIONS: { value: ClipAnimationType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "hover", label: "Hover" },
  { value: "pulse", label: "Pulse" },
  { value: "float", label: "Float" },
  { value: "glow", label: "Glow" },
  { value: "zoom-in", label: "Zoom in" },
  { value: "zoom-out", label: "Zoom out" },
];

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

      {/* Animation (video, text, image only) */}
      {clip.type !== "audio" && (
        <div className="space-y-2">
          <div>
            <label className={labelClassName}>Animation</label>
            <select
              value={(clip as VideoClip).animation ?? "none"}
              onChange={(e) => {
                const v = e.target.value as ClipAnimationType;
                onUpdate({ animation: v === "none" ? undefined : v });
              }}
              className={inputClassName}
            >
              {CLIP_ANIMATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {(clip as VideoClip).animation && (clip as VideoClip).animation !== "none" && (
            <div>
              <div className="flex items-center justify-between">
                <label className={labelClassName}>Intensity</label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {Number(((clip as VideoClip).animationIntensity ?? 1).toFixed(2))}x
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={5}
                step={0.25}
                value={(clip as VideoClip).animationIntensity ?? 1}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  onUpdate({ animationIntensity: val });
                }}
                className="w-full h-2 rounded-md appearance-none bg-muted accent-primary"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
