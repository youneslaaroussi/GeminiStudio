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
import { TopBar } from "./TopBar";
import { ChatPanel } from "./ChatPanel";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useShortcuts } from "@/app/hooks/use-shortcuts";

export function EditorLayout() {
  const [player, setPlayer] = useState<Player | null>(null);

  // Connect to Zustand store
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const setIsPlaying = useProjectStore((s) => s.setIsPlaying);
  const project = useProjectStore((s) => s.project);
  const layers = project.layers;
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
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
      <TopBar />
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={78} minSize={60} className="min-w-0">
            <ResizablePanelGroup direction="vertical" className="h-full">
              {/* Top Area: Assets | Preview | Settings */}
              <ResizablePanel defaultSize={60} minSize={30}>
                <ResizablePanelGroup direction="horizontal" className="h-full">
                  {/* Left: Assets */}
                  <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
                    <div className="h-full bg-card border-r border-border min-w-0">
                      <AssetsPanel />
                    </div>
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  {/* Center: Preview */}
                  <ResizablePanel defaultSize={60} minSize={30} className="min-w-0">
                    <div className="h-full bg-card min-w-0">
                      <PreviewPanel
                        onPlayerChange={setPlayer}
                        layers={layers}
                        duration={getDuration()}
                        currentTime={currentTime}
                        onTimeUpdate={handleTimeUpdate}
                        sceneConfig={{
                          resolution: project.resolution,
                          renderScale: project.renderScale,
                          background: project.background,
                        }}
                      />
                    </div>
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  {/* Settings */}
                  <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
                    <div className="h-full bg-card border-l border-border min-w-[260px]">
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
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Persistent Rightmost Chat */}
          <ResizablePanel defaultSize={22} minSize={15} maxSize={40}>
            <div className="h-full bg-card border-l border-border min-w-[260px]">
              <ChatPanel />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
