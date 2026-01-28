'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { GitBranch, Plus, Merge } from 'lucide-react';
import { useBranches } from '@/app/lib/hooks/useBranches';
import { useProjectStore } from '@/app/lib/store/project-store';
import { CreateBranchDialog } from './CreateBranchDialog';
import { MergeDialog } from './MergeDialog';

interface BranchSelectorProps {
  projectId: string | null;
}

/**
 * Component to select and manage branches
 */
export function BranchSelector({ projectId }: BranchSelectorProps) {
  const { currentBranch } = useProjectStore();
  const { branches, createBranch, switchBranch, loading } = useBranches(projectId);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const handleSwitchBranch = async (branchId: string) => {
    try {
      await switchBranch(branchId);
      // Update store with new branch
      if (projectId && branchId) {
        const { initializeSync } = useProjectStore.getState();
        // Need to re-initialize sync manager for new branch
        // This is a simplified version - in reality you'd need to update the store
      }
    } catch (error) {
      console.error('Failed to switch branch:', error);
    }
  };

  if (loading) {
    return (
      <Button disabled variant="outline" size="sm">
        <GitBranch className="mr-2 h-4 w-4" />
        Loading...
      </Button>
    );
  }

  const mainBranch = branches.find((b) => b.id === 'main');
  const featureBranches = branches.filter((b) => b.id !== 'main');

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <GitBranch className="mr-2 h-4 w-4" />
            {currentBranch || 'main'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Branches</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {/* Main branch */}
          {mainBranch && (
            <DropdownMenuItem
              onClick={() => handleSwitchBranch('main')}
              className={currentBranch === 'main' ? 'bg-accent' : ''}
            >
              <span className="flex-1">main</span>
              {currentBranch === 'main' && <span className="ml-2 text-xs">✓</span>}
            </DropdownMenuItem>
          )}

          {/* Feature branches */}
          {featureBranches.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {featureBranches.map((branch) => (
                <DropdownMenuItem
                  key={branch.id}
                  onClick={() => handleSwitchBranch(branch.id)}
                  className={currentBranch === branch.id ? 'bg-accent' : ''}
                >
                  <span className="flex-1 truncate">{branch.name}</span>
                  {currentBranch === branch.id && <span className="ml-2 text-xs">✓</span>}
                </DropdownMenuItem>
              ))}
            </>
          )}

          <DropdownMenuSeparator />

          {/* Actions */}
          <DropdownMenuItem onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Branch
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowMergeDialog(true)}>
            <Merge className="mr-2 h-4 w-4" />
            Merge Branch
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs */}
      <CreateBranchDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        projectId={projectId}
        currentBranch={currentBranch}
        onSuccess={async (branchId) => {
          setShowCreateDialog(false);
          // Optionally switch to new branch
          // await switchBranch(branchId);
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
