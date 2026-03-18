import { useState } from 'react';
import { CheckCircleIcon, TrashIcon, SpinnerIcon } from '@phosphor-icons/react';
import type { DeleteProposal } from '@/shared/lib/local/chatApi';
import { deleteLocalTask } from '@/shared/lib/local/localApi';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectContext } from '@/shared/hooks/useProjectContext';

interface DeleteProposalCardProps {
  proposal: DeleteProposal;
}

export function DeleteProposalCard({ proposal }: DeleteProposalCardProps) {
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'deleting' | 'done'>('idle');

  const handleConfirm = async () => {
    setStatus('deleting');
    try {
      for (const del of proposal.deletions) {
        await deleteLocalTask(del.task_id);
      }
      await queryClient.invalidateQueries({ queryKey: ['local', 'tasks', projectId] });
      setStatus('done');
    } catch {
      setStatus('idle');
    }
  };

  return (
    <div className="my-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
      <div className="text-xs font-semibold text-red-500 mb-2">
        <TrashIcon className="inline size-3.5 mr-1" weight="bold" />
        Proposed Deletions ({proposal.deletions.length})
      </div>
      <ul className="space-y-1.5 mb-3">
        {proposal.deletions.map((del, i) => (
          <li key={i} className="text-sm">
            <div className="flex gap-2">
              <span className="text-low shrink-0">{i + 1}.</span>
              <span className="font-medium text-high">{del.title}</span>
            </div>
          </li>
        ))}
      </ul>
      {status === 'done' ? (
        <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
          <CheckCircleIcon className="size-4" weight="fill" />
          Deleted
        </div>
      ) : (
        <button
          onClick={handleConfirm}
          disabled={status === 'deleting'}
          className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
        >
          {status === 'deleting' ? (
            <SpinnerIcon className="size-3.5 animate-spin" />
          ) : (
            <TrashIcon className="size-3.5" weight="bold" />
          )}
          {status === 'deleting' ? 'Deleting…' : 'Confirm Delete'}
        </button>
      )}
    </div>
  );
}
