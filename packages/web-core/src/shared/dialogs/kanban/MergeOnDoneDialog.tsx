import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { Button } from '@vibe/ui/components/Button';
import { create, useModal } from '@ebay/nice-modal-react';
import { AlertTriangle, GitMerge } from 'lucide-react';
import { defineModal } from '@/shared/lib/modals';
import { useState } from 'react';

export type MergeOnDoneResult = 'merge' | 'skip' | 'cancel';

export interface MergeOnDoneDialogProps {
  workspaceName: string;
  repos: { repoId: string; repoName: string; targetBranch: string }[];
  /** Number of sub-tasks still in progress (not done/cancelled). */
  activeSubTaskCount?: number;
}

const MergeOnDoneDialogImpl = create<MergeOnDoneDialogProps>((props) => {
  const modal = useModal();
  const { workspaceName, repos, activeSubTaskCount = 0 } = props;
  const [selectedRepoIdx, setSelectedRepoIdx] = useState(0);

  const selectedRepo = repos[selectedRepoIdx];

  return (
    <Dialog open={modal.visible} onOpenChange={() => { modal.resolve('cancel' as MergeOnDoneResult); modal.hide(); }}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <GitMerge className="h-6 w-6 text-brand" />
            <DialogTitle>Unmerged Branch</DialogTitle>
          </div>
          <DialogDescription className="text-left pt-2">
            The workspace "{workspaceName}" has unmerged changes. Would you like
            to merge before marking as done?
          </DialogDescription>
        </DialogHeader>

        {activeSubTaskCount > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
            <span>
              This task has {activeSubTaskCount} active sub-task{activeSubTaskCount > 1 ? 's' : ''}.
              Merging now may cause conflicts with in-progress work.
            </span>
          </div>
        )}

        {repos.length > 1 && (
          <div className="px-1">
            <label className="block text-xs text-low mb-half">
              Repository
            </label>
            <select
              value={selectedRepoIdx}
              onChange={(e) => setSelectedRepoIdx(Number(e.target.value))}
              className="w-full px-base py-half bg-surface border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-brand"
            >
              {repos.map((r, i) => (
                <option key={r.repoId} value={i}>
                  {r.repoName} → {r.targetBranch}
                </option>
              ))}
            </select>
          </div>
        )}

        {repos.length === 1 && selectedRepo && (
          <div className="px-1 text-sm text-low">
            Merge into <span className="font-mono text-high">{selectedRepo.targetBranch}</span> ({selectedRepo.repoName})
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => { modal.resolve('cancel' as MergeOnDoneResult); modal.hide(); }}
          >
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => { modal.resolve('skip' as MergeOnDoneResult); modal.hide(); }}
            >
              No Thanks
            </Button>
            <Button
              onClick={() => { modal.resolve('merge' as MergeOnDoneResult); modal.hide(); }}
            >
              Merge
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export const MergeOnDoneDialog = defineModal<
  MergeOnDoneDialogProps,
  MergeOnDoneResult
>(MergeOnDoneDialogImpl);
