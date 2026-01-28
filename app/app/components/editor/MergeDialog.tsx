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
            Merge changes from one branch into another using Automerge conflict resolution.
          </DialogDescription>
        </DialogHeader>

        {error && <div className="text-sm text-red-500 bg-red-50 p-2 rounded">{error}</div>}

        {success && (
          <div className="text-sm text-green-600 bg-green-50 p-2 rounded">
            ✓ Branches merged successfully
          </div>
        )}

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label htmlFor="source-branch" className="text-sm font-medium">
              Source Branch (merge from)
            </label>
            <select
              id="source-branch"
              value={sourceBranch}
              onChange={(e) => setSourceBranch(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              disabled={isMerging}
            >
              <option value="">Select branch to merge from</option>
              {availableSourceBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name || branch.id}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label htmlFor="target-branch" className="text-sm font-medium">
              Target Branch (merge into)
            </label>
            <select
              id="target-branch"
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              disabled={isMerging}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name || branch.id}
                </option>
              ))}
            </select>
          </div>

          <div className="text-sm text-gray-600 bg-blue-50 p-2 rounded">
            <p className="font-medium">How merge works:</p>
            <ul className="mt-1 space-y-1 text-xs">
              <li>• Changes from source branch are merged into target branch</li>
              <li>• Automerge automatically resolves non-conflicting changes</li>
              <li>• You'll switch to the target branch after merge</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isMerging}>
            Cancel
          </Button>
          <Button
            onClick={handleMerge}
            disabled={isMerging || loading || !sourceBranch || !targetBranch || sourceBranch === targetBranch}
            variant="default"
          >
            {isMerging ? 'Merging...' : 'Merge Branches'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
