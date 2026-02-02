"use client";

import { EditableInput } from "@/app/components/ui/EditableInput";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { TextClip, VisualEffectType, TextTemplateType } from "@/app/types/timeline";

const VISUAL_EFFECT_OPTIONS: { value: VisualEffectType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "glitch", label: "Glitch" },
  { value: "ripple", label: "Ripple" },
  { value: "vhs", label: "VHS" },
  { value: "pixelate", label: "Pixelate" },
  { value: "chromatic", label: "Chromatic" },
];

const TEMPLATE_OPTIONS: { value: TextTemplateType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "title-card", label: "Title Card" },
  { value: "lower-third", label: "Lower Third" },
  { value: "caption-style", label: "Caption Style" },
];
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
  const template = clip.template ?? "text";
  const hasSubtitle = template === "title-card" || template === "lower-third";
  const hasBackground = template !== "text";

  return (
    <div className={cardClassName}>
      {/* Template Type */}
      <div>
        <label className={labelClassName}>Template</label>
        <select
          value={template}
          onChange={(e) => onUpdate({ template: e.target.value as TextTemplateType })}
          className={inputClassName}
        >
          {TEMPLATE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Visual Effect */}
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

      {/* Text Content */}
      <div>
        <label className={labelClassName}>Text Content</label>
        <Textarea
          value={clip.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm resize-none"
        />
      </div>

      {/* Subtitle (for title-card and lower-third) */}
      {hasSubtitle && (
        <div>
          <label className={labelClassName}>Subtitle</label>
          <Input
            value={clip.subtitle ?? ""}
            onChange={(e) => onUpdate({ subtitle: e.target.value })}
            placeholder="Optional subtitle"
            className={inputClassName}
          />
        </div>
      )}

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

      {/* Text Color */}
      <div>
        <label className={labelClassName}>Text Color</label>
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

      {/* Background Color (for templates with backgrounds) */}
      {hasBackground && (
        <div>
          <label className={labelClassName}>Background Color</label>
          <div className="flex items-center gap-2">
            <EditableInput
              type="color"
              value={clip.backgroundColor ?? "#1a1a2e"}
              commitOnChange
              onValueCommit={(val) => onUpdate({ backgroundColor: val })}
              className="size-8 rounded-md border border-border cursor-pointer shrink-0"
            />
            <EditableInput
              type="text"
              value={clip.backgroundColor ?? "#1a1a2e"}
              onValueCommit={(val) => onUpdate({ backgroundColor: val })}
              className={inputClassName}
              placeholder="#1a1a2e"
            />
          </div>
        </div>
      )}
    </div>
  );
}
