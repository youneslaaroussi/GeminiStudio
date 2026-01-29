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
import { useAuth } from '@/app/lib/hooks/useAuth';
import { CreateBranchDialog } from './CreateBranchDialog';
import { MergeDialog } from './MergeDialog';
import { toast } from 'sonner';

interface BranchSelectorProps {
  projectId: string | null;
}

/**
 * Component to select and manage branches
 */
export function BranchSelector({ projectId }: BranchSelectorProps) {
  const { user } = useAuth();
  const { currentBranch, initializeSync } = useProjectStore();
  const { branches, switchBranch, loading, reloadBranches } = useBranches(projectId);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const handleSwitchBranch = async (branchId: string) => {
    if (!projectId || !user?.uid || branchId === currentBranch) return;
    try {
      await switchBranch(branchId);
      await initializeSync(user.uid, projectId, branchId);
      await reloadBranches();
      toast.success(`Switched to ${branchId === 'main' ? 'main' : branchId}`);
    } catch (error) {
      console.error('Failed to switch branch:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to switch branch');
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
