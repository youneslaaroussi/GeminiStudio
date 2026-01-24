"use client";

import { useState, useCallback } from "react";
import { Plus, Video, Music, Gauge, Type, Image as ImageIcon } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import {
  TEST_VIDEOS,
  TEST_AUDIOS,
  TEST_IMAGES,
  createVideoClip,
  createAudioClip,
  createTextClip,
  createImageClip,
} from "@/app/types/timeline";
import type { TimelineClip } from "@/app/types/timeline";

export function AssetsPanel() {
  const [customUrl, setCustomUrl] = useState("");
  const [customName, setCustomName] = useState("");
  const [customDuration, setCustomDuration] = useState(10);
  const [assetType, setAssetType] = useState<"video" | "audio" | "image">("video");
  const [textContent, setTextContent] = useState("");
  const [textName, setTextName] = useState("");

  const addClip = useProjectStore((s) => s.addClip);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const layers = useProjectStore((s) => s.project.layers);
  const updateClip = useProjectStore((s) => s.updateClip);
  const getDuration = useProjectStore((s) => s.getDuration);

  const allClips = layers.flatMap((layer) => layer.clips);
  const selectedClip: TimelineClip | undefined = allClips.find(
    (clip) => clip.id === selectedClipId
  );

  const handleAddTestVideo = useCallback(
    (video: (typeof TEST_VIDEOS)[number]) => {
      const clip = createVideoClip(
        video.url,
        video.name,
        getDuration(), // Add at end of timeline
        Math.min(video.duration, 30) // Cap at 30s for preview
      );
      addClip(clip);
    },
    [addClip, getDuration]
  );

  const handleAddTestAudio = useCallback(
    (audio: (typeof TEST_AUDIOS)[number]) => {
      const clip = createAudioClip(
        audio.url,
        audio.name,
        getDuration(), // Add at end of timeline
        Math.min(audio.duration, 60) // Cap at 60s for preview
      );
      addClip(clip);
    },
    [addClip, getDuration]
  );

  const handleAddTestImage = useCallback(
    (image: (typeof TEST_IMAGES)[number]) => {
      const clip = createImageClip(
        image.url,
        image.name,
        getDuration(), // Add at end of timeline
        image.duration
      );
      addClip(clip);
    },
    [addClip, getDuration]
  );

  const handleAddCustomAsset = useCallback(() => {
    if (!customUrl.trim()) return;

    const name = customName.trim() || "Custom Asset";
    const start = getDuration();

    if (assetType === "video") {
      const clip = createVideoClip(customUrl, name, start, customDuration);
      addClip(clip);
    } else if (assetType === "audio") {
      const clip = createAudioClip(customUrl, name, start, customDuration);
      addClip(clip);
    } else {
      const clip = createImageClip(customUrl, name, start, customDuration);
      addClip(clip);
    }

    setCustomUrl("");
    setCustomName("");
  }, [
    customUrl,
    customName,
    customDuration,
    assetType,
    addClip,
    getDuration,
  ]);

  const handleAddText = useCallback(() => {
    if (!textContent.trim()) return;

    const name = textName.trim() || "Text";
    const clip = createTextClip(
      textContent,
      name,
      getDuration(),
      5 // Default 5 seconds
    );
    addClip(clip);
    setTextContent("");
    setTextName("");
  }, [textContent, textName, addClip, getDuration]);

  const handleSpeedChange = useCallback(
    (speed: number) => {
      if (!selectedClipId) return;
      updateClip(selectedClipId, { speed });
    },
    [selectedClipId, updateClip]
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

        {/* Test Images */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">
            Test Images
          </h3>
          <div className="space-y-1">
            {TEST_IMAGES.map((image) => (
              <button
                key={image.url}
                type="button"
                onClick={() => handleAddTestImage(image)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              >
                <ImageIcon className="size-4 text-orange-400" />
                <span className="flex-1 truncate">{image.name}</span>
                <Plus className="size-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>

        {/* Add Text */}
        <div>
          <h3 className="text-xs font-medium text-muted-foreground mb-2">
            Add Text
          </h3>
          <div className="space-y-2">
            <input
              type="text"
              value={textName}
              onChange={(e) => setTextName(e.target.value)}
              placeholder="Name (optional)"
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              placeholder="Enter text..."
              rows={3}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm resize-none"
            />
            <button
              type="button"
              onClick={handleAddText}
              disabled={!textContent.trim()}
              className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Type className="size-3 inline mr-1" />
              Add Text to Timeline
            </button>
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
              <button
                type="button"
                onClick={() => setAssetType("image")}
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  assetType === "image"
                    ? "bg-orange-500/20 text-orange-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <ImageIcon className="size-3 inline mr-1" />
                Image
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
