"use client";

import { useCallback, useMemo } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Save,
  FolderOpen,
  Download,
  RefreshCw,
  Film,
  Undo2,
  Redo2,
  Trash2,
  MousePointerClick,
  Play,
  Pause,
  VolumeX,
  Volume2,
  Repeat,
  SkipBack,
  SkipForward,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Keyboard,
  Wrench,
  MessageSquare,
  Mic,
  Focus,
  Scissors,
  Clock,
  Layers,
  GraduationCap,
} from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";

interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  onLoad: () => void;
  onExport: () => void;
  onRefresh: () => void;
  onRender: () => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onToggleLoop: () => void;
  onRecenter: () => void;
  onEnterFullscreen: () => void;
  onExitFullscreen: () => void;
  onShowShortcuts: () => void;
  onOpenToolbox: () => void;
  onOpenChat: () => void;
  onToggleVoice: () => void;
  onStartTutorial?: () => void;
  isPlaying: boolean;
  isMuted: boolean;
  isLooping: boolean;
  isFullscreen: boolean;
}

export function CommandMenu({
  open,
  onOpenChange,
  onSave,
  onLoad,
  onExport,
  onRefresh,
  onRender,
  onTogglePlay,
  onToggleMute,
  onToggleLoop,
  onRecenter,
  onEnterFullscreen,
  onExitFullscreen,
  onShowShortcuts,
  onOpenToolbox,
  onOpenChat,
  onToggleVoice,
  onStartTutorial,
  isPlaying,
  isMuted,
  isLooping,
  isFullscreen,
}: CommandMenuProps) {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const selectedClipId = useProjectStore((s) => s.selectedClipId);
  const setSelectedClip = useProjectStore((s) => s.setSelectedClip);
  const deleteClip = useProjectStore((s) => s.deleteClip);
  const currentTime = useProjectStore((s) => s.currentTime);
  const setCurrentTime = useProjectStore((s) => s.setCurrentTime);
  const getDuration = useProjectStore((s) => s.getDuration);
  const splitClipAtTime = useProjectStore((s) => s.splitClipAtTime);
  const zoom = useProjectStore((s) => s.zoom);
  const setZoom = useProjectStore((s) => s.setZoom);

  const runCommand = useCallback(
    (command: () => void) => {
      onOpenChange(false);
      // Small delay to allow dialog to close before executing
      requestAnimationFrame(command);
    },
    [onOpenChange]
  );

  const isMac = useMemo(() => {
    if (typeof window === "undefined") return false;
    return navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  }, []);

  const mod = isMac ? "⌘" : "Ctrl";

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} showCloseButton={false}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Project Commands */}
        <CommandGroup heading="Project">
          <CommandItem onSelect={() => runCommand(onSave)}>
            <Save />
            <span>Save project</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              {mod}S
            </CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(onLoad)}>
            <FolderOpen />
            <span>Open project</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              {mod}O
            </CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(onExport)}>
            <Download />
            <span>Export project</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              {mod}E
            </CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(onRefresh)}>
            <RefreshCw />
            <span>Refresh from cloud</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              {isMac ? "⌥⇧R" : "Alt+Shift+R"}
            </CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(onRender)}>
            <Film />
            <span>Render video</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              {mod}⇧R
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Edit Commands */}
        <CommandGroup heading="Edit">
          <CommandItem onSelect={() => runCommand(undo)}>
            <Undo2 />
            <span>Undo</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              {mod}Z
            </CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(redo)}>
            <Redo2 />
            <span>Redo</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              {mod}⇧Z
            </CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(() => {
                if (selectedClipId) {
                  deleteClip(selectedClipId);
                }
              })
            }
            disabled={!selectedClipId}
          >
            <Trash2 />
            <span>Delete selected clip</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              Del
            </CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setSelectedClip(null))}>
            <MousePointerClick />
            <span>Deselect clip</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              Esc
            </CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(() => {
                if (selectedClipId) {
                  splitClipAtTime(selectedClipId, currentTime);
                }
              })
            }
            disabled={!selectedClipId}
          >
            <Scissors />
            <span>Split clip at playhead</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Playback Commands */}
        <CommandGroup heading="Playback">
          <CommandItem onSelect={() => runCommand(onTogglePlay)}>
            {isPlaying ? <Pause /> : <Play />}
            <span>{isPlaying ? "Pause" : "Play"}</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              Space
            </CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(onToggleMute)}>
            {isMuted ? <VolumeX /> : <Volume2 />}
            <span>{isMuted ? "Unmute" : "Mute"}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(onToggleLoop)}>
            <Repeat className={isLooping ? "text-primary" : ""} />
            <span>{isLooping ? "Disable loop" : "Enable loop"}</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setCurrentTime(0))}>
            <SkipBack />
            <span>Go to start</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setCurrentTime(getDuration()))}>
            <SkipForward />
            <span>Go to end</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Preview Commands */}
        <CommandGroup heading="Preview">
          <CommandItem onSelect={() => runCommand(onRecenter)}>
            <Focus />
            <span>Recenter preview</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              0
            </CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(isFullscreen ? onExitFullscreen : onEnterFullscreen)
            }
          >
            {isFullscreen ? <Minimize2 /> : <Maximize2 />}
            <span>{isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              F
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Timeline Commands */}
        <CommandGroup heading="Timeline">
          <CommandItem
            onSelect={() =>
              runCommand(() => setZoom(Math.min(zoom * 1.25, 200)))
            }
          >
            <ZoomIn />
            <span>Zoom in timeline</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(() => setZoom(Math.max(zoom / 1.25, 10)))
            }
          >
            <ZoomOut />
            <span>Zoom out timeline</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setZoom(50))}>
            <Clock />
            <span>Reset timeline zoom</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(() => {
                // Calculate zoom to fit duration in view (approximate)
                const duration = getDuration();
                if (duration > 0) {
                  // Assume ~1000px timeline width, clamp to valid range
                  const fitZoom = Math.max(10, Math.min(200, 1000 / duration));
                  setZoom(fitZoom);
                }
              })
            }
          >
            <Layers />
            <span>Fit timeline to view</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* View Commands */}
        <CommandGroup heading="View">
          <CommandItem onSelect={() => runCommand(onShowShortcuts)}>
            <Keyboard />
            <span>Show keyboard shortcuts</span>
            <CommandShortcut style={{ fontFamily: "var(--font-keyboard)" }}>
              {mod}/
            </CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(onOpenToolbox)}>
            <Wrench />
            <span>Open toolbox panel</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(onOpenChat)}>
            <MessageSquare />
            <span>Open chat panel</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(onToggleVoice)}>
            <Mic />
            <span>Toggle voice assistant</span>
          </CommandItem>
          {onStartTutorial && (
            <CommandItem onSelect={() => runCommand(onStartTutorial)}>
              <GraduationCap />
              <span>Start tutorial</span>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
