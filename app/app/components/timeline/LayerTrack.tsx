"use client";

import { useCallback, useRef, useState } from "react";
import { Video, Music, Type, Image as ImageIcon } from "lucide-react";
import type { Layer } from "@/app/types/timeline";
import { useProjectStore } from "@/app/lib/store/project-store";
import { Clip } from "./Clip";
import { cn } from "@/lib/utils";
import { assetMatchesLayer, createClipFromAsset, hasAssetDragData, readDraggedAsset } from "@/app/lib/assets/drag";

interface LayerTrackProps {
  layer: Layer;
  width: number;
  labelWidth: number;
}

const typeIcon: Record<Layer["type"], JSX.Element> = {
  video: <Video className="size-3.5 text-blue-400" />,
  audio: <Music className="size-3.5 text-green-400" />,
  text: <Type className="size-3.5 text-purple-400" />,
  image: <ImageIcon className="size-3.5 text-orange-400" />,
};

export function LayerTrack({ layer, width, labelWidth }: LayerTrackProps) {
  const zoom = useProjectStore((s) => s.zoom);
  const duration = useProjectStore((s) => s.getDuration());
  const addClip = useProjectStore((s) => s.addClip);
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      if (!isDragOver) {
        setIsDragOver(true);
      }
    },
    [isDragOver]
  );

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAssetDragData(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
      const asset = readDraggedAsset(event);
      if (!asset || !assetMatchesLayer(asset.type, layer.type)) {
        return;
      }
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      const start = Math.max(0, x / zoom);
      const clip = createClipFromAsset(asset, start);
      addClip(clip, layer.id);
    },
    [addClip, layer.id, layer.type, zoom]
  );

  return (
    <div
      className="flex items-stretch border-b border-border"
      data-layer-id={layer.id}
      data-layer-type={layer.type}
    >
      <div
        className="flex shrink-0 items-center gap-1.5 border-r border-border bg-muted/30 px-2 py-2"
        style={{ width: labelWidth }}
      >
        {typeIcon[layer.type]}
        <div className="flex flex-col">
          <span className="text-xs font-medium text-muted-foreground">
            {layer.name}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {layer.type}
          </span>
        </div>
      </div>
      <div
        ref={trackRef}
        className={cn(
          "relative h-12 bg-muted/10 transition-colors",
          isDragOver && "bg-muted/20 ring-2 ring-primary/40 ring-inset"
        )}
        style={{ width: Math.max(width - labelWidth, duration * zoom) }}
        data-layer-id={layer.id}
        data-layer-type={layer.type}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {layer.clips.map((clip) => (
          <Clip key={clip.id} clip={clip} layerId={layer.id} />
        ))}
      </div>
    </div>
  );
}
