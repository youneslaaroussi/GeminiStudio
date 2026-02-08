'use client';

import { Player, Stage, Vector2, type Project, type Scene } from '@motion-canvas/core';
import equal from 'fast-deep-equal';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ResolvedLayer, ResolvedTimelineClip } from '@/app/types/timeline';
import type { ProjectTranscription } from '@/app/types/transcription';
import { useDrag } from '@/app/hooks/use-drag';
import { SelectionOverlay } from './SelectionOverlay';
import { useProjectStore } from '@/app/lib/store/project-store';
import { useAssetsStore } from '@/app/lib/store/assets-store';
import { PreviewSkeleton } from '@/app/components/editor/PreviewSkeleton';
import { motion, AnimatePresence } from 'motion/react';
import { getAuthHeaders } from '@/app/lib/hooks/useAuthFetch';
import { computeCodeHash, getCachedScene, setCachedScene } from '@/app/lib/cache/scene-cache';
import { requestCompileScene } from '@/app/lib/compile-scene-client';

export interface ScenePlayerHandle {
  recenter: () => void;
}

interface SceneBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SceneNode {
  worldToLocal: () => DOMMatrix;
  width?: () => number;
  height?: () => number;
  cacheBBox?: () => SceneBBox;
}

interface SceneGraph {
  getNode?: (key: string) => SceneNode | null;
}

const PREVIEW_FPS = 30;
const ZOOM_SPEED = 0.1;

interface ScenePlayerProps {
  onPlayerChange?: (player: Player | null) => void;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onVariablesUpdated?: () => void;
  /** When true, variable updates are queued and applied when playback stops */
  isPlaying?: boolean;
  /** Called when an update is queued (true) or cleared (false) during playback */
  onUpdateQueued?: (queued: boolean) => void;
  layers?: ResolvedLayer[];
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
  onReloadPreview?: () => void;
}

