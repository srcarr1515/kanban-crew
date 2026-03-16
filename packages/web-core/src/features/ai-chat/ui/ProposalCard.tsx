import { useState } from 'react';
import { CheckCircleIcon, SpinnerIcon } from '@phosphor-icons/react';
import type { Proposal } from '@/shared/lib/local/chatApi';
import { createLocalTask } from '@/shared/lib/local/localApi';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useQueryClient } from '@tanstack/react-query';

interface ProposalCardProps {
  proposal: Proposal;
}

export function ProposalCard({ proposal }: ProposalCardProps) {
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'creating' | 'done'>('idle');

  const handleConfirm = async () => {
    setStatus('creating');
    try {
      for (const ticket of proposal.tickets) {
        await createLocalTask({
          project_id: projectId,
          title: ticket.title,
          description: ticket.description,
          status: ticket.status || 'todo',
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['local-tasks'] });
      setStatus('done');
    } catch {
      setStatus('idle');
    }
  };

  return (
    <div className="my-2 rounded-lg border border-brand/30 bg-brand/5 p-3">
      <div className="text-xs font-semibold text-brand mb-2">
        Proposed Tickets ({proposal.tickets.length})
      </div>
      <ul className="space-y-1.5 mb-3">
        {proposal.tickets.map((ticket, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="text-low shrink-0">{i + 1}.</span>
            <div className="min-w-0">
              <div className="font-medium text-high">{ticket.title}</div>
              {ticket.description && (
                <div className="text-xs text-low mt-0.5 line-clamp-2">
                  {ticket.description}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {status === 'done' ? (
        <div className="flex items-center gap-1.5 text-sm text-green-500">
          <CheckCircleIcon className="size-icon-base" weight="fill" />
          Tickets created!
        </div>
      ) : (
        <button
          type="button"
          onClick={handleConfirm}
          disabled={status === 'creating'}
          className="w-full flex items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 transition-colors disabled:opacity-60"
        >
          {status === 'creating' ? (
            <>
              <SpinnerIcon className="size-icon-sm animate-spin" />
              Creating...
            </>
          ) : (
            'Confirm & Create Tickets'
          )}
        </button>
      )}
    </div>
  );
}
