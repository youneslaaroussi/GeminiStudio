"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useAssetsStore } from "@/app/lib/store/assets-store";
import { EditableInput } from "@/app/components/ui/EditableInput";
import type { ResolvedVideoClip, VideoClip, MaskMode, VisualEffectType, ColorGradingSettings, ChromaKeySettings } from "@/app/types/timeline";
import { DEFAULT_COLOR_GRADING } from "@/app/types/timeline";
import { useAssetFrames, getFrameAtTimestamp } from "@/app/hooks/use-asset-frames";
import { Loader2 } from "lucide-react";

const VISUAL_EFFECT_OPTIONS: { value: VisualEffectType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "glitch", label: "Glitch" },
  { value: "ripple", label: "Ripple" },
  { value: "vhs", label: "VHS" },
  { value: "pixelate", label: "Pixelate" },
  { value: "chromatic", label: "Chromatic" },
];
import { DEFAULT_CAPTION_SETTINGS, type CaptionStyleType } from "@/app/types/timeline";
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";
import { Button } from "@/components/ui/button";
import { Settings, Captions, Layers, Palette, RotateCcw, Pipette, Volume2 } from "lucide-react";

const CHROMA_KEY_PRESETS = [
  { label: "Green", color: "#00ff00" },
  { label: "Blue", color: "#0000ff" },
  { label: "Magenta", color: "#ff00ff" },
  { label: "Custom", color: "" },
] as const;

interface VideoClipSettingsProps {
  clip: ResolvedVideoClip;
  onUpdate: ClipUpdateHandler;
}

type TabId = "settings" | "color" | "captions";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: "settings", label: "Settings", icon: <Settings className="size-3.5" /> },
  { id: "color", label: "Color", icon: <Palette className="size-3.5" /> },
  { id: "captions", label: "Captions", icon: <Captions className="size-3.5" /> },
];

// Color grading slider component with optional gradient background
interface ColorSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  gradient?: string;
  formatValue?: (v: number) => string;
}

function ColorSlider({ label, value, min, max, step = 1, onChange, gradient, formatValue }: ColorSliderProps) {
  const displayValue = formatValue ? formatValue(value) : (value > 0 ? `+${value}` : `${value}`);
  const percentage = ((value - min) / (max - min)) * 100;
  
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
        <span className="text-[10px] font-mono text-foreground tabular-nums w-12 text-right">
          {displayValue}
        </span>
      </div>
      <div className="relative h-4 group cursor-grab active:cursor-grabbing">
        {/* Track background with gradient */}
        <div 
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded overflow-hidden"
          style={{ 
            background: gradient || 'linear-gradient(to right, hsl(var(--muted)), hsl(var(--muted)))'
          }}
        />
        {/* Darkened overlay */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded bg-background/50" />
        {/* Slider input */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(0)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-grab active:cursor-grabbing"
          title="Double-click to reset"
        />
        {/* Vertical thumb indicator */}
        <div 
          className="absolute top-0 bottom-0 w-1 bg-white rounded-sm shadow-md pointer-events-none transition-opacity group-hover:opacity-100 opacity-90"
          style={{ 
            left: `calc(${percentage}% - 2px)`,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2)'
          }}
        />
        {/* Center mark for bipolar sliders */}
        {min < 0 && max > 0 && (
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-foreground/30 pointer-events-none" />
        )}
      </div>
    </div>
  );
}

// Gradient presets for different color controls
const GRADIENTS = {
  exposure: 'linear-gradient(to right, #000 0%, #888 50%, #fff 100%)',
  contrast: 'linear-gradient(to right, #666 0%, #aaa 50%, #000 50%, #fff 100%)',
  saturation: 'linear-gradient(to right, #888 0%, #888 50%, #ff6b6b 100%)',
  temperature: 'linear-gradient(to right, #6bb3ff 0%, #888 50%, #ffaa55 100%)',
  tint: 'linear-gradient(to right, #88ff88 0%, #888 50%, #ff88ff 100%)',
  highlights: 'linear-gradient(to right, #888 0%, #888 50%, #fff 100%)',
  shadows: 'linear-gradient(to right, #000 0%, #888 50%, #888 100%)',
};

