import { Undo2, Redo2 } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useEffect, useState } from "react";

export function HistoryControls() {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const syncManager = useProjectStore((s) => s.syncManager);
  const project = useProjectStore((s) => s.project);

  const canUndo = syncManager?.canUndo() ?? false;
  const canRedo = syncManager?.canRedo() ?? false;

  const handleUndo = async () => {
    await undo();
  };

  const handleRedo = async () => {
    await redo();
  };

  return (
    <div className="flex items-center gap-1 border-r border-border pr-2 mr-2">
      <button
        onClick={handleUndo}
        disabled={!canUndo}
        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors disabled:opacity-30"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 className="size-4" />
      </button>
      <button
        onClick={handleRedo}
        disabled={!canRedo}
        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors disabled:opacity-30"
        title="Redo (Ctrl+Y)"
      >
        <Redo2 className="size-4" />
      </button>
    </div>
  );
}
