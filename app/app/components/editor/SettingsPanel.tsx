"use client";

import { useCallback } from "react";
import { Video, Music, Type, Image as ImageIcon } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import type { TimelineClip, VideoClip, AudioClip, TextClip, ImageClip } from "@/app/types/timeline";

export function SettingsPanel() {
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const layers = useProjectStore((s) => s.project.layers);
  const updateClip = useProjectStore((s) => s.updateClip);

  const allClips = layers.flatMap((layer) => layer.clips);
  const selectedClip = allClips.find((clip) => clip.id === selectedClipId);

  const handleUpdate = useCallback(
    (updates: Partial<TimelineClip>) => {
      if (!selectedClipId || !selectedClip) return;
      updateClip(selectedClipId, updates);
    },
    [selectedClipId, selectedClip, updateClip]
  );

  if (!selectedClip) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          <p className="text-xs text-muted-foreground">Select a clip to edit</p>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm text-muted-foreground text-center">
            No clip selected
          </p>
        </div>
      </div>
    );
  }

  const clipType = selectedClip.type;
  const icon =
    clipType === "video" ? (
      <Video className="size-4 text-blue-400" />
    ) : clipType === "audio" ? (
      <Music className="size-4 text-green-400" />
    ) : clipType === "text" ? (
      <Type className="size-4 text-purple-400" />
    ) : (
      <ImageIcon className="size-4 text-orange-400" />
    );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {selectedClip.name}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
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
              <input
                type="text"
                value={selectedClip.name}
                onChange={(e) => handleUpdate({ name: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Start (s)
                </label>
                <input
                  type="number"
                  value={selectedClip.start}
                  onChange={(e) =>
                    handleUpdate({ start: Math.max(0, Number(e.target.value)) })
                  }
                  step="0.1"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Duration (s)
                </label>
                <input
                  type="number"
                  value={selectedClip.duration}
                  onChange={(e) =>
                    handleUpdate({
                      duration: Math.max(0.1, Number(e.target.value)),
                    })
                  }
                  step="0.1"
                  min="0.1"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Offset (s)
                </label>
                <input
                  type="number"
                  value={selectedClip.offset}
                  onChange={(e) =>
                    handleUpdate({
                      offset: Math.max(0, Number(e.target.value)),
                    })
                  }
                  step="0.1"
                  min="0"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Speed
                </label>
                <input
                  type="number"
                  value={selectedClip.speed}
                  onChange={(e) =>
                    handleUpdate({
                      speed: Math.max(0.1, Number(e.target.value)),
                    })
                  }
                  step="0.1"
                  min="0.1"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Position X
                </label>
                <input
                  type="number"
                  value={selectedClip.position.x}
                  onChange={(e) =>
                    handleUpdate({
                      position: {
                        ...selectedClip.position,
                        x: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Position Y
                </label>
                <input
                  type="number"
                  value={selectedClip.position.y}
                  onChange={(e) =>
                    handleUpdate({
                      position: {
                        ...selectedClip.position,
                        y: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Scale X
                </label>
                <input
                  type="number"
                  value={selectedClip.scale.x}
                  step="0.1"
                  onChange={(e) =>
                    handleUpdate({
                      scale: {
                        ...selectedClip.scale,
                        x: Math.max(0.1, Number(e.target.value)),
                      },
                    })
                  }
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Scale Y
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={selectedClip.scale.y}
                  onChange={(e) =>
                    handleUpdate({
                      scale: {
                        ...selectedClip.scale,
                        y: Math.max(0.1, Number(e.target.value)),
                      },
                    })
                  }
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
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
                  Source URL
                </label>
                <input
                  type="url"
                  value={(selectedClip as VideoClip).src}
                  onChange={(e) => handleUpdate({ src: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
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
                <input
                  type="url"
                  value={(selectedClip as AudioClip).src}
                  onChange={(e) => handleUpdate({ src: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
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
                <input
                  type="number"
                  value={(selectedClip as TextClip).fontSize ?? 48}
                    onChange={(e) =>
                      handleUpdate({
                        fontSize: Math.max(1, Number(e.target.value)),
                      })
                    }
                    min="1"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Opacity
                  </label>
                <input
                  type="number"
                  value={(selectedClip as TextClip).opacity ?? 1}
                    onChange={(e) =>
                      handleUpdate({
                        opacity: Math.max(
                          0,
                          Math.min(1, Number(e.target.value))
                        ),
                      })
                    }
                    step="0.1"
                    min="0"
                    max="1"
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Color
                </label>
                <div className="flex gap-2">
                <input
                  type="color"
                  value={(selectedClip as TextClip).fill ?? "#ffffff"}
                    onChange={(e) => handleUpdate({ fill: e.target.value })}
                    className="w-12 h-9 rounded border border-border cursor-pointer"
                  />
                <input
                  type="text"
                  value={(selectedClip as TextClip).fill ?? "#ffffff"}
                    onChange={(e) => handleUpdate({ fill: e.target.value })}
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
                <input
                  type="url"
                  value={(selectedClip as ImageClip).src}
                  onChange={(e) => handleUpdate({ src: e.target.value })}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Width (px)
                  </label>
                  <input
                    type="number"
                    value={(selectedClip as ImageClip).width ?? ""}
                    placeholder="Auto"
                    onChange={(e) =>
                      handleUpdate({ width: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Height (px)
                  </label>
                  <input
                    type="number"
                    value={(selectedClip as ImageClip).height ?? ""}
                    placeholder="Auto"
                    onChange={(e) =>
                      handleUpdate({ height: e.target.value ? Number(e.target.value) : undefined })
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