export const ScenePlayer = forwardRef<ScenePlayerHandle, ScenePlayerProps>(function ScenePlayer({
  onPlayerChange,
  onCanvasReady,
  onVariablesUpdated,
  isPlaying = false,
  onUpdateQueued,
  layers = [],
  duration = 10,
  currentTime = 0,
  onTimeUpdate,
  transcriptions = {},
  transitions = {},
  captionSettings,
  textClipSettings,
  sceneConfig,
  onReloadPreview,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [hasRenderedFirstFrame, setHasRenderedFirstFrame] = useState(false);
  const [showSlowLoadHint, setShowSlowLoadHint] = useState(false);
  const animationFrameRef = useRef<number | null>(null);
  const slowLoadHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestLayersRef = useRef(layers);
  const latestTranscriptionsRef = useRef(transcriptions);
  const latestTransitionsRef = useRef(transitions);
  const latestCaptionSettingsRef = useRef(captionSettings);
  const latestTextClipSettingsRef = useRef(textClipSettings);
  const onVariablesUpdatedRef = useRef(onVariablesUpdated);
  const onUpdateQueuedRef = useRef(onUpdateQueued);
  const latestCurrentTimeRef = useRef(currentTime);

  useEffect(() => {
    onUpdateQueuedRef.current = onUpdateQueued;
  }, [onUpdateQueued]);
  
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

  // After 10s in "loading preview" state, show hint to use the reload button
  const isLoadingPreview = !!(
    project &&
    !error &&
    !hasRenderedFirstFrame &&
    layers.some((layer) => layer.clips.length > 0)
  );
  useEffect(() => {
    if (!isLoadingPreview) {
      setShowSlowLoadHint(false);
      if (slowLoadHintTimeoutRef.current) {
        clearTimeout(slowLoadHintTimeoutRef.current);
        slowLoadHintTimeoutRef.current = null;
      }
      return;
    }
    setShowSlowLoadHint(false);
    slowLoadHintTimeoutRef.current = setTimeout(() => setShowSlowLoadHint(true), 10_000);
    return () => {
      if (slowLoadHintTimeoutRef.current) {
        clearTimeout(slowLoadHintTimeoutRef.current);
        slowLoadHintTimeoutRef.current = null;
      }
    };
  }, [isLoadingPreview]);

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

  // --- Smart compilation with component awareness ---
  const projectId = useProjectStore((s) => s.projectId);
  const allAssets = useAssetsStore((s) => s.assets);

  // Build the component file overrides map from component assets
  const componentFiles = useMemo(() => {
    const files: Record<string, string> = {};
    for (const asset of allAssets) {
      if (asset.type === 'component' && asset.code && asset.componentName) {
        files[`src/components/custom/${asset.componentName}.tsx`] = asset.code;
      }
    }
    return files;
  }, [allAssets]);

  const codeHash = useMemo(() => computeCodeHash(componentFiles), [componentFiles]);

  // Track whether we need to recompile
  const compiledCodeHashRef = useRef<string | null>(null);
  const pendingRecompileRef = useRef<boolean>(false);
  const isCompilingRef = useRef<boolean>(false);

  // Load a JS string as a module and return the Project
  const loadCompiledJs = useCallback(async (js: string): Promise<Project> => {
    const blob = new Blob([js], { type: 'text/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    const scriptHolder: { el: HTMLScriptElement | null } = { el: null };
    try {
      const win = typeof window !== 'undefined' ? (window as unknown as { __SCENE_PROJECT__?: Project }) : null;
      if (win) delete win.__SCENE_PROJECT__;

      await new Promise<void>((resolve, reject) => {
        const el = document.createElement('script');
        el.type = 'module';
        el.src = blobUrl;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error('Scene script failed to load'));
        scriptHolder.el = el;
        document.head.appendChild(el);
      });

      const m: Project | undefined = win?.__SCENE_PROJECT__;
      if (!m || typeof m !== 'object') throw new Error('Invalid project export');
      return m;
    } finally {
      scriptHolder.el?.remove();
      URL.revokeObjectURL(blobUrl);
    }
  }, []);

  // Compile and load scene
  const compileAndLoad = useCallback(async (files: Record<string, string>, hash: string) => {
    if (isCompilingRef.current) {
      pendingRecompileRef.current = true;
      return;
    }
    isCompilingRef.current = true;
    setIsCompiling(true);
    try {
      // Try IndexedDB cache first
      if (projectId) {
        const cached = await getCachedScene(projectId, hash);
        if (cached) {
          console.log('[ScenePlayer] Using cached scene for hash', hash);
          const proj = await loadCompiledJs(cached.js);
          compiledCodeHashRef.current = hash;
          setProject(proj);
          setError(null);
          // Still recompile in background to ensure cache stays fresh
          // (but don't block the UI)
          isCompilingRef.current = false;
          setIsCompiling(false);
          return;
        }
      }

      const authHeaders = await getAuthHeaders();
      const res = await requestCompileScene(
        { files: Object.keys(files).length > 0 ? files : undefined },
        authHeaders
      );
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Compile failed (${res.status}): ${errText}`);
      }
      const { js } = await res.json();

      // Cache the result
      if (projectId) {
        void setCachedScene(projectId, hash, js);
      }

      const proj = await loadCompiledJs(js);
      compiledCodeHashRef.current = hash;
      setProject(proj);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      isCompilingRef.current = false;
      setIsCompiling(false);
      // If a recompile was queued while we were compiling, do it now
      if (pendingRecompileRef.current) {
        pendingRecompileRef.current = false;
        // Use a timeout to avoid synchronous recursion
        setTimeout(() => {
          void compileAndLoad(componentFiles, codeHash);
        }, 100);
      }
    }
  }, [projectId, loadCompiledJs, componentFiles, codeHash]);

  // Initial compile on mount
  useEffect(() => {
    void compileAndLoad(componentFiles, codeHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompile when component code changes (but defer during playback)
  const prevCodeHashRef = useRef(codeHash);
  useEffect(() => {
    if (prevCodeHashRef.current === codeHash) return;
    prevCodeHashRef.current = codeHash;

    if (isPlaying) {
      // Defer recompile until playback stops
      pendingRecompileRef.current = true;
      return;
    }

    void compileAndLoad(componentFiles, codeHash);
  }, [codeHash, isPlaying, compileAndLoad, componentFiles]);

  // When playback stops, check for pending recompile
  const prevIsPlayingForCompileRef = useRef(isPlaying);
  useEffect(() => {
    const wasPlaying = prevIsPlayingForCompileRef.current;
    prevIsPlayingForCompileRef.current = isPlaying;

    if (wasPlaying && !isPlaying && pendingRecompileRef.current) {
      pendingRecompileRef.current = false;
      void compileAndLoad(componentFiles, codeHash);
    }
  }, [isPlaying, compileAndLoad, componentFiles, codeHash]);

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

  // Touch gesture state
  const touchStateRef = useRef<{
    touches: number;
    initialDistance: number;
    initialCenter: { x: number; y: number }; // Screen coordinates (clientX/Y)
    initialZoom: number;
    initialPosition: { x: number; y: number }; // Transform position
    lastTouchPos: { x: number; y: number } | null; // Screen coordinates
    lastTouchTime: number;
    velocity: { x: number; y: number };
    isPanning: boolean;
    startTime: number;
  } | null>(null);

  const momentumAnimationRef = useRef<number | null>(null);

  // Convert screen coordinates to transform coordinates (relative to container center)
  function screenToTransform(screenX: number, screenY: number, container: HTMLElement): { x: number; y: number } {
    const rect = container.getBoundingClientRect();
    return {
      x: screenX - rect.left - rect.width / 2,
      y: screenY - rect.top - rect.height / 2,
    };
  }

  function getTouchCenter(touches: TouchList): { x: number; y: number } {
    let x = 0, y = 0;
    for (let i = 0; i < touches.length; i++) {
      x += touches[i].clientX;
      y += touches[i].clientY;
    }
    return { x: x / touches.length, y: y / touches.length };
  }

  function getTouchDistance(touches: TouchList): number {
    if (touches.length < 2) return 0;
    const dx = touches[1].clientX - touches[0].clientX;
    const dy = touches[1].clientY - touches[0].clientY;
    return Math.hypot(dx, dy);
  }

  // Handle Touch gestures (pinch-to-zoom, pan with momentum)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Cancel any ongoing momentum animation
    const cancelMomentum = () => {
      if (momentumAnimationRef.current !== null) {
        cancelAnimationFrame(momentumAnimationRef.current);
        momentumAnimationRef.current = null;
      }
    };

    // Apply momentum scrolling
    const applyMomentum = (velocity: { x: number; y: number }) => {
      cancelMomentum();
      
      const friction = 0.95;
      const minVelocity = 0.5;
      
      let vx = velocity.x;
      let vy = velocity.y;
      
      const animate = () => {
        if (Math.abs(vx) < minVelocity && Math.abs(vy) < minVelocity) {
          momentumAnimationRef.current = null;
          return;
        }
        
        setPosition((prev) => ({
          x: prev.x + vx,
          y: prev.y + vy,
        }));
        
        vx *= friction;
        vy *= friction;
        
        momentumAnimationRef.current = requestAnimationFrame(animate);
      };
      
      momentumAnimationRef.current = requestAnimationFrame(animate);
    };

    const onTouchStart = (e: TouchEvent) => {
      cancelMomentum();
      
      if (e.touches.length === 1 || e.touches.length === 2) {
        const { zoom: z, x, y } = transformRef.current;
        const now = Date.now();
        
        if (e.touches.length === 2) {
          // Two-finger gesture: pinch-to-zoom
          e.preventDefault();
          const center = getTouchCenter(e.touches);
          const distance = getTouchDistance(e.touches);
          
          touchStateRef.current = {
            touches: 2,
            initialDistance: distance,
            initialCenter: center,
            initialZoom: z,
            initialPosition: { x, y },
            lastTouchPos: null,
            lastTouchTime: now,
            velocity: { x: 0, y: 0 },
            isPanning: false,
            startTime: now,
          };
        } else {
          // Single-finger gesture: pan (or tap for selection)
          const center = getTouchCenter(e.touches);
          
          touchStateRef.current = {
            touches: 1,
            initialDistance: 0,
            initialCenter: center,
            initialZoom: z,
            initialPosition: { x, y },
            lastTouchPos: center,
            lastTouchTime: now,
            velocity: { x: 0, y: 0 },
            isPanning: false,
            startTime: now,
          };
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const state = touchStateRef.current;
      if (!state || !container) return;

      const now = Date.now();
      const deltaTime = Math.max(1, now - state.lastTouchTime);

      if (e.touches.length === 2 && state.touches === 2) {
        // Pinch-to-zoom: keep the point under the current pinch center fixed
        e.preventDefault();
        const distance = getTouchDistance(e.touches);
        const center = getTouchCenter(e.touches);
        
        if (state.initialDistance > 0 && distance > 0) {
          const scale = distance / state.initialDistance;
          const newZoom = Math.max(0.1, Math.min(10, state.initialZoom * scale));
          
          // Convert current pinch center to transform coordinates (relative to container center)
          const currentCenterTransform = screenToTransform(center.x, center.y, container);
          const initialCenterTransform = screenToTransform(state.initialCenter.x, state.initialCenter.y, container);
          
          // Calculate zoom ratio
          const zoomRatio = newZoom / state.initialZoom;
          
          // To keep the point under the current pinch center fixed:
          // The transform position of that point should scale around the current center
          // newPosition = currentCenter + (initialPosition - initialCenter) * zoomRatio
          const newX = currentCenterTransform.x + (state.initialPosition.x - initialCenterTransform.x) * zoomRatio;
          const newY = currentCenterTransform.y + (state.initialPosition.y - initialCenterTransform.y) * zoomRatio;
          
          setZoomToFit(false);
          setZoom(newZoom);
          setPosition({ x: newX, y: newY });
        }
      } else if (e.touches.length === 1 && state.touches === 1) {
        // Single-finger pan
        const center = getTouchCenter(e.touches);
        const dx = center.x - (state.lastTouchPos?.x ?? center.x);
        const dy = center.y - (state.lastTouchPos?.y ?? center.y);
        
        // Calculate velocity for momentum
        const vx = (dx / deltaTime) * 16; // Normalize to ~60fps
        const vy = (dy / deltaTime) * 16;
        
        // Check if this is a pan gesture (moved more than threshold)
        const moveDistance = Math.hypot(dx, dy);
        if (moveDistance > 5 || state.isPanning) {
          e.preventDefault();
          
          // Screen delta directly translates to transform delta (both relative to container)
          setZoomToFit(false);
          if (zoomToFitRef.current) {
            setZoom(transformRef.current.zoom);
          }
          
          setPosition((prev) => ({
            x: prev.x + dx,
            y: prev.y + dy,
          }));
          
          touchStateRef.current = {
            ...state,
            lastTouchPos: center,
            lastTouchTime: now,
            velocity: { x: vx, y: vy },
            isPanning: true,
          };
        } else {
          // Small movement, might be a tap - update position but don't prevent default yet
          touchStateRef.current = {
            ...state,
            lastTouchPos: center,
            lastTouchTime: now,
            velocity: { x: vx, y: vy },
          };
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const state = touchStateRef.current;
      if (!state) return;

      if (e.touches.length === 0) {
        // All touches ended
        if (state.touches === 1) {
          if (state.isPanning && state.velocity) {
            // Apply momentum scrolling for single-finger pan
            const momentumVelocity = {
              x: state.velocity.x * 0.5, // Reduce velocity for smoother feel
              y: state.velocity.y * 0.5,
            };
            applyMomentum(momentumVelocity);
          } else if (!state.isPanning && state.lastTouchPos) {
            // This was a tap - trigger selection
            // Use changedTouches to get the touch that ended
            if (e.changedTouches.length > 0) {
              const touch = e.changedTouches[0];
              handleSelectionAtPointRef.current(touch.clientX, touch.clientY);
            }
          }
        }
        
        touchStateRef.current = null;
      } else if (e.touches.length === 1 && state.touches === 2) {
        // Transition from two-finger to one-finger
        const center = getTouchCenter(e.touches);
        const now = Date.now();
        
        touchStateRef.current = {
          ...state,
          touches: 1,
          lastTouchPos: center,
          lastTouchTime: now,
          velocity: { x: 0, y: 0 },
          isPanning: false,
        };
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });
    
    return () => {
      cancelMomentum();
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

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

  // Ref to store latest selection handler for touch events
  const handleSelectionAtPointRef = useRef<(clientX: number, clientY: number) => void>(() => {});

  // Handle selection at screen coordinates
  const handleSelectionAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (!player || !containerRef.current) return;
      // Don't run hitbox logic when we just released from dragging the selection overlay
      if (skipNextSceneClickRef.current) {
        skipNextSceneClickRef.current = false;
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const clickY = clientY - rect.top;

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
          const clip = layer.clips[j] as ResolvedTimelineClip;
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
          else if (clip.type === 'component') nodeKey = `component-clip-${clip.id}`;

          if (!nodeKey) continue;

          try {
            const node = scene.getNode(nodeKey);
            if (!node) continue;

            // Convert click to node's local space
            const worldToLocal = node.worldToLocal();
            const localPoint = new DOMPoint(renderX, renderY).matrixTransform(worldToLocal);

            // Get node dimensions
            let nodeWidth = typeof node.width === 'function' ? node.width() ?? 0 : 0;
            let nodeHeight = typeof node.height === 'function' ? node.height() ?? 0 : 0;

            // For nodes without explicit size (e.g. component clips), use cacheBBox
            let boxOffsetX = -nodeWidth / 2;
            let boxOffsetY = -nodeHeight / 2;
            if (nodeWidth === 0 && nodeHeight === 0 && typeof node.cacheBBox === 'function') {
              try {
                const bbox = node.cacheBBox();
                if (bbox && bbox.width > 0 && bbox.height > 0) {
                  boxOffsetX = bbox.x;
                  boxOffsetY = bbox.y;
                  nodeWidth = bbox.width;
                  nodeHeight = bbox.height;
                }
              } catch {
                // cacheBBox failed, skip
              }
            }

            // Check if click is within node bounds
            if (
              localPoint.x >= boxOffsetX &&
              localPoint.x <= boxOffsetX + nodeWidth &&
              localPoint.y >= boxOffsetY &&
              localPoint.y <= boxOffsetY + nodeHeight
            ) {
              foundClipId = clip.id;
            }
          } catch {
            // Node lookup failed, skip
          }
        }
      }

      if (foundClipId) {
        setSelectedClip(foundClipId);
      } else {
        // Click on empty space - deselect
        setSelectedClip(null);
      }
    },
    [player, containerSize, transform, currentTime, layers, setSelectedClip]
  );

  // Update ref when handler changes
  useEffect(() => {
    handleSelectionAtPointRef.current = handleSelectionAtPoint;
  }, [handleSelectionAtPoint]);

  // Handle click to select clips
  const handleSceneClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't handle if shift is held (that's for panning)
      if (e.shiftKey) return;
      e.stopPropagation();
      handleSelectionAtPoint(e.clientX, e.clientY);
    },
    [handleSelectionAtPoint]
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
    const initialLayers = latestLayersRef.current;
    const initialVariables = {
      layers: initialLayers,
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
    };
    playerInstance.setVariables(initialVariables);
    (playerInstance as unknown as { requestRecalculation?: () => void }).requestRecalculation?.();

    // Wait for the scene to finish recalculating, then seek to the current
    // playhead position and render a frame so the preview isn't empty.
    const initialFrame = Math.floor(latestCurrentTimeRef.current * PREVIEW_FPS);
    const unsubRecalc = playerInstance.onRecalculated.subscribe(() => {
      unsubRecalc();
      playerInstance.requestSeek(initialFrame);
      playerInstance.requestRender();
    });
    // Also fire a seek+render immediately in case recalculation already ran
    // synchronously or completes before the next frame.
    playerInstance.requestSeek(initialFrame);
    playerInstance.requestRender();

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
      unsubRecalc();
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

  // Update variables when clips or duration change (deep compare to avoid unnecessary updates)
  // During playback, variable updates are queued and applied when play stops
  const lastVariablesRef = useRef<Record<string, unknown> | null>(null);
  const lastPlayerRef = useRef<Player | null>(null);
  const pendingVariablesRef = useRef<Record<string, unknown> | null>(null);

  const applyVariables = useCallback((vars: Record<string, unknown>) => {
    if (!player) return;
    player.setVariables(vars);
    (player as unknown as { requestRecalculation?: () => void }).requestRecalculation?.();
    player.requestRender();
    onVariablesUpdatedRef.current?.();
  }, [player]);

  useEffect(() => {
    if (!player) return;

    const variables = {
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
    };

    const isNewPlayer = lastPlayerRef.current !== player;
    lastPlayerRef.current = player;
    if (isNewPlayer) {
      lastVariablesRef.current = null;
      pendingVariablesRef.current = null;
      onUpdateQueuedRef.current?.(false);
    }

    if (lastVariablesRef.current && equal(lastVariablesRef.current, variables)) {
      return; // No change - skip update
    }

    if (isPlaying) {
      pendingVariablesRef.current = variables;
      onUpdateQueuedRef.current?.(true);
      return; // Defer until playback stops
    }

    lastVariablesRef.current = variables;
    pendingVariablesRef.current = null;
    onUpdateQueuedRef.current?.(false);
    applyVariables(variables);
  }, [player, isPlaying, layers, duration, transcriptions, transitions, captionSettings, textClipSettings, applyVariables]);

  // When playback stops, apply any queued variable update
  const prevIsPlayingRef = useRef(isPlaying);
  useEffect(() => {
    const wasPlaying = prevIsPlayingRef.current;
    prevIsPlayingRef.current = isPlaying;

    if (wasPlaying && !isPlaying && player && pendingVariablesRef.current) {
      const pending = pendingVariablesRef.current;
      pendingVariablesRef.current = null;
      lastVariablesRef.current = pending;
      onUpdateQueuedRef.current?.(false);
      applyVariables(pending);
    }
  }, [isPlaying, player, applyVariables]);

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
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col min-w-0 min-h-0">
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
            className="relative w-full h-full touch-none select-none"
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
        {isCompiling && (
          <motion.div
            className="absolute inset-0 flex items-start justify-center pt-4 pointer-events-none z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex items-center gap-2 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 px-4 py-2 shadow-lg">
              <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span className="text-xs font-medium text-white/90">Compiling scene...</span>
            </div>
          </motion.div>
        )}
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
            className={`absolute inset-0 flex items-center justify-center bg-black/50 ${
              showSlowLoadHint && onReloadPreview ? "pointer-events-auto" : "pointer-events-none"
            }`}
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="size-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              <span className="text-xs text-white/60">Loading preview...</span>
              {showSlowLoadHint && (
                onReloadPreview ? (
                  <motion.button
                    type="button"
                    onClick={onReloadPreview}
                    className="pointer-events-auto text-xs text-white/80 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/50"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4 }}
                  >
                    Preview stuck? Click here to reload.
                  </motion.button>
                ) : (
                  <motion.span
                    className="text-xs text-white/50 text-center max-w-[220px]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4 }}
                  >
                    If it takes too long, try the reload button at the top.
                  </motion.span>
                )
              )}
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