export function VideoClipSettings({ clip, onUpdate }: VideoClipSettingsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("settings");
  const project = useProjectStore((s) => s.project);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  const assets = useAssetsStore((s) => s.assets);

  const captionSettings = project.captionSettings ?? DEFAULT_CAPTION_SETTINGS;
  const colorGrading = clip.colorGrading ?? DEFAULT_COLOR_GRADING;

  const updateColorGrading = useCallback(
    (key: keyof ColorGradingSettings, value: number) => {
      const current = clip.colorGrading ?? DEFAULT_COLOR_GRADING;
      onUpdate({
        colorGrading: { ...current, [key]: value },
      });
    },
    [clip.colorGrading, onUpdate]
  );

  const resetColorGrading = useCallback(() => {
    onUpdate({ colorGrading: undefined });
  }, [onUpdate]);

  const hasColorGrading = clip.colorGrading && (
    clip.colorGrading.exposure !== 0 ||
    clip.colorGrading.contrast !== 0 ||
    clip.colorGrading.saturation !== 0 ||
    clip.colorGrading.temperature !== 0 ||
    clip.colorGrading.tint !== 0 ||
    clip.colorGrading.highlights !== 0 ||
    clip.colorGrading.shadows !== 0
  );

  // Get video assets that could be used as masks (exclude the current clip's asset)
  const videoAssets = useMemo(() => {
    return assets.filter(
      (asset) => asset.type === "video" && asset.id !== clip.assetId
    );
  }, [assets, clip.assetId]);

  // Find the currently selected mask asset
  const selectedMaskAsset = useMemo(() => {
    if (!clip.maskAssetId) return null;
    return assets.find((a) => a.id === clip.maskAssetId) ?? null;
  }, [assets, clip.maskAssetId]);

  // Mask preview - use sampled frames from asset service
  const [maskFrameTimestamp, setMaskFrameTimestamp] = useState(0);
  const projectId = useProjectStore((s) => s.projectId);
  const maskAssetMetadata = useAssetsStore((s) => s.metadata[clip.maskAssetId ?? ""]);
  const { frames: maskFrames, duration: maskFramesDuration, isLoading: isExtractingMaskFrame } = useAssetFrames(
    selectedMaskAsset?.id,
    projectId
  );
  const maskDuration =
    (maskFramesDuration || maskAssetMetadata?.duration) ?? selectedMaskAsset?.duration ?? 10;
  const maskFrame = getFrameAtTimestamp(maskFrames, maskDuration, maskFrameTimestamp);
  const maskFrameDataUrl = maskFrame?.url ?? null;

  return (
    <div className="space-y-3">
      {/* Tab Bar */}
      <div className="flex rounded-lg border border-border bg-muted/30 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Settings Tab */}
      {activeTab === "settings" && (
        <div className="space-y-3">
          <div className={cardClassName}>
            <div>
              <label className={labelClassName}>Fill Mode</label>
              <select
                value={clip.objectFit ?? "contain"}
                onChange={(e) => onUpdate({ objectFit: e.target.value as VideoClip["objectFit"] })}
                className={inputClassName}
              >
                <option value="fill">Stretch</option>
                <option value="contain">Fit</option>
                <option value="cover">Cover</option>
              </select>
            </div>

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

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelClassName}>Audio volume</label>
                <span className="text-xs font-mono text-muted-foreground">
                  {Math.round((clip.audioVolume ?? 1) * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Volume2 className="size-4 text-muted-foreground shrink-0" />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={clip.audioVolume ?? 1}
                  onChange={(e) => onUpdate({ audioVolume: Number(e.target.value) })}
                  className="flex-1 h-2 rounded accent-primary"
                />
              </div>
            </div>

          </div>

          {/* Focus / Zoom */}
          <div className={cardClassName}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Focus / Zoom</span>
              {!clip.focus ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-primary"
                  onClick={() =>
                    onUpdate({
                      focus: { x: 0.5, y: 0.5, zoom: 1 },
                    })
                  }
                >
                  Add
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-destructive"
                  onClick={() => onUpdate({ focus: undefined })}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Center point (0–1) and zoom ratio. 1 = full frame, 2 = 2× zoom.
            </p>
            {clip.focus && (
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClassName}>Center X</label>
                    <EditableInput
                      type="number"
                      value={clip.focus.x}
                      className={inputClassName}
                      onValueCommit={(val) => {
                        const next = toNumber(val);
                        if (next === null) return;
                        onUpdate({ focus: { ...clip.focus!, x: Math.max(0, Math.min(1, next)) } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Center Y</label>
                    <EditableInput
                      type="number"
                      value={clip.focus.y}
                      className={inputClassName}
                      onValueCommit={(val) => {
                        const next = toNumber(val);
                        if (next === null) return;
                        onUpdate({ focus: { ...clip.focus!, y: Math.max(0, Math.min(1, next)) } });
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClassName}>Zoom</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.1}
                      value={clip.focus.zoom}
                      onChange={(e) =>
                        onUpdate({ focus: { ...clip.focus!, zoom: Math.max(1, Number(e.target.value)) } })
                      }
                      className="flex-1 h-2 rounded accent-primary"
                    />
                    <span className="text-xs tabular-nums w-10">{clip.focus.zoom.toFixed(1)}×</span>
                  </div>
                  <EditableInput
                    type="number"
                    value={clip.focus.zoom}
                    min={1}
                    className={inputClassName + " mt-1"}
                    onValueCommit={(val) => {
                      const next = toNumber(val);
                      if (next === null) return;
                      onUpdate({ focus: { ...clip.focus!, zoom: Math.max(1, next) } });
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Mask Settings */}
          <div className={cardClassName}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers className="size-3.5 text-amber-400" />
                <span className="text-xs font-medium">Mask</span>
              </div>
              {clip.maskAssetId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-destructive"
                  onClick={() => onUpdate({ maskAssetId: undefined, maskMode: undefined })}
                >
                  Remove
                </Button>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground mt-1">
              Apply a binary mask video to show/hide parts of this clip.
            </p>

            <div className="space-y-2 pt-2">
              <div>
                <label className={labelClassName}>Mask Asset</label>
                <select
                  value={clip.maskAssetId ?? ""}
                  onChange={(e) => {
                    const assetId = e.target.value || undefined;
                    const asset = assetId ? assets.find((a) => a.id === assetId) : null;
                    onUpdate({
                      maskAssetId: assetId,
                      maskMode: assetId ? (clip.maskMode ?? "include") : undefined,
                    });
                  }}
                  className={inputClassName}
                >
                  <option value="">None</option>
                  {videoAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </div>

              {clip.maskAssetId && (
                <div>
                  <label className={labelClassName}>Mask Mode</label>
                  <select
                    value={clip.maskMode ?? "include"}
                    onChange={(e) => onUpdate({ maskMode: e.target.value as MaskMode })}
                    className={inputClassName}
                  >
                    <option value="include">Include (show only masked area)</option>
                    <option value="exclude">Exclude (hide masked area)</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {clip.maskMode === "exclude"
                      ? "White areas in the mask will be hidden."
                      : "White areas in the mask will be visible."}
                  </p>
                </div>
              )}

              {selectedMaskAsset && (
                <div className="pt-2 border-t border-border space-y-2">
                  <p className="text-[10px] text-muted-foreground">
                    Using: <span className="text-foreground">{selectedMaskAsset.name}</span>
                  </p>
                  {/* Mask frame preview with slider */}
                  <div className="space-y-2">
                    <div className="relative rounded-md overflow-hidden bg-black aspect-video">
                      {isExtractingMaskFrame ? (
                        <div className="flex items-center justify-center w-full h-full">
                          <Loader2 className="size-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : maskFrameDataUrl ? (
                        <img
                          src={maskFrameDataUrl}
                          alt="Mask preview"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="flex items-center justify-center w-full h-full text-muted-foreground text-xs">
                          No frame available
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Frame position</span>
                        <span className="tabular-nums">
                          {maskFrameTimestamp.toFixed(1)}s / {maskDuration.toFixed(1)}s
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={maskDuration}
                        step={0.1}
                        value={maskFrameTimestamp}
                        onChange={(e) => setMaskFrameTimestamp(Number(e.target.value))}
                        className="w-full h-2 rounded accent-primary cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Chroma Key (green screen) */}
          <div className={cardClassName}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Pipette className="size-3.5 text-emerald-400" />
                <span className="text-xs font-medium">Chroma Key</span>
              </div>
              {clip.chromaKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-destructive"
                  onClick={() => onUpdate({ chromaKey: undefined })}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Make a key color transparent (e.g. green screen). Adjust threshold and smoothness for clean edges.
            </p>
            {!clip.chromaKey ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={() =>
                  onUpdate({
                    chromaKey: {
                      color: "#00ff00",
                      threshold: 0.4,
                      smoothness: 0.1,
                    },
                  })
                }
              >
                Add Chroma Key
              </Button>
            ) : (
              <div className="space-y-3 pt-2">
                <div>
                  <label className={labelClassName}>Key color</label>
                  <div className="flex gap-2 items-center mt-1">
                    <input
                      type="color"
                      value={clip.chromaKey.color}
                      onChange={(e) =>
                        onUpdate({
                          chromaKey: { ...clip.chromaKey!, color: e.target.value },
                        })
                      }
                      className="h-8 w-12 rounded border border-border cursor-pointer bg-transparent"
                    />
                    <input
                      type="text"
                      value={clip.chromaKey.color}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (/^#[0-9a-fA-F]{0,6}$/.test(v) || v === "") {
                          onUpdate({
                            chromaKey: { ...clip.chromaKey!, color: v || "#00ff00" },
                          });
                        }
                      }}
                      className={inputClassName + " flex-1 font-mono text-xs"}
                      placeholder="#00ff00"
                    />
                  </div>
                  <div className="flex gap-1 mt-1.5">
                    {CHROMA_KEY_PRESETS.filter((p) => p.color).map((preset) => (
                      <button
                        key={preset.color}
                        type="button"
                        className="h-6 w-6 rounded border border-border shrink-0"
                        style={{ backgroundColor: preset.color }}
                        title={preset.label}
                        onClick={() =>
                          onUpdate({
                            chromaKey: { ...clip.chromaKey!, color: preset.color },
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
                <ColorSlider
                  label="Threshold"
                  value={Math.round((clip.chromaKey.threshold ?? 0.4) * 100)}
                  min={0}
                  max={100}
                  onChange={(v) =>
                    onUpdate({
                      chromaKey: { ...clip.chromaKey!, threshold: v / 100 },
                    })
                  }
                  formatValue={(v) => `${v}%`}
                />
                <ColorSlider
                  label="Smoothness"
                  value={Math.round((clip.chromaKey.smoothness ?? 0.1) * 100)}
                  min={0}
                  max={100}
                  onChange={(v) =>
                    onUpdate({
                      chromaKey: { ...clip.chromaKey!, smoothness: v / 100 },
                    })
                  }
                  formatValue={(v) => `${v}%`}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Color Tab */}
      {activeTab === "color" && (
        <div className="space-y-3">
          <div className={cardClassName}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-medium">Color Grading</span>
              {hasColorGrading && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-muted-foreground hover:text-foreground gap-1"
                  onClick={resetColorGrading}
                >
                  <RotateCcw className="size-3" />
                  Reset All
                </Button>
              )}
            </div>

            <div className="space-y-4">
              <ColorSlider
                label="Exposure"
                value={colorGrading.exposure}
                min={-2}
                max={2}
                step={0.05}
                onChange={(v) => updateColorGrading("exposure", Math.round(v * 100) / 100)}
                gradient={GRADIENTS.exposure}
                formatValue={(v) => v.toFixed(2)}
              />

              <ColorSlider
                label="Contrast"
                value={colorGrading.contrast}
                min={-100}
                max={100}
                onChange={(v) => updateColorGrading("contrast", v)}
                gradient={GRADIENTS.contrast}
              />

              <ColorSlider
                label="Saturation"
                value={colorGrading.saturation}
                min={-100}
                max={100}
                onChange={(v) => updateColorGrading("saturation", v)}
                gradient={GRADIENTS.saturation}
              />
            </div>
          </div>

          <div className={cardClassName}>
            <span className="text-xs font-medium mb-4 block">White Balance</span>
            <div className="space-y-4">
              <ColorSlider
                label="Temperature"
                value={colorGrading.temperature}
                min={-100}
                max={100}
                onChange={(v) => updateColorGrading("temperature", v)}
                gradient={GRADIENTS.temperature}
              />

              <ColorSlider
                label="Tint"
                value={colorGrading.tint}
                min={-100}
                max={100}
                onChange={(v) => updateColorGrading("tint", v)}
                gradient={GRADIENTS.tint}
              />
            </div>
          </div>

          <div className={cardClassName}>
            <span className="text-xs font-medium mb-4 block">Tone</span>
            <div className="space-y-4">
              <ColorSlider
                label="Highlights"
                value={colorGrading.highlights}
                min={-100}
                max={100}
                onChange={(v) => updateColorGrading("highlights", v)}
                gradient={GRADIENTS.highlights}
              />

              <ColorSlider
                label="Shadows"
                value={colorGrading.shadows}
                min={-100}
                max={100}
                onChange={(v) => updateColorGrading("shadows", v)}
                gradient={GRADIENTS.shadows}
              />
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground text-center">
            Double-click any slider to reset to default
          </p>
        </div>
      )}

      {/* Captions Tab */}
      {activeTab === "captions" && (
        <div className={cardClassName}>
          <p className="text-[10px] text-muted-foreground mb-3">
            Caption settings are applied project-wide.
          </p>

          <div>
            <label className={labelClassName}>Style</label>
            <select
              value={captionSettings.style ?? "pill"}
              onChange={(e) => updateProjectSettings({
                captionSettings: { ...captionSettings, style: e.target.value as CaptionStyleType }
              })}
              className={inputClassName}
            >
              <option value="pill">Pill (default)</option>
              <option value="karaoke-lime">Karaoke Lime</option>
              <option value="karaoke-magenta">Karaoke Magenta</option>
              <option value="karaoke-cyan">Karaoke Cyan</option>
              <option value="outlined">Outlined</option>
              <option value="bold-outline">Bold Outline</option>
              <option value="minimal">Minimal</option>
              <option value="word-highlight">Word Highlight</option>
              <option value="pink-pill">Pink Pill</option>
              <option value="dark-pill-lime">Dark Pill Lime</option>
              <option value="cloud-blob">Cloud Blob</option>
            </select>
          </div>

          <div className="pt-2">
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
            <label className={labelClassName}>Font Size</label>
            <EditableInput
              type="number"
              value={captionSettings.fontSize ?? 18}
              min={10}
              max={48}
              className={inputClassName}
              onValueCommit={(val) => {
                const next = toNumber(val);
                if (next === null) return;
                updateProjectSettings({
                  captionSettings: { ...captionSettings, fontSize: Math.max(10, Math.min(48, next)) }
                });
              }}
            />
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
      )}
    </div>
  );
}
