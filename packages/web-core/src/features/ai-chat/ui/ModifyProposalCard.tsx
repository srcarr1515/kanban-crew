import { useState } from 'react';
import { CheckCircleIcon, PencilSimpleIcon, SpinnerIcon } from '@phosphor-icons/react';
import type { ModifyProposal } from '@/shared/lib/local/chatApi';
import { updateLocalTask } from '@/shared/lib/local/localApi';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectContext } from '@/shared/hooks/useProjectContext';

interface ModifyProposalCardProps {
  proposal: ModifyProposal;
}

export function ModifyProposalCard({ proposal }: ModifyProposalCardProps) {
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'applying' | 'done'>('idle');

  const handleConfirm = async () => {
    setStatus('applying');
    try {
      for (const mod of proposal.modifications) {
        const changes: Record<string, unknown> = {};
        if (mod.title !== undefined) changes.title = mod.title;
        if (mod.description !== undefined) changes.description = mod.description;
        if (mod.status !== undefined) changes.status = mod.status;
        await updateLocalTask(mod.task_id, changes as { title?: string; description?: string | null; status?: string });
      }
      await queryClient.invalidateQueries({ queryKey: ['local', 'tasks', projectId] });
      setStatus('done');
    } catch {
      setStatus('idle');
    }
  };

  return (
    <div className="my-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="text-xs font-semibold text-amber-500 mb-2">
        <PencilSimpleIcon className="inline size-3.5 mr-1" weight="bold" />
        Proposed Modifications ({proposal.modifications.length})
      </div>
      <ul className="space-y-1.5 mb-3">
        {proposal.modifications.map((mod, i) => (
          <li key={i} className="text-sm">
            <div className="flex gap-2">
              <span className="text-low shrink-0">{i + 1}.</span>
              <div className="min-w-0">
                <span className="font-medium text-high">
                  {mod.title ?? `Task ${mod.task_id.slice(0, 8)}…`}
                </span>
                <div className="text-xs text-low mt-0.5 space-x-2">
                  {mod.status && <span>Status → {mod.status}</span>}
                  {mod.description && <span>Description updated</span>}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {status === 'done' ? (
        <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
          <CheckCircleIcon className="size-4" weight="fill" />
          Changes applied
        </div>
      ) : (
        <button
          onClick={handleConfirm}
          disabled={status === 'applying'}
          className="flex items-center gap-1.5 text-xs font-medium text-amber-500 hover:text-amber-400 transition-colors disabled:opacity-50"
        >
          {status === 'applying' ? (
            <SpinnerIcon className="size-3.5 animate-spin" />
          ) : (
            <PencilSimpleIcon className="size-3.5" weight="bold" />
          )}
          {status === 'applying' ? 'Applying…' : 'Apply Changes'}
        </button>
      )}
    </div>
  );
}
