"use client";

import type { ComponentClip, VisualEffectType } from "@/app/types/timeline";
import type { ComponentInputDef } from "@/app/types/assets";
import { EditableInput } from "@/app/components/ui/EditableInput";
import { EditableTextarea } from "@/app/components/ui/EditableTextarea";
import { cn } from "@/lib/utils";
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";

const VISUAL_EFFECT_OPTIONS: { value: VisualEffectType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "glitch", label: "Glitch" },
  { value: "ripple", label: "Ripple" },
  { value: "vhs", label: "VHS" },
  { value: "pixelate", label: "Pixelate" },
  { value: "chromatic", label: "Chromatic" },
];

interface ComponentClipSettingsProps {
  clip: ComponentClip;
  onUpdate: ClipUpdateHandler;
}

export function ComponentClipSettings({ clip, onUpdate }: ComponentClipSettingsProps) {
  const inputDefs = clip.inputDefs ?? [];
  const inputs = clip.inputs ?? {};

  const handleInputChange = (name: string, value: string | number | boolean) => {
    onUpdate({
      inputs: { ...inputs, [name]: value },
    } as Partial<ComponentClip>);
  };

  return (
    <div className={cardClassName}>
      {/* Component info */}
      <div>
        <label className={labelClassName}>Component</label>
        <p className="text-sm font-mono text-foreground">{clip.componentName}</p>
      </div>

      {/* Dynamic inputs based on inputDefs */}
      {inputDefs.length > 0 && (
        <div className="space-y-2">
          <label className={labelClassName}>Inputs</label>
          {inputDefs.map((def: ComponentInputDef) => (
            <InputField
              key={def.name}
              def={def}
              value={inputs[def.name] ?? def.default}
              onChange={(val) => handleInputChange(def.name, val)}
            />
          ))}
        </div>
      )}

      {/* Visual effect */}
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

      {/* Dimensions */}
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
              } as Partial<ComponentClip>)
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
              } as Partial<ComponentClip>)
            }
          />
        </div>
      </div>
    </div>
  );
}

/** Renders the appropriate input control for a component input definition */
function InputField({
  def,
  value,
  onChange,
}: {
  def: ComponentInputDef;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}) {
  const label = def.label || def.name;

  switch (def.type) {
    case "string":
      // Convert literal \n sequences to actual newlines for display
      let stringValue = String(value);
      // Replace literal backslash-n with actual newline characters
      stringValue = stringValue.replace(/\\n/g, '\n');
      const isMultiline = stringValue.includes('\n') || stringValue.length > 50;
      return (
        <div>
          <label className={labelClassName}>{label}</label>
          {isMultiline ? (
            <EditableTextarea
              value={stringValue}
              className={cn(inputClassName, "min-h-[100px] resize-y text-sm")}
              style={{ 
                fontFamily: 'var(--font-keyboard)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'normal'
              }}
              onValueCommit={(val) => onChange(val)}
              rows={Math.max(3, stringValue.split('\n').length)}
            />
          ) : (
            <EditableInput
              type="text"
              value={stringValue}
              className={inputClassName}
              style={{ fontFamily: 'var(--font-keyboard)' }}
              onValueCommit={(val) => onChange(val)}
            />
          )}
        </div>
      );
    case "number":
      return (
        <div>
          <label className={labelClassName}>{label}</label>
          <EditableInput
            type="number"
            value={Number(value)}
            className={inputClassName}
            onValueCommit={(val) => onChange(toNumber(val) ?? def.default)}
          />
        </div>
      );
    case "boolean":
      return (
        <div className="flex items-center justify-between">
          <label className={labelClassName}>{label}</label>
          <button
            onClick={() => onChange(!value)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              value ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                value ? "translate-x-4.5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      );
    case "color":
      return (
        <div>
          <label className={labelClassName}>{label}</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={String(value)}
              onChange={(e) => onChange(e.target.value)}
              className="h-8 w-8 rounded border border-border cursor-pointer"
            />
            <EditableInput
              type="text"
              value={String(value)}
              className={inputClassName}
              onValueCommit={(val) => onChange(val)}
            />
          </div>
        </div>
      );
    case "enum": {
      const options = def.options?.length ? def.options : [String(def.default)];
      const current = String(value);
      const validValue = options.includes(current) ? current : options[0] ?? "";
      return (
        <div>
          <label className={labelClassName}>{label}</label>
          <select
            value={validValue}
            onChange={(e) => onChange(e.target.value)}
            className={inputClassName}
          >
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    }
    default:
      return null;
  }
}
