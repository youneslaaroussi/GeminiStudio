'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Player } from '@motion-canvas/core';
import { useProjectStore } from '@/app/lib/store/project-store';
import { getSceneNodeKey } from '@/app/lib/scene-node-key';
import { clsx } from 'clsx';

interface SceneNode {
  localToWorld: () => DOMMatrix;
  width?: () => number;
  height?: () => number;
}

interface SceneGraph {
  getNode?: (key: string) => SceneNode | null;
}

type ResizeHandle =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';

interface SelectionOverlayProps {
  player: Player | null;
  transform: { zoom: number; x: number; y: number };
  containerSize: { width: number; height: number };
  renderScale: number;
  /** Called when user releases after dragging (so the scene can skip hitbox selection on that release) */
  onDragEnd?: () => void;
}

interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}


const OPTIMISTIC_TIMEOUT_MS = 500;

export function SelectionOverlay({
  player,
  transform,
  containerSize,
  renderScale,
  onDragEnd,
}: SelectionOverlayProps) {
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const layers = useProjectStore((s) => s.project.layers);
  const updateClip = useProjectStore((s) => s.updateClip);

  // Scene-derived rect (from Motion Canvas)
  const [sceneRect, setSceneRect] = useState<ScreenRect | null>(null);
  
  // Optimistic rect (calculated directly from mouse input)
  const [optimisticRect, setOptimisticRect] = useState<ScreenRect | null>(null);
  
  // Whether we're in optimistic mode (during drag or shortly after)
  const [useOptimistic, setUseOptimistic] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<ResizeHandle | null>(null);
  
  // Store initial state when interaction starts
  const dragStartRef = useRef({
    clientX: 0,
    clientY: 0,
    pos: { x: 0, y: 0 },
    screenRect: null as ScreenRect | null,
  });
  const resizeStartRef = useRef({
    clientX: 0,
    clientY: 0,
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    screenRect: null as ScreenRect | null,
  });
  
  // Timeout for optimistic mode after release
  const optimisticTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const selectedClip = (() => {
    if (!selectedClipId) return null;
    for (const layer of layers) {
      const clip = layer.clips.find((c) => c.id === selectedClipId);
      if (
        clip &&
        (clip.type === 'text' || clip.type === 'video' || clip.type === 'image')
      ) {
        return clip;
      }
    }
    return null;
  })();

  // Update scene rect from Motion Canvas node
  useEffect(() => {
    if (!player || !selectedClipId || !selectedClip) {
      setSceneRect(null);
      return;
    }

    const nodeKey = getSceneNodeKey(selectedClip);
    if (!nodeKey) {
      setSceneRect(null);
      return;
    }

    const updateRect = async () => {
      try {
        const scene = player.playback.currentScene as SceneGraph | null;
        if (!scene?.getNode) return;

        const node = scene.getNode(nodeKey);
        if (!node) {
          setSceneRect(null);
          return;
        }

        const localToWorld = node.localToWorld();
        const nodeWidth =
          typeof node.width === 'function' ? node.width() ?? 0 : 0;
        const nodeHeight =
          typeof node.height === 'function' ? node.height() ?? 0 : 0;

        const halfW = nodeWidth / 2;
        const halfH = nodeHeight / 2;

        const corners = [
          new DOMPoint(-halfW, -halfH),
          new DOMPoint(halfW, -halfH),
          new DOMPoint(halfW, halfH),
          new DOMPoint(-halfW, halfH),
        ].map((p) => p.matrixTransform(localToWorld));

        const minX = Math.min(...corners.map((p) => p.x));
        const maxX = Math.max(...corners.map((p) => p.x));
        const minY = Math.min(...corners.map((p) => p.y));
        const maxY = Math.max(...corners.map((p) => p.y));

        const renderWidth = maxX - minX;
        const renderHeight = maxY - minY;
        const renderCenterX = (minX + maxX) / 2;
        const renderCenterY = (minY + maxY) / 2;

        const cssX = renderCenterX / renderScale;
        const cssY = renderCenterY / renderScale;
        const cssW = renderWidth / renderScale;
        const cssH = renderHeight / renderScale;

        const w = containerSize.width;
        const h = containerSize.height;

        const screenCenterX = (cssX - w / 2) * transform.zoom + w / 2 + transform.x;
        const screenCenterY = (cssY - h / 2) * transform.zoom + h / 2 + transform.y;
        const screenWidth = cssW * transform.zoom;
        const screenHeight = cssH * transform.zoom;

        const newSceneRect = {
          x: screenCenterX - screenWidth / 2,
          y: screenCenterY - screenHeight / 2,
          width: screenWidth,
          height: screenHeight,
        };
        
        setSceneRect(newSceneRect);
      } catch {
        setSceneRect(null);
      }
    };

    void updateRect();
    const sub = player.onRender.subscribe(updateRect);
    return () => sub();
  }, [player, selectedClipId, selectedClip, transform, containerSize, renderScale]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle?: ResizeHandle) => {
      if (!selectedClipId || !selectedClip || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      // Clear any pending timeout
      if (optimisticTimeoutRef.current) {
        clearTimeout(optimisticTimeoutRef.current);
        optimisticTimeoutRef.current = null;
      }

      const currentRect = sceneRect ?? optimisticRect;
      
      if (handle) {
        setIsResizing(handle);
        resizeStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          position: { ...selectedClip.position },
          scale: { ...selectedClip.scale },
          screenRect: currentRect ? { ...currentRect } : null,
        };
      } else {
        setIsDragging(true);
        dragStartRef.current = {
          clientX: e.clientX,
          clientY: e.clientY,
          pos: { ...selectedClip.position },
          screenRect: currentRect ? { ...currentRect } : null,
        };
      }
      
      // Enter optimistic mode
      setUseOptimistic(true);
      if (currentRect) {
        setOptimisticRect({ ...currentRect });
      }
    },
    [selectedClipId, selectedClip, sceneRect, optimisticRect]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!selectedClipId) return;

      const zoom = transform.zoom;

      if (isDragging) {
        const screenDeltaX = e.clientX - dragStartRef.current.clientX;
        const screenDeltaY = e.clientY - dragStartRef.current.clientY;
        const sceneDeltaX = screenDeltaX / zoom;
        const sceneDeltaY = screenDeltaY / zoom;

        // Update clip position in store
        updateClip(selectedClipId, {
          position: {
            x: dragStartRef.current.pos.x + sceneDeltaX,
            y: dragStartRef.current.pos.y + sceneDeltaY,
          },
        });

        // Update optimistic rect directly from mouse movement
        if (dragStartRef.current.screenRect) {
          setOptimisticRect({
            x: dragStartRef.current.screenRect.x + screenDeltaX,
            y: dragStartRef.current.screenRect.y + screenDeltaY,
            width: dragStartRef.current.screenRect.width,
            height: dragStartRef.current.screenRect.height,
          });
        }
        return;
      }

      if (isResizing) {
        const start = resizeStartRef.current;
        const screenDeltaX = e.clientX - start.clientX;
        const screenDeltaY = e.clientY - start.clientY;
        const dx = screenDeltaX / zoom;
        const dy = screenDeltaY / zoom;

        const startRect = start.screenRect;
        const worldW = startRect ? startRect.width / zoom : 100;
        const worldH = startRect ? startRect.height / zoom : 100;
        const minScale = 0.05;

        let newScaleX = start.scale.x;
        let newScaleY = start.scale.y;
        let newPos = { ...start.position };
        
        // Also calculate optimistic screen rect changes
        let optX = startRect?.x ?? 0;
        let optY = startRect?.y ?? 0;
        let optW = startRect?.width ?? 0;
        let optH = startRect?.height ?? 0;

        switch (isResizing) {
          case 'e':
            newScaleX = Math.max(minScale, start.scale.x * (1 + dx / worldW));
            newPos.x = start.position.x + dx / 2;
            optW = (startRect?.width ?? 0) + screenDeltaX;
            optX = (startRect?.x ?? 0);
            break;
          case 'w':
            newScaleX = Math.max(minScale, start.scale.x * (1 - dx / worldW));
            newPos.x = start.position.x + dx / 2;
            optW = (startRect?.width ?? 0) - screenDeltaX;
            optX = (startRect?.x ?? 0) + screenDeltaX;
            break;
          case 's':
            newScaleY = Math.max(minScale, start.scale.y * (1 + dy / worldH));
            newPos.y = start.position.y + dy / 2;
            optH = (startRect?.height ?? 0) + screenDeltaY;
            optY = (startRect?.y ?? 0);
            break;
          case 'n':
            newScaleY = Math.max(minScale, start.scale.y * (1 - dy / worldH));
            newPos.y = start.position.y + dy / 2;
            optH = (startRect?.height ?? 0) - screenDeltaY;
            optY = (startRect?.y ?? 0) + screenDeltaY;
            break;
          case 'se':
            newScaleX = Math.max(minScale, start.scale.x * (1 + dx / worldW));
            newScaleY = Math.max(minScale, start.scale.y * (1 + dy / worldH));
            newPos.x = start.position.x + dx / 2;
            newPos.y = start.position.y + dy / 2;
            optW = (startRect?.width ?? 0) + screenDeltaX;
            optH = (startRect?.height ?? 0) + screenDeltaY;
            break;
          case 'sw':
            newScaleX = Math.max(minScale, start.scale.x * (1 - dx / worldW));
            newScaleY = Math.max(minScale, start.scale.y * (1 + dy / worldH));
            newPos.x = start.position.x + dx / 2;
            newPos.y = start.position.y + dy / 2;
            optW = (startRect?.width ?? 0) - screenDeltaX;
            optX = (startRect?.x ?? 0) + screenDeltaX;
            optH = (startRect?.height ?? 0) + screenDeltaY;
            break;
          case 'ne':
            newScaleX = Math.max(minScale, start.scale.x * (1 + dx / worldW));
            newScaleY = Math.max(minScale, start.scale.y * (1 - dy / worldH));
            newPos.x = start.position.x + dx / 2;
            newPos.y = start.position.y + dy / 2;
            optW = (startRect?.width ?? 0) + screenDeltaX;
            optH = (startRect?.height ?? 0) - screenDeltaY;
            optY = (startRect?.y ?? 0) + screenDeltaY;
            break;
          case 'nw':
            newScaleX = Math.max(minScale, start.scale.x * (1 - dx / worldW));
            newScaleY = Math.max(minScale, start.scale.y * (1 - dy / worldH));
            newPos.x = start.position.x + dx / 2;
            newPos.y = start.position.y + dy / 2;
            optW = (startRect?.width ?? 0) - screenDeltaX;
            optX = (startRect?.x ?? 0) + screenDeltaX;
            optH = (startRect?.height ?? 0) - screenDeltaY;
            optY = (startRect?.y ?? 0) + screenDeltaY;
            break;
        }

        updateClip(selectedClipId, {
          position: newPos,
          scale: { x: newScaleX, y: newScaleY },
        });

        // Update optimistic rect
        if (startRect) {
          setOptimisticRect({
            x: optX,
            y: optY,
            width: Math.max(20, optW),
            height: Math.max(20, optH),
          });
        }
      }
    },
    [isDragging, isResizing, selectedClipId, transform.zoom, updateClip]
  );

  const handleMouseUp = useCallback(() => {
    // Notify parent to skip hitbox selection on this release (avoids selecting whatever is under cursor)
    if (isDragging) onDragEnd?.();
    setIsDragging(false);
    setIsResizing(null);
    
    // Keep optimistic mode for a bit after release to let scene catch up
    optimisticTimeoutRef.current = setTimeout(() => {
      setUseOptimistic(false);
      setOptimisticRect(null);
      optimisticTimeoutRef.current = null;
    }, OPTIMISTIC_TIMEOUT_MS);
  }, [onDragEnd]);

  useEffect(() => {
    if (!isDragging && !isResizing) return;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (optimisticTimeoutRef.current) {
        clearTimeout(optimisticTimeoutRef.current);
      }
    };
  }, []);

  // Use optimistic rect during interaction, otherwise use scene rect
  const displayRect = useOptimistic && optimisticRect ? optimisticRect : sceneRect;

  if (!displayRect) return null;

  const handleSize = 10;
  const halfHandle = handleSize / 2;

  const resizeHandles: {
    handle: ResizeHandle;
    style: React.CSSProperties;
    cursor: string;
  }[] = [
    { handle: 'nw', style: { left: -halfHandle, top: -halfHandle }, cursor: 'nwse-resize' },
    { handle: 'ne', style: { right: -halfHandle, top: -halfHandle }, cursor: 'nesw-resize' },
    { handle: 'sw', style: { left: -halfHandle, bottom: -halfHandle }, cursor: 'nesw-resize' },
    { handle: 'se', style: { right: -halfHandle, bottom: -halfHandle }, cursor: 'nwse-resize' },
    { handle: 'n', style: { left: '50%', top: -halfHandle, transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
    { handle: 's', style: { left: '50%', bottom: -halfHandle, transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
    { handle: 'w', style: { left: -halfHandle, top: '50%', transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
    { handle: 'e', style: { right: -halfHandle, top: '50%', transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
  ];

  return (
    <div
      className="absolute z-10 pointer-events-none"
      style={{
        left: displayRect.x,
        top: displayRect.y,
        width: displayRect.width,
        height: displayRect.height,
      }}
    >
      {/* Draggable box */}
      <div
        className={clsx(
          'absolute inset-0 border-2 border-cyan-500 bg-cyan-500/10',
          'hover:bg-cyan-500/20 transition-colors',
          (isDragging && 'cursor-grabbing') ||
            (!isResizing && 'cursor-grab')
        )}
        style={{ pointerEvents: 'auto' }}
        onMouseDown={(e) => handleMouseDown(e)}
      />
      {/* Resize handles */}
      {resizeHandles.map(({ handle, style, cursor }) => (
        <div
          key={handle}
          className="absolute bg-white border-2 border-cyan-500 rounded-sm hover:bg-cyan-500 shadow-sm"
          style={{
            width: handleSize,
            height: handleSize,
            cursor,
            pointerEvents: 'auto',
            ...style,
          }}
          onMouseDown={(e) => handleMouseDown(e, handle)}
        />
      ))}
    </div>
  );
}
