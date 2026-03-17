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
import { ListTodo, CheckCircle2, Circle, Clock, Eye } from 'lucide-react';
import { defineModal } from '@/shared/lib/modals';
import { useState } from 'react';

export type ResumeWorkResult =
  | { type: 'subtask'; subtaskId: string }
  | { type: 'cancel' };

export interface SubTaskInfo {
  id: string;
  title: string;
  status: string;
}

export interface ResumeWorkDialogProps {
  parentTitle: string;
  subTasks: SubTaskInfo[];
}

const STATUS_ORDER: Record<string, number> = {
  ready: 0,
  todo: 1,
  in_progress: 2,
  in_review: 3,
  done: 4,
  cancelled: 5,
};

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Circle; className: string }> = {
  todo: { label: 'To Do', icon: Circle, className: 'text-muted-foreground' },
  ready: { label: 'Ready', icon: Circle, className: 'text-violet-400' },
  in_progress: { label: 'In Progress', icon: Clock, className: 'text-blue-400' },
  in_review: { label: 'In Review', icon: Eye, className: 'text-amber-400' },
  done: { label: 'Done', icon: CheckCircle2, className: 'text-emerald-400' },
  cancelled: { label: 'Cancelled', icon: Circle, className: 'text-red-400' },
};

const ResumeWorkDialogImpl = create<ResumeWorkDialogProps>((props) => {
  const modal = useModal();
  const { parentTitle, subTasks } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sorted = [...subTasks].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)
  );

  const readyTasks = sorted.filter((t) => t.status === 'ready');
  const otherTasks = sorted.filter((t) => t.status !== 'ready');
  const doneCount = subTasks.filter(
    (t) => t.status === 'done' || t.status === 'cancelled'
  ).length;

  const handleCancel = () => {
    modal.resolve({ type: 'cancel' } as ResumeWorkResult);
    modal.hide();
  };

  const handleStart = () => {
    if (!selectedId) return;
    modal.resolve({ type: 'subtask', subtaskId: selectedId } as ResumeWorkResult);
    modal.hide();
  };

  return (
    <Dialog open={modal.visible} onOpenChange={(open) => { if (!open) handleCancel(); }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <ListTodo className="h-6 w-6 text-brand" />
            <DialogTitle>Resume Work</DialogTitle>
          </div>
          <DialogDescription className="text-left pt-2">
            <span className="font-medium text-high">{parentTitle}</span> has{' '}
            {subTasks.length} sub-task{subTasks.length !== 1 ? 's' : ''}
            {doneCount > 0 && <> ({doneCount} completed)</>}.
            Which sub-task should the agent work on?
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[300px] overflow-y-auto space-y-1 py-1">
          {readyTasks.length > 0 && (
            <>
              <div className="text-xs text-muted-foreground font-medium px-2 pt-1 pb-0.5">
                Ready
              </div>
              {readyTasks.map((task) => {
                const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.todo!;
                const Icon = config.icon;
                return (
                  <button
                    key={task.id}
                    onClick={() => setSelectedId(task.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors ${
                      selectedId === task.id
                        ? 'bg-brand/20 border border-brand/50'
                        : 'hover:bg-surface-hover border border-transparent'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${config.className}`} />
                    <span className="truncate">{task.title}</span>
                  </button>
                );
              })}
            </>
          )}
          {otherTasks.length > 0 && (
            <>
              {readyTasks.length > 0 && (
                <div className="text-xs text-muted-foreground font-medium px-2 pt-2 pb-0.5">
                  Other
                </div>
              )}
              {otherTasks.map((task) => {
                const isDone = task.status === 'done' || task.status === 'cancelled';
                const config = STATUS_CONFIG[task.status] ?? STATUS_CONFIG.todo!;
                const Icon = config.icon;
                return (
                  <button
                    key={task.id}
                    disabled={isDone}
                    onClick={() => !isDone && setSelectedId(task.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors ${
                      isDone
                        ? 'opacity-40 cursor-not-allowed'
                        : selectedId === task.id
                          ? 'bg-brand/20 border border-brand/50'
                          : 'hover:bg-surface-hover border border-transparent'
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${config.className}`} />
                    <span className={`truncate ${isDone ? 'line-through' : ''}`}>
                      {task.title}
                    </span>
                    <span className={`ml-auto text-xs shrink-0 ${config.className}`}>
                      {config.label}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={!selectedId}>
            Start Sub-task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

export const ResumeWorkDialog = defineModal<
  ResumeWorkDialogProps,
  ResumeWorkResult
>(ResumeWorkDialogImpl);
