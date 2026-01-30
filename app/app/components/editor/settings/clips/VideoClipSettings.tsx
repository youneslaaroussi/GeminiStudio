"use client";

import { useState } from "react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { EditableInput } from "@/app/components/ui/EditableInput";
import type { VideoClip } from "@/app/types/timeline";
import { DEFAULT_CAPTION_SETTINGS } from "@/app/types/timeline";
import { VideoEffectsPanel } from "../../VideoEffectsPanel";
import {
  toNumber,
  inputClassName,
  labelClassName,
  cardClassName,
  type ClipUpdateHandler,
} from "../utils";
import { Button } from "@/components/ui/button";
import { Settings, Sparkles, Captions } from "lucide-react";

interface VideoClipSettingsProps {
  clip: VideoClip;
  onUpdate: ClipUpdateHandler;
}

type TabId = "settings" | "effects" | "captions";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: "settings", label: "Settings", icon: <Settings className="size-3.5" /> },
  { id: "effects", label: "Effects", icon: <Sparkles className="size-3.5" /> },
  { id: "captions", label: "Captions", icon: <Captions className="size-3.5" /> },
];

export function VideoClipSettings({ clip, onUpdate }: VideoClipSettingsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("settings");
  const project = useProjectStore((s) => s.project);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);

  const captionSettings = project.captionSettings ?? DEFAULT_CAPTION_SETTINGS;

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
                value={clip.objectFit ?? "fill"}
                onChange={(e) => onUpdate({ objectFit: e.target.value as VideoClip["objectFit"] })}
                className={inputClassName}
              >
                <option value="fill">Stretch</option>
                <option value="contain">Fit</option>
                <option value="cover">Cover</option>
              </select>
            </div>

            <div>
              <label className={labelClassName}>Source URL</label>
              <EditableInput
                type="url"
                value={clip.src}
                className={inputClassName}
                onValueCommit={(val) => onUpdate({ src: val })}
              />
            </div>
          </div>

          {/* Focus Area */}
          <div className={cardClassName}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Focus Area</span>
              {!clip.focus ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-primary"
                  onClick={() =>
                    onUpdate({
                      focus: { x: 0, y: 0, width: 400, height: 400, padding: 50 },
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

            {clip.focus && (
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClassName}>X</label>
                    <EditableInput
                      type="number"
                      value={clip.focus.x}
                      className={inputClassName}
                      onValueCommit={(val) => {
                        const next = toNumber(val);
                        if (next === null) return;
                        onUpdate({ focus: { ...clip.focus!, x: next } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Y</label>
                    <EditableInput
                      type="number"
                      value={clip.focus.y}
                      className={inputClassName}
                      onValueCommit={(val) => {
                        const next = toNumber(val);
                        if (next === null) return;
                        onUpdate({ focus: { ...clip.focus!, y: next } });
                      }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClassName}>Width</label>
                    <EditableInput
                      type="number"
                      value={clip.focus.width}
                      min={1}
                      className={inputClassName}
                      onValueCommit={(val) => {
                        const next = toNumber(val);
                        if (next === null) return;
                        onUpdate({ focus: { ...clip.focus!, width: Math.max(1, next) } });
                      }}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Height</label>
                    <EditableInput
                      type="number"
                      value={clip.focus.height}
                      min={1}
                      className={inputClassName}
                      onValueCommit={(val) => {
                        const next = toNumber(val);
                        if (next === null) return;
                        onUpdate({ focus: { ...clip.focus!, height: Math.max(1, next) } });
                      }}
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClassName}>Padding</label>
                  <EditableInput
                    type="number"
                    value={clip.focus.padding}
                    min={0}
                    className={inputClassName}
                    onValueCommit={(val) => {
                      const next = toNumber(val);
                      if (next === null) return;
                      onUpdate({ focus: { ...clip.focus!, padding: Math.max(0, next) } });
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Effects Tab */}
      {activeTab === "effects" && (
        <VideoEffectsPanel clip={clip} />
      )}

      {/* Captions Tab */}
      {activeTab === "captions" && (
        <div className={cardClassName}>
          <p className="text-[10px] text-muted-foreground mb-3">
            Caption settings are applied project-wide.
          </p>

          <div>
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
