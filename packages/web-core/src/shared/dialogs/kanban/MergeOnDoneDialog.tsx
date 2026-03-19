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
import { AlertTriangle, GitMerge, CheckCircle } from 'lucide-react';
import { defineModal } from '@/shared/lib/modals';
import { useState } from 'react';

export type MergeOnDoneResult = 'merge' | 'merge_all' | 'skip' | 'cancel';

export interface SubTaskStatusBreakdown {
  /** Sub-tasks in ready/todo status */
  notStarted: number;
  /** Sub-tasks in in_progress status */
  inProgress: number;
  /** Sub-tasks in in_review status */
  inReview: number;
  /** Sub-tasks in done status */
  done: number;
  /** Whether the workspace is currently running an execution */
  workspaceRunning: boolean;
}

export interface MergeOnDoneDialogProps {
  workspaceName: string;
  repos: { repoId: string; repoName: string; targetBranch: string }[];
  /** Detailed breakdown of sub-task statuses for the parent task. */
  subTaskStatus?: SubTaskStatusBreakdown;
  /** When set, this is a sub-task being moved to done — show "Merge All" variant. */
  subTaskContext?: {
    parentTitle: string;
    siblingCount: number;
  };
}

function SubTaskWarning({ status }: { status: SubTaskStatusBreakdown }) {
  const totalActive = status.notStarted + status.inProgress + status.inReview;
  const allReviewOrDone = status.notStarted === 0 && status.inProgress === 0;

  if (status.workspaceRunning) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-200">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
        <span>
          The workspace is currently running. Merging now may interrupt active work
          or produce incomplete results.
        </span>
      </div>
    );
  }

  if (status.inProgress > 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
        <span>
          {status.inProgress} sub-task{status.inProgress > 1 ? 's are' : ' is'} still in progress.
          Merging now may include incomplete work.
        </span>
      </div>
    );
  }

  if (status.notStarted > 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
        <span>
          {status.notStarted} sub-task{status.notStarted > 1 ? 's have' : ' has'} not been started yet.
          Merging will mark {status.notStarted > 1 ? 'them' : 'it'} as done.
        </span>
      </div>
    );
  }

  if (allReviewOrDone && totalActive === 0 && status.done > 0) {
    // All sub-tasks are done
    return null;
  }

  if (allReviewOrDone && status.inReview > 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-sm text-blue-200">
        <CheckCircle className="h-4 w-4 mt-0.5 shrink-0 text-brand" />
        <span>
          All {status.inReview + status.done} sub-task{status.inReview + status.done > 1 ? 's' : ''} {status.inReview > 0 ? 'are in review or done' : 'are done'}.
          Merging will finalize the branch and mark everything as done.
        </span>
      </div>
    );
  }

  return null;
}

const MergeOnDoneDialogImpl = create<MergeOnDoneDialogProps>((props) => {
  const modal = useModal();
  const { workspaceName, repos, subTaskStatus, subTaskContext } = props;
  const [selectedRepoIdx, setSelectedRepoIdx] = useState(0);

  const selectedRepo = repos[selectedRepoIdx];
  const isSubTask = !!subTaskContext;

  return (
    <Dialog open={modal.visible} onOpenChange={() => { modal.resolve('cancel' as MergeOnDoneResult); modal.hide(); }}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <GitMerge className="h-6 w-6 text-brand" />
            <DialogTitle>{isSubTask ? 'Merge All Tasks?' : 'Unmerged Branch'}</DialogTitle>
          </div>
          <DialogDescription className="text-left pt-2">
            {isSubTask ? (
              <>
                This sub-task shares a workspace with &ldquo;{subTaskContext.parentTitle}&rdquo;
                {subTaskContext.siblingCount > 0 && (
                  <> and {subTaskContext.siblingCount} other sub-task{subTaskContext.siblingCount > 1 ? 's' : ''}</>
                )}
                . Merging will finalize the branch and mark the parent and all sub-tasks as done.
              </>
            ) : (
              <>
                The workspace &ldquo;{workspaceName}&rdquo; has unmerged changes. Would you like
                to merge before marking as done?
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!isSubTask && subTaskStatus && <SubTaskWarning status={subTaskStatus} />}

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
              onClick={() => { modal.resolve((isSubTask ? 'merge_all' : 'merge') as MergeOnDoneResult); modal.hide(); }}
            >
              {isSubTask ? 'Merge All' : 'Merge'}
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
