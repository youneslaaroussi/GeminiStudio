'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useBranches } from '@/app/lib/hooks/useBranches';
import type { BranchMetadata } from '@/app/lib/automerge/types';
import { cn } from '@/lib/utils';
import { CheckCircle2, Info } from 'lucide-react';

interface MergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  branches: Array<BranchMetadata & { id: string }>;
  currentBranch: string | null;
}

export function MergeDialog({
  open,
  onOpenChange,
  projectId,
  branches,
  currentBranch,
}: MergeDialogProps) {
  const { mergeBranch, loading } = useBranches(projectId);
  const [sourceBranch, setSourceBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState(currentBranch || 'main');
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleMerge = async () => {
    if (!sourceBranch || !targetBranch) {
      setError('Please select both source and target branches');
      return;
    }

    if (sourceBranch === targetBranch) {
      setError('Source and target branches cannot be the same');
      return;
    }

    setIsMerging(true);
    setError(null);
    setSuccess(false);

    try {
      await mergeBranch(sourceBranch, targetBranch);
      setSuccess(true);
      setSourceBranch('');
      setTimeout(() => {
        onOpenChange(false);
        setSuccess(false);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge branches');
    } finally {
      setIsMerging(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSourceBranch('');
      setError(null);
      setSuccess(false);
    }
    onOpenChange(newOpen);
  };

  const availableSourceBranches = branches.filter((b) => b.id !== targetBranch);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Merge Branches</DialogTitle>
          <DialogDescription>
            Merge changes from one branch into another. Automerge resolves conflicts automatically.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 className="size-4 shrink-0" />
            Branches merged successfully
          </div>
        )}

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <label htmlFor="source-branch" className="text-sm font-medium text-foreground">
              Source (merge from)
            </label>
            <select
              id="source-branch"
              value={sourceBranch}
              onChange={(e) => setSourceBranch(e.target.value)}
              className={cn(
                "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              disabled={isMerging}
            >
              <option value="">Select branch</option>
              {availableSourceBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name || branch.id}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label htmlFor="target-branch" className="text-sm font-medium text-foreground">
              Target (merge into)
            </label>
            <select
              id="target-branch"
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              className={cn(
                "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
              disabled={isMerging}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name || branch.id}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 rounded-lg border border-slate-700 bg-slate-800/90 p-3">
            <Info className="size-4 shrink-0 text-slate-400 mt-0.5" />
            <div className="space-y-1.5 text-sm text-slate-300">
              <p className="font-medium text-slate-200">How it works</p>
              <ul className="list-none space-y-1 text-xs text-slate-400">
                <li>• Changes from the source branch are merged into the target.</li>
                <li>• Non-conflicting edits are combined automatically.</li>
                <li>• After merging, switch to the target branch to see the result.</li>
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isMerging}>
            Cancel
          </Button>
          <Button
            onClick={handleMerge}
            disabled={isMerging || loading || !sourceBranch || !targetBranch || sourceBranch === targetBranch}
          >
            {isMerging ? 'Merging…' : 'Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
