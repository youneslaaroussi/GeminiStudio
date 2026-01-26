"use client";

import { useCallback } from "react";
import { Video, Music, Type, Image as ImageIcon, MousePointer2 } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import type {
  TimelineClip,
  VideoClip,
  AudioClip,
  TextClip,
  ImageClip,
} from "@/app/types/timeline";
import { ScrollArea } from "@/components/ui/scroll-area";

import { SceneSettings } from "./SceneSettings";
import { TransitionSettings } from "./TransitionSettings";
import { CommonClipSettings } from "./clips/CommonClipSettings";
import { VideoClipSettings } from "./clips/VideoClipSettings";
import { AudioClipSettings } from "./clips/AudioClipSettings";
import { TextClipSettings } from "./clips/TextClipSettings";
import { ImageClipSettings } from "./clips/ImageClipSettings";

const CLIP_ICONS = {
  video: <Video className="size-4 text-blue-500" />,
  audio: <Music className="size-4 text-emerald-500" />,
  text: <Type className="size-4 text-purple-500" />,
  image: <ImageIcon className="size-4 text-amber-500" />,
};

export function SettingsPanel() {
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const selectedTransitionKey = useProjectStore((s) => s.selectedTransitionKey);
  const layers = useProjectStore((s) => s.project.layers);
  const updateClip = useProjectStore((s) => s.updateClip);

  const allClips = layers.flatMap((layer) => layer.clips);
  const selectedClip = allClips.find((clip) => clip.id === selectedClipId);

  const handleUpdate = useCallback(
    (updates: Partial<TimelineClip>) => {
      if (!selectedClipId) return;
      updateClip(selectedClipId, updates);
    },
    [selectedClipId, updateClip]
  );

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Scene Settings - Always visible */}
          <SceneSettings />

          {/* Empty State */}
          {!selectedClip && !selectedTransitionKey && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <MousePointer2 className="size-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Select a clip or transition to edit
              </p>
            </div>
          )}

          {/* Transition Settings */}
          {selectedTransitionKey && (
            <TransitionSettings transitionKey={selectedTransitionKey} />
          )}

          {/* Clip Settings */}
          {selectedClip && (
            <div className="space-y-3">
              {/* Clip Header */}
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-muted flex items-center justify-center">
                  {CLIP_ICONS[selectedClip.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedClip.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {selectedClip.type} Clip
                  </p>
                </div>
              </div>

              {/* Common Settings */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Transform
                </p>
                <CommonClipSettings clip={selectedClip} onUpdate={handleUpdate} />
              </div>

              {/* Type-specific Settings */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {selectedClip.type.charAt(0).toUpperCase() + selectedClip.type.slice(1)} Properties
                </p>
                {selectedClip.type === "video" && (
                  <VideoClipSettings
                    clip={selectedClip as VideoClip}
                    onUpdate={handleUpdate}
                  />
                )}
                {selectedClip.type === "audio" && (
                  <AudioClipSettings
                    clip={selectedClip as AudioClip}
                    onUpdate={handleUpdate}
                  />
                )}
                {selectedClip.type === "text" && (
                  <TextClipSettings
                    clip={selectedClip as TextClip}
                    onUpdate={handleUpdate}
                  />
                )}
                {selectedClip.type === "image" && (
                  <ImageClipSettings
                    clip={selectedClip as ImageClip}
                    onUpdate={handleUpdate}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
