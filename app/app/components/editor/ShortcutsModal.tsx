"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const SHORTCUTS: { section: string; items: { action: string; keys: string }[] }[] = [
  {
    section: "General",
    items: [
      { action: "Show this shortcuts modal", keys: "Ctrl+/ / ⌘/" },
    ],
  },
  {
    section: "Project",
    items: [
      { action: "Load project", keys: "Ctrl+O / ⌘O" },
      { action: "Save project", keys: "Ctrl+S / ⌘S" },
      { action: "Export project", keys: "Ctrl+E / ⌘E" },
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
];

interface ShortcutsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsModal({ open, onOpenChange }: ShortcutsModalProps) {
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
                      <kbd className="shrink-0 rounded border border-border bg-muted px-2 py-0.5 text-xs font-mono tabular-nums">
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
