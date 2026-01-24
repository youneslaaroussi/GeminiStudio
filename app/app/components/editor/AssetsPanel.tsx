"use client";

import { useState, useCallback } from "react";
import { Plus, Video, Music, Gauge } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import {
  TEST_VIDEOS,
  TEST_AUDIOS,
  createVideoClip,
  createAudioClip,
} from "@/app/types/timeline";

export function AssetsPanel() {
  const [customUrl, setCustomUrl] = useState("");
  const [customName, setCustomName] = useState("");
  const [customDuration, setCustomDuration] = useState(10);
  const [assetType, setAssetType] = useState<"video" | "audio">("video");

  const addVideoClip = useProjectStore((s) => s.addVideoClip);
  const addAudioClip = useProjectStore((s) => s.addAudioClip);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const videoClips = useProjectStore((s) => s.project.videoClips);
  const audioClips = useProjectStore((s) => s.project.audioClips);
  const updateVideoClip = useProjectStore((s) => s.updateVideoClip);
  const updateAudioClip = useProjectStore((s) => s.updateAudioClip);
  const getDuration = useProjectStore((s) => s.getDuration);

  // Find selected clip
  const selectedVideoClip = videoClips.find((c) => c.id === selectedClipId);
  const selectedAudioClip = audioClips.find((c) => c.id === selectedClipId);
  const selectedClip = selectedVideoClip || selectedAudioClip;

  const handleAddTestVideo = useCallback(
    (video: (typeof TEST_VIDEOS)[number]) => {
      const clip = createVideoClip(
        video.url,
        video.name,
        getDuration(), // Add at end of timeline
        Math.min(video.duration, 30) // Cap at 30s for preview
      );
      addVideoClip(clip);
    },
    [addVideoClip, getDuration]
  );

  const handleAddTestAudio = useCallback(
    (audio: (typeof TEST_AUDIOS)[number]) => {
      const clip = createAudioClip(
        audio.url,
        audio.name,
        getDuration(), // Add at end of timeline
        Math.min(audio.duration, 60) // Cap at 60s for preview
      );
      addAudioClip(clip);
    },
    [addAudioClip, getDuration]
  );

  const handleAddCustomAsset = useCallback(() => {
    if (!customUrl.trim()) return;

    const name = customName.trim() || "Custom Asset";
    const start = getDuration();

    if (assetType === "video") {
      const clip = createVideoClip(customUrl, name, start, customDuration);
      addVideoClip(clip);
    } else {
      const clip = createAudioClip(customUrl, name, start, customDuration);
      addAudioClip(clip);
    }

    setCustomUrl("");
    setCustomName("");
  }, [
    customUrl,
    customName,
    customDuration,
    assetType,
    addVideoClip,
    addAudioClip,
    getDuration,
  ]);

  const handleSpeedChange = useCallback(
    (speed: number) => {
      if (!selectedClipId) return;
      if (selectedVideoClip) {
        updateVideoClip(selectedClipId, { speed });
      } else if (selectedAudioClip) {
        updateAudioClip(selectedClipId, { speed });
      }
    },
    [selectedClipId, selectedVideoClip, selectedAudioClip, updateVideoClip, updateAudioClip]
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">Assets</h2>
        <p className="text-xs text-muted-foreground">Add media to timeline</p>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Test Videos */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">
            Test Videos
          </h3>
          <div className="space-y-1">
            {TEST_VIDEOS.map((video) => (
              <button
                key={video.url}
                type="button"
                onClick={() => handleAddTestVideo(video)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <Video className="size-4 text-blue-400" />
                <span className="flex-1 truncate">{video.name}</span>
                <Plus className="size-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>

        {/* Test Audio */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">
            Test Audio
          </h3>
          <div className="space-y-1">
            {TEST_AUDIOS.map((audio) => (
              <button
                key={audio.url}
                type="button"
                onClick={() => handleAddTestAudio(audio)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <Music className="size-4 text-green-400" />
                <span className="flex-1 truncate">{audio.name}</span>
                <Plus className="size-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>

        {/* Custom URL */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">
            Add Custom URL
          </h3>
          <div className="space-y-2">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setAssetType("video")}
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  assetType === "video"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Video className="size-3 inline mr-1" />
                Video
              </button>
              <button
                type="button"
                onClick={() => setAssetType("audio")}
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  assetType === "audio"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Music className="size-3 inline mr-1" />
                Audio
              </button>
            </div>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Name (optional)"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <input
              type="url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Duration:</label>
              <input
                type="number"
                value={customDuration}
                onChange={(e) => setCustomDuration(Number(e.target.value))}
                min={1}
                max={3600}
                className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
              <span className="text-xs text-muted-foreground">s</span>
            </div>
            <button
              type="button"
              onClick={handleAddCustomAsset}
              disabled={!customUrl.trim()}
              className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Plus className="size-3 inline mr-1" />
              Add to Timeline
            </button>
          </div>
        </div>

        {/* Clip Properties */}
        {selectedClip && (
          <div className="border-t border-border pt-4">
            <h3 className="text-xs font-medium text-muted-foreground mb-2">
              Clip Properties
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Name:</span>
                <span className="truncate max-w-[120px]">{selectedClip.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Start:</span>
                <span>{selectedClip.start.toFixed(2)}s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Duration:</span>
                <span>{selectedClip.duration.toFixed(2)}s</span>
              </div>
              <div className="flex items-center gap-2">
                <Gauge className="size-3 text-muted-foreground" />
                <span className="text-muted-foreground text-xs">Speed:</span>
                <select
                  value={selectedClip.speed}
                  onChange={(e) => handleSpeedChange(Number(e.target.value))}
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  <option value={0.25}>0.25x</option>
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1}>1x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2}>2x</option>
                  <option value={4}>4x</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
