import { useState } from 'react';
import { CheckCircleIcon, PencilSimpleIcon, SpinnerIcon } from '@phosphor-icons/react';
import type { Proposal } from '@/shared/lib/local/chatApi';
import { createLocalTask } from '@/shared/lib/local/localApi';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useQueryClient } from '@tanstack/react-query';
import { EditProposalDialog } from './EditProposalDialog';

interface ProposalCardProps {
  proposal: Proposal;
  crewMemberId?: string;
}

export function ProposalCard({ proposal, crewMemberId }: ProposalCardProps) {
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'idle' | 'creating' | 'done'>('idle');

  const totalCount =
    proposal.tickets.length +
    proposal.tickets.reduce((sum, t) => sum + (t.subtasks?.length ?? 0), 0);

  const handleConfirm = async () => {
    setStatus('creating');
    try {
      for (const ticket of proposal.tickets) {
        const parent = await createLocalTask({
          project_id: projectId,
          title: ticket.title,
          description: ticket.description,
          status: ticket.status || 'todo',
          proposing_crew_member_id: crewMemberId,
        });
        if (ticket.subtasks && ticket.subtasks.length > 0) {
          for (let i = 0; i < ticket.subtasks.length; i++) {
            const sub = ticket.subtasks[i];
            await createLocalTask({
              project_id: projectId,
              title: sub.title,
              description: sub.description,
              status: sub.status || 'todo',
              parent_task_id: parent.id,
              parent_task_sort_order: i,
              proposing_crew_member_id: crewMemberId,
            });
          }
        }
      }
      await queryClient.invalidateQueries({ queryKey: ['local', 'tasks', projectId] });
      setStatus('done');
    } catch {
      setStatus('idle');
    }
  };

  const handleEditAndCreate = async () => {
    const result = await EditProposalDialog.show({ proposal, projectId, crewMemberId });
    if (result === 'created') {
      setStatus('done');
    }
  };

  return (
    <div className="my-2 rounded-lg border border-brand/30 bg-brand/5 p-3">
      <div className="text-xs font-semibold text-brand mb-2">
        Proposed Tickets ({totalCount})
      </div>
      <ul className="space-y-1.5 mb-3">
        {proposal.tickets.map((ticket, i) => (
          <li key={i}>
            <div className="flex gap-2 text-sm">
              <span className="text-low shrink-0">{i + 1}.</span>
              <div className="min-w-0">
                <div className="font-medium text-high">{ticket.title}</div>
                {ticket.description && (
                  <div className="text-xs text-low mt-0.5 line-clamp-2">
                    {ticket.description}
                  </div>
                )}
              </div>
            </div>
            {ticket.subtasks && ticket.subtasks.length > 0 && (
              <ul className="ml-6 mt-1 space-y-0.5">
                {ticket.subtasks.map((sub, j) => (
                  <li key={j} className="flex gap-1.5 text-xs text-low">
                    <span className="shrink-0">↳</span>
                    <span>{sub.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      {status === 'done' ? (
        <div className="flex items-center gap-1.5 text-sm text-green-500">
          <CheckCircleIcon className="size-icon-base" weight="fill" />
          Tickets created!
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleEditAndCreate}
            disabled={status === 'creating'}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-brand/40 px-3 py-2 text-sm font-medium text-brand hover:bg-brand/10 transition-colors disabled:opacity-60"
          >
            <PencilSimpleIcon className="size-4" />
            Review & Edit
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={status === 'creating'}
            className="flex-1 flex items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand/90 transition-colors disabled:opacity-60"
          >
            {status === 'creating' ? (
              <>
                <SpinnerIcon className="size-icon-sm animate-spin" />
                Creating...
              </>
            ) : (
              'Create All'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
