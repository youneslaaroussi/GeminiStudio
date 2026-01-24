'use client';

import { useEffect, useState, useMemo } from 'react';
import { Player } from '@motion-canvas/core';
import { useProjectStore } from '@/app/lib/store/project-store';

interface SceneNode {
  localToWorld: () => DOMMatrix;
  width?: () => number;
  height?: () => number;
}

interface SceneGraph {
  getNode?: (key: string) => SceneNode | null;
}

interface SelectionOverlayProps {
  player: Player | null;
  transform: { zoom: number; x: number; y: number };
  containerSize: { width: number; height: number };
}

export function SelectionOverlay({ player, transform, containerSize }: SelectionOverlayProps) {
  const selectedClipId = useProjectStore((state) => state.selectedClipId);
  const layers = useProjectStore((state) => state.project.layers);
  
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Find the selected clip type
  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    for (const layer of layers) {
      const clip = layer.clips.find((c) => c.id === selectedClipId);
      if (clip && (clip.type === 'text' || clip.type === 'video' || clip.type === 'image')) {
        return clip;
      }
    }
    return null;
  }, [selectedClipId, layers]);

  useEffect(() => {
    if (!player || !selectedClipId || !selectedClip) {
      const frame = requestAnimationFrame(() => setRect(null));
      return () => cancelAnimationFrame(frame);
    }

    let nodeKey: string | null = null;
    if (selectedClip.type === 'text') {
      nodeKey = `text-clip-${selectedClipId}`;
    } else if (selectedClip.type === 'video') {
      nodeKey = 'main-video';
    } else if (selectedClip.type === 'image') {
      nodeKey = `image-clip-${selectedClipId}`;
    }

    if (!nodeKey) {
      const frame = requestAnimationFrame(() => setRect(null));
      return () => cancelAnimationFrame(frame);
    }

    const updateRect = async () => {
      try {
        const scene = player.playback.currentScene as SceneGraph | null;
        if (!scene?.getNode) return;

        const node = scene.getNode(nodeKey);
        if (!node) {
          setRect(null);
          return;
        }

        const localToWorld = node.localToWorld();
        const nodeWidth = typeof node.width === 'function' ? node.width() ?? 0 : 0;
        const nodeHeight = typeof node.height === 'function' ? node.height() ?? 0 : 0;

        const halfW = nodeWidth / 2;
        const halfH = nodeHeight / 2;

        const corners = [
          new DOMPoint(-halfW, -halfH),
          new DOMPoint(halfW, -halfH),
          new DOMPoint(halfW, halfH),
          new DOMPoint(-halfW, halfH),
        ].map((point) => point.matrixTransform(localToWorld));

        const minX = Math.min(...corners.map((point) => point.x));
        const maxX = Math.max(...corners.map((point) => point.x));
        const minY = Math.min(...corners.map((point) => point.y));
        const maxY = Math.max(...corners.map((point) => point.y));

        const worldWidth = maxX - minX;
        const worldHeight = maxY - minY;
        const worldCenterX = (minX + maxX) / 2;
        const worldCenterY = (minY + maxY) / 2;

        const containerCenterX = containerSize.width / 2;
        const containerCenterY = containerSize.height / 2;

        const screenCenterX = containerCenterX + transform.x + worldCenterX * transform.zoom;
        const screenCenterY = containerCenterY + transform.y + worldCenterY * transform.zoom;
        const screenWidth = worldWidth * transform.zoom;
        const screenHeight = worldHeight * transform.zoom;

        setRect({
          x: screenCenterX - screenWidth / 2,
          y: screenCenterY - screenHeight / 2,
          width: screenWidth,
          height: screenHeight,
        });
      } catch {
        setRect(null);
      }
    };

    updateRect();

    const sub = player.onRender.subscribe(updateRect);
    return () => sub();
  }, [player, selectedClipId, selectedClip, transform, containerSize]);

  if (!rect) return null;

  return (
    <div
      className="absolute pointer-events-none border-2 border-cyan-500 z-10"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
        {/* Simple Corner Handles */}
        <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-cyan-500" />
        <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-cyan-500" />
        <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-cyan-500" />
        <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-cyan-500" />
    </div>
  );
}
