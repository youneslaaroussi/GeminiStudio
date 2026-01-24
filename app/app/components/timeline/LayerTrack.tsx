"use client";

import { Video, Music, Type, Image as ImageIcon } from "lucide-react";
import type { Layer } from "@/app/types/timeline";
import { useProjectStore } from "@/app/lib/store/project-store";
import { Clip } from "./Clip";

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
        className="relative h-12 bg-muted/10"
        style={{ width: Math.max(width - labelWidth, duration * zoom) }}
        data-layer-id={layer.id}
        data-layer-type={layer.type}
      >
        {layer.clips.map((clip) => (
          <Clip key={clip.id} clip={clip} layerId={layer.id} />
        ))}
      </div>
    </div>
  );
}
