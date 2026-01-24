'use client';

import { Player, Stage, Vector2, type Project, type Scene } from '@motion-canvas/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Layer } from '@/app/types/timeline';
import { useDrag } from '@/app/hooks/use-drag';

const SCENE_URL = '/scene/src/project.js';
const PREVIEW_FPS = 30;
const DEFAULT_SIZE = new Vector2(1920, 1080);
const ZOOM_SPEED = 0.1;

interface ScenePlayerProps {
  onPlayerChange?: (player: Player | null) => void;
  layers?: Layer[];
  duration?: number;
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
}

export function ScenePlayer({
  onPlayerChange,
  layers = [],
  duration = 10,
  currentTime = 0,
  onTimeUpdate,
}: ScenePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const latestLayersRef = useRef(layers);

  useEffect(() => {
    latestLayersRef.current = layers;
  }, [layers]);

  // Viewport State
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [zoomToFit, setZoomToFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Load project from built scene via <script type="module">
  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;
    let script: HTMLScriptElement | null = null;

    (async () => {
      try {
        const res = await fetch(SCENE_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.text();
        const blob = new Blob([raw], { type: 'text/javascript' });
        blobUrl = URL.createObjectURL(blob);

        const win = typeof window !== 'undefined' ? (window as unknown as { __SCENE_PROJECT__?: Project }) : null;
        if (win) delete win.__SCENE_PROJECT__;

        await new Promise<void>((resolve, reject) => {
          script = document.createElement('script');
          script.type = 'module';
          script.src = blobUrl!;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Scene script failed to load'));
          document.head.appendChild(script);
        });

        if (cancelled) return;

        const m: Project | undefined = win?.__SCENE_PROJECT__;
        if (!m || typeof m !== 'object') throw new Error('Invalid project export');

        setProject(m);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        (script as HTMLScriptElement | null)?.remove();
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Monitor container size
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Calculate Transform
  const transform = useMemo(() => {
    const projectSize = project?.meta.shared.size.get() || DEFAULT_SIZE;
    
    // Default / Manual state
    let currentZoom = zoom;
    let x = position.x;
    let y = position.y;

    if (zoomToFit && containerSize.width > 0 && containerSize.height > 0) {
      const widthRatio = containerSize.width / projectSize.width;
      const heightRatio = containerSize.height / projectSize.height;
      // 90% fit to have some padding
      currentZoom = Math.min(widthRatio, heightRatio) * 0.9;
      x = 0;
      y = 0;
    }

    return { zoom: currentZoom, x, y };
  }, [project, zoomToFit, zoom, position, containerSize]);

  // Refs for event handlers to avoid re-binding listeners
  const transformRef = useRef(transform);
  useEffect(() => { transformRef.current = transform; }, [transform]);

  const zoomToFitRef = useRef(zoomToFit);
  useEffect(() => { zoomToFitRef.current = zoomToFit; }, [zoomToFit]);

  // Handle Drag
  const [handleDrag, isDragging] = useDrag(
    useCallback(
      (dx, dy) => {
        if (zoomToFit) {
          setZoomToFit(false);
          setZoom(transform.zoom);
          setPosition({
            x: transform.x + dx,
            y: transform.y + dy,
          });
        } else {
          setPosition((prev) => ({
            x: prev.x + dx,
            y: prev.y + dy,
          }));
        }
      },
      [zoomToFit, transform]
    ),
    undefined,
    null
  );

  // Handle Wheel
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => {
      if (isDragging) return;
      
      // Always prevent default to stop browser zooming/scrolling while over the canvas
      event.preventDefault();

      if (event.metaKey || event.ctrlKey) {
        // Zoom
        const rect = container.getBoundingClientRect();
        const pointer = {
          x: event.clientX - rect.left - rect.width / 2,
          y: event.clientY - rect.top - rect.height / 2,
        };

        const ratio = 1 - Math.sign(event.deltaY) * ZOOM_SPEED;

        const { zoom: currentZoom, x: currentX, y: currentY } = transformRef.current;

        setZoomToFit(false);
        setZoom(currentZoom * ratio);
        setPosition({
          x: pointer.x + (currentX - pointer.x) * ratio,
          y: pointer.y + (currentY - pointer.y) * ratio,
        });
      } else {
        // Pan
        setZoomToFit(false);
        
        // If we were in zoomToFit, we need to ensure the "zoom" state is set to the calculated zoom
        // so the subsequent render doesn't jump.
        if (zoomToFitRef.current) {
            setZoom(transformRef.current.zoom);
        }

        setPosition((prev) => {
          const startX = zoomToFitRef.current ? transformRef.current.x : prev.x;
          const startY = zoomToFitRef.current ? transformRef.current.y : prev.y;
          return {
            x: startX - event.deltaX,
            y: startY - event.deltaY,
          };
        });
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [isDragging]);

  // Init player, stage, render loop when project is ready
  useEffect(() => {
    if (!project || !containerRef.current) return;

    const m = project;
    const meta = m.meta;
    const preview = meta.preview.get();
    const size = meta.shared.size.get();
    const initialSize = size.x > 0 && size.y > 0 ? size : DEFAULT_SIZE;

    const stageInstance = new Stage();
    const playerInstance = new Player(m, {
      ...preview,
      size: initialSize,
      range: [0, duration * PREVIEW_FPS], // Convert to frames
      fps: PREVIEW_FPS,
      resolutionScale: 1,
    });

    playerInstance.onRender.subscribe(async () => {
      const currentScene = playerInstance.playback.currentScene as Scene | null;
      if (!currentScene) return;

      try {
        const previousScene = playerInstance.playback.previousScene as Scene | null;
        await stageInstance.render(currentScene, previousScene ?? undefined);
      } catch (err) {
        console.error('Render error:', err);
      }
    });

    stageInstance.configure({
      size: initialSize,
      resolutionScale: 1,
      background: null,
    });

    // Provide initial variables so the scene can render immediately.
    playerInstance.setVariables({
      layers: latestLayersRef.current,
      duration,
    });
    (playerInstance as unknown as { requestRecalculation?: () => void }).requestRecalculation?.();
    playerInstance.requestRender();

    // Style the canvas
    const canvas = stageInstance.finalBuffer;
    canvas.style.width = `${initialSize.width}px`;
    canvas.style.height = `${initialSize.height}px`;
    canvas.style.display = 'block';
    
    containerRef.current.append(canvas);

    setStage(stageInstance);
    setPlayer(playerInstance);
    onPlayerChange?.(playerInstance);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      canvas.remove();
      setStage(null);
      setPlayer(null);
      onPlayerChange?.(null);
    };
  }, [project, onPlayerChange, duration]);

  // Update canvas transform
  useEffect(() => {
    if (stage?.finalBuffer) {
      stage.finalBuffer.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`;
    }
  }, [stage, transform]);

  // Update variables when clips or duration change
  useEffect(() => {
    if (!player) return;

    player.setVariables({
      layers,
      duration,
    });
    (player as unknown as { requestRecalculation?: () => void }).requestRecalculation?.();
    player.requestRender();
  }, [player, layers, duration]);

  // Sync playhead time from player back to the store during playback
  useEffect(() => {
    if (!player || !onTimeUpdate) return;

    const updateTime = () => {
      const time = player.playback.frame / PREVIEW_FPS;
      onTimeUpdate(time);
      animationFrameRef.current = requestAnimationFrame(updateTime);
    };

    // Only track time when playing
    player.onStateChanged.subscribe((state) => {
      if (state.paused) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      } else {
        updateTime();
      }
    });

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [player, onTimeUpdate]);

  // Seek when currentTime changes externally (clicking on timeline)
  useEffect(() => {
    if (!player) return;

    const frame = Math.floor(currentTime * PREVIEW_FPS);
    if (Math.abs(player.playback.frame - frame) > 1) {
      player.requestSeek(frame);
      player.requestRender();
    }
  }, [player, currentTime]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive max-w-md">
          <p className="font-medium">Failed to load scene</p>
          <p className="text-sm mt-1">{error}</p>
          <p className="text-xs mt-2 opacity-80">Run: pnpm run build:scene</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center overflow-hidden bg-black relative"
        onMouseDown={(e) => {
          // Middle click or Shift+Left click
          if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
            handleDrag(e);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {!project && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading scene…</p>
        </div>
      )}
    </div>
  );
}
