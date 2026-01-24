'use client';

import { Player, Stage, Vector2, type Project } from '@motion-canvas/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoClip, AudioClip } from '@/app/types/timeline';

const SCENE_URL = '/scene/src/project.js';
const PREVIEW_FPS = 30;
const DEFAULT_SIZE = new Vector2(1920, 1080);

interface ScenePlayerProps {
  onPlayerChange?: (player: Player | null) => void;
  videoClips?: VideoClip[];
  audioClips?: AudioClip[];
  duration?: number;
  currentTime?: number;
  onTimeUpdate?: (time: number) => void;
}

export function ScenePlayer({
  onPlayerChange,
  videoClips = [],
  audioClips = [],
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
      try {
        await stageInstance.render(
          playerInstance.playback.currentScene as any,
          playerInstance.playback.previousScene as any
        );
      } catch (err) {
        console.error('Render error:', err);
      }
    });

    stageInstance.configure({
      size: initialSize,
      resolutionScale: 1,
      background: null,
    });

    // Set initial variables
    playerInstance.setVariables({
      videoClips,
      audioClips,
      duration,
    });

    containerRef.current.append(stageInstance.finalBuffer);
    stageInstance.finalBuffer.style.width = '100%';
    stageInstance.finalBuffer.style.height = 'auto';
    stageInstance.finalBuffer.style.maxHeight = '100%';
    stageInstance.finalBuffer.style.display = 'block';
    stageInstance.finalBuffer.style.objectFit = 'contain';

    setStage(stageInstance);
    setPlayer(playerInstance);
    onPlayerChange?.(playerInstance);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      stageInstance.finalBuffer.remove();
      setStage(null);
      setPlayer(null);
      onPlayerChange?.(null);
    };
  }, [project, onPlayerChange]);

  // Update variables when clips or duration change
  useEffect(() => {
    if (!player) return;

    player.setVariables({
      videoClips,
      audioClips,
      duration,
    });
    (player as unknown as { requestRecalculation?: () => void }).requestRecalculation?.();
    player.requestRender();
  }, [player, videoClips, audioClips, duration]);

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
        className="flex flex-1 items-center justify-center overflow-hidden bg-black"
      />
      {!project && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading scene…</p>
        </div>
      )}
    </div>
  );
}
