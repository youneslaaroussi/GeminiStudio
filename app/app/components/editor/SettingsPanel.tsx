"use client";

import { useCallback } from "react";
import { Video, Music, Type, Image as ImageIcon, ArrowLeftRight } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { EditableInput } from "@/app/components/ui/EditableInput";
import { 
  parseTransitionKey, 
  DEFAULT_TRANSITION, 
  type TimelineClip, 
  type VideoClip, 
  type AudioClip, 
  type TextClip, 
  type ImageClip,
  type TransitionType 
} from "@/app/types/timeline";

export function SettingsPanel() {
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const selectedTransitionKey = useProjectStore((s) => s.selectedTransitionKey);
  const project = useProjectStore((s) => s.project);
  const layers = project.layers;
  const updateClip = useProjectStore((s) => s.updateClip);
  const updateProjectSettings = useProjectStore((s) => s.updateProjectSettings);
  const addTransition = useProjectStore((s) => s.addTransition);
  const removeTransition = useProjectStore((s) => s.removeTransition);

  const allClips = layers.flatMap((layer) => layer.clips);
  const selectedClip = allClips.find((clip) => clip.id === selectedClipId);
  const selectedTransition = selectedTransitionKey ? project.transitions?.[selectedTransitionKey] : null;

  const toNumber = (raw: string) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const handleUpdate = useCallback(
    (updates: Partial<TimelineClip>) => {
      if (!selectedClipId || !selectedClip) return;
      updateClip(selectedClipId, updates);
    },
    [selectedClipId, selectedClip, updateClip]
  );

  const clipType = selectedClip?.type;
  const icon =
    clipType === "video" ? (
      <Video className="size-4 text-blue-400" />
    ) : clipType === "audio" ? (
      <Music className="size-4 text-green-400" />
    ) : clipType === "text" ? (
      <Type className="size-4 text-purple-400" />
    ) : clipType === "image" ? (
      <ImageIcon className="size-4 text-orange-400" />
    ) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">Settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure the scene and selected clip
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">
            Scene Settings
          </h3>
          <div className="space-y-3 rounded-md border border-border p-5 bg-muted/10">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Width (px)
                </label>
                <EditableInput
                  type="number"
                  value={project.resolution.width}
                  min={320}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    updateProjectSettings({
                      resolution: {
                        width: next,
                        height: project.resolution.height,
                      },
                    });
                  }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Height (px)
                </label>
                <EditableInput
                  type="number"
                  value={project.resolution.height}
                  min={240}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    updateProjectSettings({
                      resolution: {
                        width: project.resolution.width,
                        height: next,
                      },
                    });
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Frame Rate (fps)
                </label>
                <select
                  value={project.fps}
                  onChange={(e) =>
                    updateProjectSettings({ fps: Number(e.target.value) })
                  }
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {[24, 25, 30, 50, 60].map((fps) => (
                    <option key={fps} value={fps}>
                      {fps}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
              <label className="text-xs text-muted-foreground">
                Render Scale
              </label>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={project.renderScale}
                onChange={(e) =>
                  updateProjectSettings({ renderScale: Number(e.target.value) })
                }
                className="w-full"
              />
              <span className="text-xs font-mono text-muted-foreground">
                {project.renderScale.toFixed(1)}x
              </span>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Background
              </label>
              <div className="flex items-center gap-2">
                <EditableInput
                  type="color"
                  value={project.background}
                  commitOnChange
                  onValueCommit={(val) =>
                    updateProjectSettings({ background: val })
                  }
                  className="w-10 h-10 rounded border border-border cursor-pointer"
                />
                <EditableInput
                  type="text"
                  value={project.background}
                  onValueCommit={(val) =>
                    updateProjectSettings({ background: val })
                  }
                  className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {!selectedClip && !selectedTransitionKey && (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Select a clip or transition to edit settings.
          </div>
        )}

        {selectedTransitionKey && (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
              <ArrowLeftRight className="size-4 text-primary" />
              <span className="font-medium text-foreground normal-case">Transition</span>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Type
                </label>
                <select
                  value={selectedTransition?.type ?? 'none'}
                  onChange={(e) => {
                    const type = e.target.value as TransitionType;
                    const { fromId, toId } = parseTransitionKey(selectedTransitionKey);
                    
                    if (type === 'none') {
                      removeTransition(fromId, toId);
                    } else {
                      addTransition(fromId, toId, {
                        type,
                        duration: selectedTransition?.duration ?? DEFAULT_TRANSITION.duration,
                      });
                    }
                  }}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="slide-left">Slide Left</option>
                  <option value="slide-right">Slide Right</option>
                  <option value="slide-up">Slide Up</option>
                  <option value="slide-down">Slide Down</option>
                </select>
              </div>

              {selectedTransition && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Duration (s)
                  </label>
                  <EditableInput
                    type="number"
                    value={selectedTransition.duration}
                    step="0.1"
                    min="0.1"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    onValueCommit={(val) => {
                      const next = toNumber(val);
                      if (next === null) return;
                      const { fromId, toId } = parseTransitionKey(selectedTransitionKey);
                      addTransition(fromId, toId, {
                        ...selectedTransition,
                        duration: Math.max(0.1, next),
                      });
                    }}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {selectedClip && (
        <>
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          {icon}
          <span className="font-medium text-foreground normal-case">{selectedClip.name}</span>
        </div>
        {/* Common Properties */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">
            Common Properties
          </h3>
          <div className="space-y-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Name
              </label>
              <EditableInput
                value={selectedClip.name}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                onValueCommit={(val) => handleUpdate({ name: val })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Start (s)
                </label>
                <EditableInput
                  type="number"
                  value={selectedClip.start}
                  step="0.1"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    handleUpdate({ start: Math.max(0, next) });
                  }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Duration (s)
                </label>
                <EditableInput
                  type="number"
                  value={selectedClip.duration}
                  step="0.1"
                  min="0.1"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    handleUpdate({
                      duration: Math.max(0.1, next),
                    });
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Offset (s)
                </label>
                <EditableInput
                  type="number"
                  value={selectedClip.offset}
                  step="0.1"
                  min="0"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    handleUpdate({
                      offset: Math.max(0, next),
                    });
                  }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Speed
                </label>
                <EditableInput
                  type="number"
                  value={selectedClip.speed}
                  step="0.1"
                  min="0.1"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    handleUpdate({
                      speed: Math.max(0.1, next),
                    });
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Position X
                </label>
                  <EditableInput
                    type="number"
                    value={selectedClip.position.x}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    onValueCommit={(val) => {
                      const next = toNumber(val);
                      if (next === null) return;
                      handleUpdate({
                        position: {
                          ...selectedClip.position,
                          x: next,
                        },
                      });
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Position Y
                  </label>
                  <EditableInput
                    type="number"
                    value={selectedClip.position.y}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    onValueCommit={(val) => {
                      const next = toNumber(val);
                      if (next === null) return;
                      handleUpdate({
                        position: {
                          ...selectedClip.position,
                          y: next,
                        },
                      });
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Scale X
                </label>
                  <EditableInput
                    type="number"
                    value={selectedClip.scale.x}
                    step="0.1"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    onValueCommit={(val) => {
                      const next = toNumber(val);
                      if (next === null) return;
                      handleUpdate({
                        scale: {
                          ...selectedClip.scale,
                          x: Math.max(0.1, next),
                        },
                      });
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Scale Y
                  </label>
                  <EditableInput
                    type="number"
                    step="0.1"
                    value={selectedClip.scale.y}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    onValueCommit={(val) => {
                      const next = toNumber(val);
                      if (next === null) return;
                      handleUpdate({
                        scale: {
                          ...selectedClip.scale,
                          y: Math.max(0.1, next),
                        },
                      });
                    }}
                  />
              </div>
            </div>
          </div>
        </div>

        {/* Video-specific Properties */}
        {selectedClip?.type === "video" && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">
              Video Properties
            </h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Fill Mode
                </label>
                <select
                  value={(selectedClip as VideoClip).objectFit ?? 'fill'}
                  onChange={(e) => handleUpdate({ objectFit: e.target.value as any })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="fill">Stretch</option>
                  <option value="contain">Fit</option>
                  <option value="cover">Cover</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Source URL
                </label>
                <EditableInput
                  type="url"
                  value={(selectedClip as VideoClip).src}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => handleUpdate({ src: val })}
                />
              </div>

              <div className="pt-4 border-t border-border mt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    Focus Area
                  </h3>
                  {!(selectedClip as VideoClip).focus ? (
                    <button
                      className="text-[10px] font-medium text-primary hover:underline"
                      onClick={() => handleUpdate({ 
                        focus: { x: 0, y: 0, width: 400, height: 400, padding: 50 } 
                      })}
                    >
                      Add Focus
                    </button>
                  ) : (
                    <button
                      className="text-[10px] font-medium text-destructive hover:underline"
                      onClick={() => handleUpdate({ focus: undefined })}
                    >
                      Remove
                    </button>
                  )}
                </div>

                {(selectedClip as VideoClip).focus && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">X</label>
                        <EditableInput
                          type="number"
                          value={(selectedClip as VideoClip).focus!.x}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          onValueCommit={(val) => {
                             const next = toNumber(val);
                             if (next === null) return;
                             handleUpdate({
                               focus: { ...(selectedClip as VideoClip).focus!, x: next }
                             });
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Y</label>
                         <EditableInput
                          type="number"
                          value={(selectedClip as VideoClip).focus!.y}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          onValueCommit={(val) => {
                             const next = toNumber(val);
                             if (next === null) return;
                             handleUpdate({
                               focus: { ...(selectedClip as VideoClip).focus!, y: next }
                             });
                          }}
                        />
                      </div>
                    </div>
                     <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Width</label>
                        <EditableInput
                          type="number"
                          value={(selectedClip as VideoClip).focus!.width}
                          min={1}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          onValueCommit={(val) => {
                             const next = toNumber(val);
                             if (next === null) return;
                             handleUpdate({
                               focus: { ...(selectedClip as VideoClip).focus!, width: Math.max(1, next) }
                             });
                          }}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Height</label>
                         <EditableInput
                          type="number"
                          value={(selectedClip as VideoClip).focus!.height}
                          min={1}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          onValueCommit={(val) => {
                             const next = toNumber(val);
                             if (next === null) return;
                             handleUpdate({
                               focus: { ...(selectedClip as VideoClip).focus!, height: Math.max(1, next) }
                             });
                          }}
                        />
                      </div>
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Padding</label>
                         <EditableInput
                          type="number"
                          value={(selectedClip as VideoClip).focus!.padding}
                          min={0}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                          onValueCommit={(val) => {
                             const next = toNumber(val);
                             if (next === null) return;
                             handleUpdate({
                               focus: { ...(selectedClip as VideoClip).focus!, padding: Math.max(0, next) }
                             });
                          }}
                        />
                      </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Audio-specific Properties */}
        {selectedClip?.type === "audio" && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">
              Audio Properties
            </h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Source URL
                </label>
                <EditableInput
                  type="url"
                  value={(selectedClip as AudioClip).src}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => handleUpdate({ src: val })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Volume: {(((selectedClip as AudioClip).volume) * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={(selectedClip as AudioClip).volume}
                  onChange={(e) =>
                    handleUpdate({ volume: Number(e.target.value) })
                  }
                  className="w-full"
                />
              </div>
            </div>
          </div>
        )}

        {/* Text-specific Properties */}
        {selectedClip?.type === "text" && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">
              Text Properties
            </h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Text Content
                </label>
                <textarea
                  value={(selectedClip as TextClip).text}
                  onChange={(e) => handleUpdate({ text: e.target.value })}
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Font Size
                  </label>
                <EditableInput
                  type="number"
                  value={(selectedClip as TextClip).fontSize ?? 48}
                  min="1"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    handleUpdate({
                      fontSize: Math.max(1, next),
                    });
                  }}
                />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Opacity
                  </label>
                <EditableInput
                  type="number"
                  value={(selectedClip as TextClip).opacity ?? 1}
                  step="0.1"
                  min="0"
                  max="1"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => {
                    const next = toNumber(val);
                    if (next === null) return;
                    handleUpdate({
                      opacity: Math.max(0, Math.min(1, next)),
                    });
                  }}
                />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Color
                </label>
                <div className="flex gap-2">
                <EditableInput
                  type="color"
                  value={(selectedClip as TextClip).fill ?? "#ffffff"}
                  commitOnChange
                  onValueCommit={(val) => handleUpdate({ fill: val })}
                  className="w-12 h-9 rounded border border-border cursor-pointer"
                />
                <EditableInput
                  type="text"
                  value={(selectedClip as TextClip).fill ?? "#ffffff"}
                  onValueCommit={(val) => handleUpdate({ fill: val })}
                  className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  placeholder="#ffffff"
                />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Image-specific Properties */}
        {selectedClip?.type === "image" && (
          <div>
            <h3 className="text-xs font-medium text-muted-foreground mb-2">
              Image Properties
            </h3>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Source URL
                </label>
                <EditableInput
                  type="url"
                  value={(selectedClip as ImageClip).src}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  onValueCommit={(val) => handleUpdate({ src: val })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Width (px)
                  </label>
                  <EditableInput
                    type="number"
                    value={(selectedClip as ImageClip).width ?? ""}
                    placeholder="Auto"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    onValueCommit={(val) =>
                      handleUpdate({
                        width: val === "" ? undefined : toNumber(val) ?? undefined,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Height (px)
                  </label>
                  <EditableInput
                    type="number"
                    value={(selectedClip as ImageClip).height ?? ""}
                    placeholder="Auto"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    onValueCommit={(val) =>
                      handleUpdate({
                        height: val === "" ? undefined : toNumber(val) ?? undefined,
                      })
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
