import { Undo2, Redo2 } from "lucide-react";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useEffect, useState } from "react";

export function HistoryControls() {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  
  // We need to subscribe to the temporal store to get canUndo/canRedo states
  // Since useProjectStore.temporal might not be available immediately during SSR or hydration, 
  // we handle it carefully.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    const temporalStore = useProjectStore.temporal;
    if (!temporalStore) return;

    const unsubscribe = temporalStore.subscribe((state) => {
      setCanUndo(state.pastStates.length > 0);
      setCanRedo(state.futureStates.length > 0);
    });

    return unsubscribe;
  }, []);

  return (
    <div className="flex items-center gap-1 border-r border-border pr-2 mr-2">
      <button
        onClick={undo}
        disabled={!canUndo}
        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors disabled:opacity-30"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 className="size-4" />
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors disabled:opacity-30"
        title="Redo (Ctrl+Y)"
      >
        <Redo2 className="size-4" />
      </button>
    </div>
  );
}
