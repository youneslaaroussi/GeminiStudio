'use client';

import { useEffect, useState, useMemo } from 'react';
import { Player } from '@motion-canvas/core';
import { useProjectStore } from '@/app/lib/store/project-store';
import { VideoClip, AudioClip, TextClip } from '@/app/types/timeline';

interface SelectionOverlayProps {
  player: Player | null;
  transform: { zoom: number; x: number; y: number };
  containerSize: { width: number; height: number };
}

export function SelectionOverlay({ player, transform, containerSize }: SelectionOverlayProps) {
  const selectedClipId = useProjectStore((state) => state.selectedClipId);
  const project = useProjectStore((state) => state.project);
  
  const [rect, setRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Find the selected clip type
  const selectedClip = useMemo(() => {
    if (!selectedClipId) return null;
    return (
      project.textClips.find((c) => c.id === selectedClipId) ||
      project.videoClips.find((c) => c.id === selectedClipId) ||
      null
    );
  }, [selectedClipId, project]);

  useEffect(() => {
    if (!player || !selectedClipId || !selectedClip) {
      setRect(null);
      return;
    }

    // Only text clips have a specific node we track for now
    // Video clips fill the screen in this simple player, but if we added transforms to them, we'd track them too.
    // For now, let's look for the node.
    
    // Key format must match what we put in nle_timeline.tsx
    // We added key={`text-clip-${clip.id}`} for TextClips
    // We didn't add keys for Video/Audio in the scene yet, but audio doesn't have visual bounds usually (1px).
    // The main video uses a single `videoRef`, not individual nodes per clip (it swaps src).
    
    let nodeKey = '';
    if (selectedClip.type === 'text') {
      nodeKey = `text-clip-${selectedClipId}`;
    } else if (selectedClip.type === 'video') {
      nodeKey = 'main-video';
    } else {
        // Audio clips or others don't show a selection box
        setRect(null);
        return;
    }

    const updateRect = async () => {
      try {
        const scene = player.playback.currentScene as any;
        if (!scene?.getNode) return;

        const node = scene.getNode(nodeKey);
        if (!node) {
          setRect(null);
          return;
        }

        // Get transform matrix
        const localToWorld = node.localToWorld();
        
        // Calculate dimensions in world space (pixels)
        // We use an AABB approach similar to Vidova
        const width = typeof node.width === 'function' ? node.width() : 0;
        const height = typeof node.height === 'function' ? node.height() : 0;
        
        // Transform the four corners to find the AABB in world space
        // Note: This accounts for rotation (bounding box will grow to fit)
        const halfW = width / 2;
        const halfH = height / 2;
        
        const corners = [
            new DOMPoint(-halfW, -halfH),
            new DOMPoint(halfW, -halfH),
            new DOMPoint(halfW, halfH),
            new DOMPoint(-halfW, halfH)
        ].map(p => p.matrixTransform(localToWorld));

        const minX = Math.min(...corners.map(p => p.x));
        const maxX = Math.max(...corners.map(p => p.x));
        const minY = Math.min(...corners.map(p => p.y));
        const maxY = Math.max(...corners.map(p => p.y));

        const worldWidth = maxX - minX;
        const worldHeight = maxY - minY;
        const worldCenterX = (minX + maxX) / 2;
        const worldCenterY = (minY + maxY) / 2;

        // Convert to Screen Coordinates
        // Formula: ScreenPos = ContainerCenter + ViewportOffset + (WorldPos * Zoom)
        
        const containerCenterX = containerSize.width / 2;
        const containerCenterY = containerSize.height / 2;
        
        const screenCenterX = containerCenterX + transform.x + (worldCenterX * transform.zoom);
        const screenCenterY = containerCenterY + transform.y + (worldCenterY * transform.zoom);
        const screenWidth = worldWidth * transform.zoom;
        const screenHeight = worldHeight * transform.zoom;

        setRect({
            x: screenCenterX - screenWidth / 2,
            y: screenCenterY - screenHeight / 2,
            width: screenWidth,
            height: screenHeight
        });

      } catch (e) {
        // Node might not exist yet or scene not ready
        setRect(null);
      }
    };

    updateRect();
    
    // Subscribe to render to update box as it animates
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
