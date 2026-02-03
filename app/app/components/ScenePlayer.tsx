'use client';

import { Player, Stage, Vector2, type Project, type Scene } from '@motion-canvas/core';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Layer, TimelineClip } from '@/app/types/timeline';
import type { ProjectTranscription } from '@/app/types/transcription';
import { useDrag } from '@/app/hooks/use-drag';
import { SelectionOverlay } from './SelectionOverlay';
import { useProjectStore } from '@/app/lib/store/project-store';
import { PreviewSkeleton } from '@/app/components/editor/PreviewSkeleton';
import { motion, AnimatePresence } from 'motion/react';

export interface ScenePlayerHandle {
  recenter: () => void;
}

interface SceneNode {
  worldToLocal: () => DOMMatrix;
  width?: () => number;
  height?: () => number;
}

interface SceneGraph {
  getNode?: (key: string) => SceneNode | null;
}

const SCENE_URL = '/scene/src/project.js';
const PREVIEW_FPS = 30;
const ZOOM_SPEED = 0.1;

interface ScenePlayerProps {
  onPlayerChange?: (player: Player | null) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onVariablesUpdated?: () => void;
  layers?: Layer[];
  duration?: number;
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
  transcriptions?: Record<string, ProjectTranscription>;
  transitions?: Record<string, any>;
      captionSettings?: {
    fontFamily: string;
    fontWeight: number;
    fontSize?: number;
    distanceFromBottom: number;
    style?: string;
  };
  textClipSettings?: {
    fontFamily: string;
    fontWeight: number;
    defaultFontSize: number;
    defaultFill: string;
  };
  sceneConfig: {
    resolution: { width: number; height: number };
    renderScale: number;
    background: string;
  };
}

