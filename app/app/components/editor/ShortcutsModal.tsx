"use client";

import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAnalytics } from "@/app/lib/hooks/useAnalytics";

const SHORTCUTS: { section: string; items: { action: string; keys: string }[] }[] = [
  {
    section: "General",
    items: [
      { action: "Open command menu", keys: "Ctrl+K / ⌘K" },
      { action: "Show keyboard shortcuts", keys: "Ctrl+/ / ⌘/" },
    ],
  },
  {
    section: "Project",
    items: [
      { action: "Load project", keys: "Ctrl+O / ⌘O" },
      { action: "Save project", keys: "Ctrl+S / ⌘S" },
      { action: "Export project", keys: "Ctrl+E / ⌘E" },
      { action: "Refresh project", keys: "Alt+Shift+R / ⌥⇧R" },
      { action: "Open render modal", keys: "Ctrl+Shift+R / ⌘⇧R" },
    ],
  },
  {
    section: "Edit",
    items: [
      { action: "Undo", keys: "Ctrl+Z / ⌘Z" },
      { action: "Redo", keys: "Ctrl+Y or Ctrl+Shift+Z / ⌘Y or ⌘⇧Z" },
      { action: "Deselect clip", keys: "Escape" },
    ],
  },
  {
    section: "Timeline",
    items: [
      { action: "Split clip at playhead", keys: "C" },
      { action: "Selection tool", keys: "V" },
      { action: "Hand tool (drag to pan)", keys: "H" },
      { action: "Open / close voice chat", keys: "M" },
    ],
  },
  {
    section: "Playback",
    items: [
      { action: "Play / Pause", keys: "Space" },
    ],
  },
  {
    section: "Preview",
    items: [
      { action: "Recenter preview", keys: "0" },
      { action: "Fullscreen preview", keys: "F" },
      { action: "Exit fullscreen", keys: "Escape" },
    ],
  },
  {
    section: "Asset tabs",
    items: [
      { action: "Assets", keys: "1" },
      { action: "Templates", keys: "2" },
      { action: "Video", keys: "3" },
      { action: "Image", keys: "4" },
      { action: "Music", keys: "5" },
      { action: "Speech", keys: "6" },
      { action: "Components", keys: "7" },
      { action: "Jobs", keys: "8" },
      { action: "Branches", keys: "9" },
    ],
  },
];

interface ShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsModal({ open, onOpenChange }: ShortcutsModalProps) {
  const { events: analytics } = useAnalytics();

  useEffect(() => {
    if (open) analytics.shortcutsOpened();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only track when open becomes true
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={true}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Quick reference for all available keyboard shortcuts.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            {SHORTCUTS.map(({ section, items }) => (
              <div key={section}>
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  {section}
                </h3>
                <div className="space-y-2">
                  {items.map(({ action, keys }) => (
                    <div
                      key={action}
                      className="flex items-center justify-between gap-4 py-1.5"
                    >
                      <span className="text-sm text-muted-foreground">
                        {action}
                      </span>
                      <kbd 
                        className="shrink-0 rounded-md border border-border/50 bg-muted/80 px-2.5 py-1 text-xs tracking-wide shadow-sm"
                        style={{ fontFamily: "var(--font-keyboard)" }}
                      >
                        {keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
