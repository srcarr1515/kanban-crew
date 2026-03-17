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
import { GitBranch, Plus } from 'lucide-react';
import { defineModal } from '@/shared/lib/modals';

export type SubTaskWorkspaceResult = 'reuse' | 'new' | 'cancel';

export interface SubTaskWorkspaceDialogProps {
  subTaskTitle: string;
  parentTitle: string;
  parentWorkspaceName: string;
}

const SubTaskWorkspaceDialogImpl = create<SubTaskWorkspaceDialogProps>(
  (props) => {
    const modal = useModal();
    const { subTaskTitle, parentTitle, parentWorkspaceName } = props;

    const resolve = (result: SubTaskWorkspaceResult) => {
      modal.resolve(result);
      modal.hide();
    };

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) resolve('cancel');
        }}
      >
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <GitBranch className="h-6 w-6 text-brand" />
              <DialogTitle>Workspace for Sub-task</DialogTitle>
            </div>
            <DialogDescription className="text-left pt-2">
              <span className="font-medium text-high">{subTaskTitle}</span> is a
              sub-task of{' '}
              <span className="font-medium text-high">{parentTitle}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-1">
            <button
              onClick={() => resolve('reuse')}
              className="w-full flex items-start gap-3 p-3 rounded-md border border-border hover:border-brand/50 hover:bg-brand/5 transition-colors text-left"
            >
              <GitBranch className="h-5 w-5 mt-0.5 shrink-0 text-brand" />
              <div>
                <p className="text-sm font-medium text-high">
                  Use parent&apos;s workspace
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Continue on the same branch ({parentWorkspaceName}). The agent
                  will receive a follow-up prompt for this sub-task.
                </p>
              </div>
            </button>
            <button
              onClick={() => resolve('new')}
              className="w-full flex items-start gap-3 p-3 rounded-md border border-border hover:border-brand/50 hover:bg-brand/5 transition-colors text-left"
            >
              <Plus className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-high">
                  Create new workspace
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Spin up a separate branch and workspace for this sub-task.
                </p>
              </div>
            </button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => resolve('cancel')}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const SubTaskWorkspaceDialog = defineModal<
  SubTaskWorkspaceDialogProps,
  SubTaskWorkspaceResult
>(SubTaskWorkspaceDialogImpl);