export const ScenePlayer = forwardRef<ScenePlayerHandle, ScenePlayerProps>(function ScenePlayer({
  onPlayerChange,
  onCanvasReady,
  onVariablesUpdated,
  layers = [],
  duration = 10,
  currentTime = 0,
  onTimeUpdate,
  transcriptions = {},
  transitions = {},
  captionSettings,
  textClipSettings,
  sceneConfig,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasRenderedFirstFrame, setHasRenderedFirstFrame] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const latestLayersRef = useRef(layers);
  const latestTranscriptionsRef = useRef(transcriptions);
  const latestTransitionsRef = useRef(transitions);
  const latestCaptionSettingsRef = useRef(captionSettings);
  const latestTextClipSettingsRef = useRef(textClipSettings);
  const onVariablesUpdatedRef = useRef(onVariablesUpdated);
  const latestCurrentTimeRef = useRef(currentTime);
  
  const setSelectedClip = useProjectStore((s) => s.setSelectedClip);

  // Skip hitbox/selection on the next click when user just released from dragging the selection overlay
  const skipNextSceneClickRef = useRef(false);

  useEffect(() => {
    latestLayersRef.current = layers;
  }, [layers]);

  useEffect(() => {
    latestTranscriptionsRef.current = transcriptions;
  }, [transcriptions]);

  useEffect(() => {
    latestTransitionsRef.current = transitions;
  }, [transitions]);

  useEffect(() => {
    latestCaptionSettingsRef.current = captionSettings;
  }, [captionSettings]);

  useEffect(() => {
    latestTextClipSettingsRef.current = textClipSettings;
  }, [textClipSettings]);

  useEffect(() => {
    onVariablesUpdatedRef.current = onVariablesUpdated;
  }, [onVariablesUpdated]);

  useEffect(() => {
    latestCurrentTimeRef.current = currentTime;
  }, [currentTime]);

  // Viewport State
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [zoomToFit, setZoomToFit] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Expose recenter function via ref
  useImperativeHandle(ref, () => ({
    recenter: () => {
      setZoomToFit(true);
    },
  }), []);

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
    const targetSize = new Vector2(
      sceneConfig.resolution.width,
      sceneConfig.resolution.height
    );
    
    // Default / Manual state
    let currentZoom = zoom;
    let x = position.x;
    let y = position.y;

    if (zoomToFit && containerSize.width > 0 && containerSize.height > 0) {
      const widthRatio = containerSize.width / targetSize.width;
      const heightRatio = containerSize.height / targetSize.height;
      // 90% fit to have some padding
      currentZoom = Math.min(widthRatio, heightRatio) * 0.9;
      x = 0;
      y = 0;
    }

    return { zoom: currentZoom, x, y };
  }, [zoomToFit, zoom, position, containerSize, sceneConfig.resolution]);

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

  // Handle click to select clips
  const handleSceneClick = useCallback(
    (e: React.MouseEvent) => {
      if (!player || !containerRef.current) return;
      // Don't run hitbox logic when we just released from dragging the selection overlay
      if (skipNextSceneClickRef.current) {
        skipNextSceneClickRef.current = false;
        return;
      }
      // Don't handle if shift is held (that's for panning)
      if (e.shiftKey) return;

      const rect = containerRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Convert screen click to CSS canvas coordinates
      // Reverse the transform: screenX = (cssX - w/2) * zoom + w/2 + tx
      // cssX = (screenX - w/2 - tx) / zoom + w/2
      const w = containerSize.width;
      const h = containerSize.height;
      const cssX = (clickX - w / 2 - transform.x) / transform.zoom + w / 2;
      const cssY = (clickY - h / 2 - transform.y) / transform.zoom + h / 2;

      // Convert CSS to render coordinates
      const renderX = cssX;
      const renderY = cssY;

      const scene = player.playback.currentScene as SceneGraph | null;
      if (!scene?.getNode) return;

      // Check clips in forward order (bottom layers first) for hit detection
      // Only check clips that are active at current time
      const currentSeconds = currentTime;
      let foundClipId: string | null = null;

      // Iterate layers forward (bottom to top visually)
      for (let i = 0; i < layers.length && !foundClipId; i++) {
        const layer = layers[i];
        // Skip audio layers
        if (layer.type === 'audio') continue;

        // Check clips in forward order
        for (let j = 0; j < layer.clips.length && !foundClipId; j++) {
          const clip = layer.clips[j] as TimelineClip;
          const speed = clip.speed ?? 1;
          const safeSpeed = Math.max(speed, 0.0001);
          const clipStart = clip.start;
          const clipEnd = clipStart + clip.duration / safeSpeed;

          // Skip if clip is not active at current time
          if (currentSeconds < clipStart || currentSeconds > clipEnd) continue;

          // Get node key based on clip type
          let nodeKey: string | null = null;
          if (clip.type === 'video') nodeKey = `video-clip-${clip.id}`;
          else if (clip.type === 'text') {
            const template = clip.template ?? 'text';
            switch (template) {
              case 'title-card':
                nodeKey = `title-card-container-${clip.id}`;
                break;
              case 'lower-third':
                nodeKey = `lower-third-container-${clip.id}`;
                break;
              case 'caption-style':
                nodeKey = `caption-style-container-${clip.id}`;
                break;
              case 'text':
              default:
                nodeKey = `text-clip-${clip.id}`;
                break;
            }
          }
          else if (clip.type === 'image') nodeKey = `image-clip-${clip.id}`;

          if (!nodeKey) continue;

          try {
            const node = scene.getNode(nodeKey);
            if (!node) continue;

            // Convert click to node's local space
            const worldToLocal = node.worldToLocal();
            const localPoint = new DOMPoint(renderX, renderY).matrixTransform(worldToLocal);

            // Get node dimensions
            const nodeWidth = typeof node.width === 'function' ? node.width() ?? 0 : 0;
            const nodeHeight = typeof node.height === 'function' ? node.height() ?? 0 : 0;

            // Check if click is within node bounds (centered at origin in local space)
            const halfW = nodeWidth / 2;
            const halfH = nodeHeight / 2;

            if (
              localPoint.x >= -halfW &&
              localPoint.x <= halfW &&
              localPoint.y >= -halfH &&
              localPoint.y <= halfH
            ) {
              foundClipId = clip.id;
            }
          } catch {
            // Node lookup failed, skip
          }
        }
      }

      if (foundClipId) {
        e.stopPropagation();
        setSelectedClip(foundClipId);
      } else {
        // Click on empty space - deselect
        setSelectedClip(null);
      }
    },
    [player, containerSize, transform, currentTime, layers, setSelectedClip]
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
    if (!project || !canvasWrapperRef.current) return;

    console.log('[ScenePlayer] Creating player', { resolution: sceneConfig.resolution, renderScale: sceneConfig.renderScale, seekToTime: latestCurrentTimeRef.current });

    const m = project;
    const meta = m.meta;
    const preview = meta.preview.get();
    const initialSize = new Vector2(
      sceneConfig.resolution.width,
      sceneConfig.resolution.height
    );

    const stageInstance = new Stage();
    const playerInstance = new Player(m, {
      ...preview,
      size: initialSize,
      range: [0, duration * PREVIEW_FPS], // Convert to frames
      fps: PREVIEW_FPS,
      resolutionScale: sceneConfig.renderScale,
    });

    let hasRendered = false;
    playerInstance.onRender.subscribe(async () => {
      const currentScene = playerInstance.playback.currentScene as Scene | null;
      if (!currentScene) return;

      try {
        const previousScene = playerInstance.playback.previousScene as Scene | null;
        await stageInstance.render(currentScene, previousScene ?? null);

        // Mark first frame as rendered
        if (!hasRendered) {
          hasRendered = true;
          console.log('[ScenePlayer] First frame rendered, removing loader');
          setHasRenderedFirstFrame(true);
        }
      } catch (err) {
        console.error('Render error:', err);
      }
    });

    stageInstance.configure({
      size: initialSize,
      resolutionScale: sceneConfig.renderScale,
      background: sceneConfig.background,
    });

    // Provide initial variables so the scene can render immediately.
    playerInstance.setVariables({
      layers: latestLayersRef.current,
      duration,
      transcriptions: latestTranscriptionsRef.current,
      transitions: latestTransitionsRef.current,
      captionSettings: latestCaptionSettingsRef.current ?? {
        fontFamily: 'Inter Variable',
        fontWeight: 400,
        fontSize: 18,
        distanceFromBottom: 140,
        style: 'pill',
      },
      textClipSettings: latestTextClipSettingsRef.current ?? {
        fontFamily: 'Inter Variable',
        fontWeight: 400,
        defaultFontSize: 48,
        defaultFill: '#ffffff',
      },
    });
    (playerInstance as unknown as { requestRecalculation?: () => void }).requestRecalculation?.();
    
    // Seek to current playhead position so we don't reset to frame 0
    // Use setTimeout to give the player time to initialize before seeking
    const initialFrame = Math.floor(latestCurrentTimeRef.current * PREVIEW_FPS);
    const seekTimeout = setTimeout(() => {
      playerInstance.requestSeek(initialFrame);
      playerInstance.requestRender();
    }, 50);

    // Style the canvas
    const canvas = stageInstance.finalBuffer;
    canvas.style.width = `${initialSize.width}px`;
    canvas.style.height = `${initialSize.height}px`;
    canvas.style.display = 'block';
    
    canvasWrapperRef.current.append(canvas);

    setStage(stageInstance);
    setPlayer(playerInstance);
    onPlayerChange?.(playerInstance);
    onCanvasReady?.(canvas);

    return () => {
      clearTimeout(seekTimeout);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      canvas.remove();
      setStage(null);
      setPlayer(null);
      onPlayerChange?.(null);
      onCanvasReady?.(null);
    };
  }, [
    project,
    onPlayerChange,
    onCanvasReady,
    duration,
    sceneConfig.resolution.width,
    sceneConfig.resolution.height,
    sceneConfig.renderScale,
    // Note: background is handled by the stage.configure() useEffect below
    // to avoid recreating the player (which resets to frame 0)
  ]);

  // Update canvas transform
  useEffect(() => {
    if (stage?.finalBuffer) {
      stage.finalBuffer.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`;
    }
  }, [stage, transform]);

  useEffect(() => {
    if (!stage || !player) return;
    stage.configure({
      size: new Vector2(sceneConfig.resolution.width, sceneConfig.resolution.height),
      resolutionScale: sceneConfig.renderScale,
      background: sceneConfig.background,
    });
    if (stage.finalBuffer) {
      stage.finalBuffer.style.width = `${sceneConfig.resolution.width}px`;
      stage.finalBuffer.style.height = `${sceneConfig.resolution.height}px`;
    }
    player.requestRender();
  }, [
    stage,
    player,
    sceneConfig.resolution.width,
    sceneConfig.resolution.height,
    sceneConfig.renderScale,
    sceneConfig.background,
  ]);

  // Update variables when clips or duration change
  useEffect(() => {
    if (!player) return;

    player.setVariables({
      layers,
      duration,
      transcriptions,
      transitions,
      captionSettings: captionSettings ?? {
        fontFamily: 'Inter Variable',
        fontWeight: 400,
        fontSize: 18,
        distanceFromBottom: 140,
        style: 'pill',
      },
      textClipSettings: textClipSettings ?? {
        fontFamily: 'Inter Variable',
        fontWeight: 400,
        defaultFontSize: 48,
        defaultFill: '#ffffff',
      },
    });
    (player as unknown as { requestRecalculation?: () => void }).requestRecalculation?.();
    player.requestRender();

    // Notify parent that variables were updated
    onVariablesUpdatedRef.current?.();
  }, [player, layers, duration, transcriptions, transitions, captionSettings, textClipSettings]);

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
    <div className="flex h-full flex-col min-w-0 min-h-0">
      <div
        className="relative flex flex-1 min-h-0 min-w-0 overflow-auto bg-black"
        style={{ contain: "layout paint" }}
      >
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{
            width: sceneConfig.resolution.width,
            height: sceneConfig.resolution.height,
            background: sceneConfig.background,
          }}
        >
          <div
            ref={containerRef}
            className="relative w-full h-full"
            onMouseDown={(e) => {
              if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
                handleDrag(e);
              }
            }}
            onClick={handleSceneClick}
            onContextMenu={(e) => e.preventDefault()}
          >
            <div ref={canvasWrapperRef} className="absolute inset-0" />
            {player && (
              <SelectionOverlay
                player={player}
                transform={transform}
                containerSize={containerSize}
                renderScale={sceneConfig.renderScale}
                onDragEnd={() => {
                  skipNextSceneClickRef.current = true;
                }}
              />
            )}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {!project && !error && (
          <motion.div
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <PreviewSkeleton />
          </motion.div>
        )}
        {project && !hasRenderedFirstFrame && !error && layers.some(layer => layer.clips.length > 0) && (
          <motion.div
            className="absolute inset-0 pointer-events-none flex items-center justify-center bg-black/50"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="size-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              <span className="text-xs text-white/60">Loading preview...</span>
            </div>
          </motion.div>
        )}
        {project && !error && !layers.some(layer => layer.clips.length > 0) && (
          <motion.div
            className="absolute inset-0 pointer-events-none flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex flex-col items-center gap-2 text-white/40">
              <svg
                className="size-12 opacity-50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span className="text-xs">Add clips to preview</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
