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
import { Input } from '@/components/ui/input';
import { useBranches } from '@/app/lib/hooks/useBranches';

interface CreateBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  currentBranch: string | null;
  onSuccess?: (branchId: string) => void;
}

export function CreateBranchDialog({
  open,
  onOpenChange,
  projectId,
  currentBranch,
  onSuccess,
}: CreateBranchDialogProps) {
  const { branches, createBranch, loading } = useBranches(projectId);
  const [branchName, setBranchName] = useState('');
  const [sourceBranch, setSourceBranch] = useState(currentBranch || 'main');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!branchName.trim()) {
      setError('Branch name is required');
      return;
    }

    if (!sourceBranch) {
      setError('Source branch is required');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const branchId = await createBranch(sourceBranch, branchName.trim());
      if (branchId) {
        setBranchName('');
        onOpenChange(false);
        onSuccess?.(branchId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch');
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setBranchName('');
      setError(null);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Branch</DialogTitle>
          <DialogDescription>
            Create a new branch from an existing branch to start a new feature or experiment.
          </DialogDescription>
        </DialogHeader>

        {error && <div className="text-sm text-red-500 bg-red-50 p-2 rounded">{error}</div>}

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label htmlFor="source-branch" className="text-sm font-medium">
              Source Branch
            </label>
            <select
              id="source-branch"
              value={sourceBranch}
              onChange={(e) => setSourceBranch(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
              disabled={isCreating}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name || branch.id}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label htmlFor="branch-name" className="text-sm font-medium">
              New Branch Name
            </label>
            <Input
              id="branch-name"
              placeholder="e.g., feature/new-effect"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              disabled={isCreating}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isCreating) {
                  handleCreate();
                }
              }}
            />
            <p className="text-xs text-gray-500">
              Use descriptive names like feature/*, bugfix/*, etc.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || loading || !branchName.trim()}>
            {isCreating ? 'Creating...' : 'Create Branch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
