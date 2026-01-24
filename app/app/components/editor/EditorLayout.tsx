"use client";

import type { Player } from "@motion-canvas/core";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useCallback, useState } from "react";
import { AssetsPanel } from "./AssetsPanel";
import { PreviewPanel } from "./PreviewPanel";
import { TimelinePanel } from "./TimelinePanel";
import { useProjectStore } from "@/app/lib/store/project-store";

export function EditorLayout() {
  const [player, setPlayer] = useState<Player | null>(null);

  // Connect to Zustand store
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const setIsPlaying = useProjectStore((s) => s.setIsPlaying);
  const videoClips = useProjectStore((s) => s.project.videoClips);
  const audioClips = useProjectStore((s) => s.project.audioClips);
  const currentTime = useProjectStore((s) => s.currentTime);
  const setCurrentTime = useProjectStore((s) => s.setCurrentTime);
  const getDuration = useProjectStore((s) => s.getDuration);

  const togglePlay = useCallback(() => {
    if (!player) return;
    player.togglePlayback();
    setIsPlaying(!isPlaying);
  }, [player, isPlaying, setIsPlaying]);

  const handleTimeUpdate = useCallback(
    (time: number) => {
      setCurrentTime(time);
    },
    [setCurrentTime]
  );

  return (
    <div className="h-screen w-full overflow-hidden bg-background">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        {/* Left: Assets */}
        <ResizablePanel defaultSize={18} minSize={12} maxSize={30}>
          <div className="h-full bg-card">
            <AssetsPanel />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: Preview (top) + Timeline (bottom) */}
        <ResizablePanel defaultSize={82} minSize={50}>
          <ResizablePanelGroup direction="vertical" className="h-full">
            <ResizablePanel defaultSize={70} minSize={30}>
              <div className="h-full bg-card">
                <PreviewPanel
                  onPlayerChange={setPlayer}
                  videoClips={videoClips}
                  audioClips={audioClips}
                  duration={getDuration()}
                  currentTime={currentTime}
                  onTimeUpdate={handleTimeUpdate}
                />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={30} minSize={15} maxSize={50}>
              <div className="h-full bg-card">
                <TimelinePanel
                  hasPlayer={!!player}
                  playing={isPlaying}
                  onTogglePlay={togglePlay}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
