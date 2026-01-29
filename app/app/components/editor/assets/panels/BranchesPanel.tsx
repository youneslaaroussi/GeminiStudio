"use client";

import { useState } from "react";
import { GitBranch, Plus, Merge, Loader2, Check, Trash2 } from "lucide-react";
import { useBranches } from "@/app/lib/hooks/useBranches";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { CreateBranchDialog } from "@/app/components/editor/CreateBranchDialog";
import { MergeDialog } from "@/app/components/editor/MergeDialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const BRANCH_ID_MAIN = "main";

interface BranchesPanelProps {
  projectId: string | null;
}

export function BranchesPanel({ projectId }: BranchesPanelProps) {
  const { user } = useAuth();
  const { currentBranch } = useProjectStore();
  const initializeSync = useProjectStore((s) => s.initializeSync);
  const { branches, loading, switchBranch, deleteBranch, reloadBranches } = useBranches(projectId);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleSwitchBranch = async (branchId: string) => {
    if (!projectId || !user?.uid || branchId === currentBranch) return;
    setSwitchingId(branchId);
    try {
      await switchBranch(branchId);
      await initializeSync(user.uid, projectId, branchId);
      await reloadBranches();
      toast.success(`Switched to ${branchId === BRANCH_ID_MAIN ? "main" : branchId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to switch branch");
    } finally {
      setSwitchingId(null);
    }
  };

  const handleDeleteBranch = async (e: React.MouseEvent, branchId: string) => {
    e.stopPropagation();
    if (branchId === BRANCH_ID_MAIN || !projectId || !user?.uid) return;
    setDeletingId(branchId);
    try {
      await deleteBranch(branchId);
      await reloadBranches();
      const wasCurrent = currentBranch === branchId;
      if (wasCurrent) {
        await switchBranch(BRANCH_ID_MAIN);
        await initializeSync(user.uid, projectId, BRANCH_ID_MAIN);
        toast.success("Branch deleted. Switched to main.");
      } else {
        toast.success("Branch deleted.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete branch");
    } finally {
      setDeletingId(null);
    }
  };

  const mainBranch = branches.find((b) => b.id === BRANCH_ID_MAIN);
  const featureBranches = branches.filter((b) => b.id !== BRANCH_ID_MAIN);
  const activeId = currentBranch || BRANCH_ID_MAIN;

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Branches</span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="size-3.5" />
              New
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setShowMergeDialog(true)}
            >
              <Merge className="size-3.5" />
              Merge
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading branches…
              </div>
            ) : (
              <>
                {mainBranch && (
                  <button
                    type="button"
                    onClick={() => handleSwitchBranch(BRANCH_ID_MAIN)}
                    disabled={switchingId !== null}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      activeId === BRANCH_ID_MAIN
                        ? "bg-primary/15 text-primary"
                        : "hover:bg-muted/50 text-foreground"
                    )}
                  >
                    <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate font-medium">main</span>
                    {activeId === BRANCH_ID_MAIN && (
                      <Check className="size-4 shrink-0 text-primary" />
                    )}
                    {switchingId === BRANCH_ID_MAIN && (
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                    )}
                  </button>
                )}
                {featureBranches.length > 0 && (
                  <>
                    <div className="my-2 border-t border-border pt-2">
                      <span className="px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Feature branches
                      </span>
                    </div>
                    {featureBranches.map((branch) => (
                      <div
                        key={branch.id}
                        className={cn(
                          "group flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                          activeId === branch.id
                            ? "bg-primary/15 text-primary"
                            : "hover:bg-muted/50 text-foreground"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => handleSwitchBranch(branch.id)}
                          disabled={switchingId !== null}
                          className="flex min-w-0 flex-1 items-center gap-2"
                        >
                          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">
                            {branch.name || branch.id}
                          </span>
                          {activeId === branch.id && (
                            <Check className="size-4 shrink-0 text-primary" />
                          )}
                          {switchingId === branch.id && (
                            <Loader2 className="size-4 shrink-0 animate-spin" />
                          )}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive"
                          onClick={(e) => handleDeleteBranch(e, branch.id)}
                          disabled={deletingId !== null}
                          title="Delete branch"
                        >
                          {deletingId === branch.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </>
                )}
                {!loading && branches.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No branches yet. Create one from the button above.
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      <CreateBranchDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        projectId={projectId}
        currentBranch={currentBranch}
        onSuccess={async () => {
          setShowCreateDialog(false);
          await reloadBranches();
        }}
      />

      <MergeDialog
        open={showMergeDialog}
        onOpenChange={setShowMergeDialog}
        projectId={projectId}
        branches={branches}
        currentBranch={currentBranch}
      />
    </>
  );
}
