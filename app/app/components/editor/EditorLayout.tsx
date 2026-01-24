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
import { SettingsPanel } from "./SettingsPanel";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useShortcuts } from "@/app/hooks/use-shortcuts";

export function EditorLayout() {
  const [player, setPlayer] = useState<Player | null>(null);

  // Connect to Zustand store
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const setIsPlaying = useProjectStore((s) => s.setIsPlaying);
  const layers = useProjectStore((s) => s.project.layers);
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

  useShortcuts([
    {
      key: " ",
      handler: togglePlay,
      preventDefault: true,
    },
  ]);

  return (
    <div className="h-screen w-full overflow-hidden bg-background">
      <ResizablePanelGroup direction="vertical" className="h-full">
        {/* Top Area: Assets | Preview | Settings */}
        <ResizablePanel defaultSize={60} minSize={30}>
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Left: Assets */}
            <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
              <div className="h-full bg-card border-r border-border">
                <AssetsPanel />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Center: Preview */}
            <ResizablePanel defaultSize={60} minSize={30}>
              <div className="h-full bg-card">
                <PreviewPanel
                  onPlayerChange={setPlayer}
                  layers={layers}
                  duration={getDuration()}
                  currentTime={currentTime}
                  onTimeUpdate={handleTimeUpdate}
                />
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right: Settings */}
            <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
              <div className="h-full bg-card border-l border-border">
                <SettingsPanel />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Bottom: Timeline */}
        <ResizablePanel defaultSize={40} minSize={20}>
          <div className="h-full bg-card border-t border-border">
            <TimelinePanel
              hasPlayer={!!player}
              playing={isPlaying}
              onTogglePlay={togglePlay}
            />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
