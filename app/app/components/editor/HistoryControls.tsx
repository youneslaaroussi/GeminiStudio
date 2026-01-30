import { Undo2, Redo2 } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

export function HistoryControls() {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const syncManager = useProjectStore((s) => s.syncManager);

  const canUndo = syncManager?.canUndo() ?? false;
  const canRedo = syncManager?.canRedo() ?? false;

  const handleUndo = async () => {
    await undo();
  };

  const handleRedo = async () => {
    await redo();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1 border-r border-border pr-2 mr-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors disabled:opacity-30"
            >
              <Undo2 className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Undo (Ctrl+Z / ⌘Z)</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors disabled:opacity-30"
            >
              <Redo2 className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>Redo (Ctrl+Y / ⌘Y)</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
