import { useState } from 'react';
import { CaretRightIcon } from '@phosphor-icons/react';
import type { ProposalTicket } from '@/shared/lib/local/chatApi';

interface SubTaskProps {
  subtask: ProposalTicket;
}

export function SubTask({ subtask }: SubTaskProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="text-xs text-low">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left hover:text-normal transition-colors"
      >
        <CaretRightIcon
          className={`size-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="truncate">{subtask.title}</span>
      </button>
      {expanded && (
        <div className="ml-[18px] mt-1 space-y-1">
          {subtask.description && (
            <p className="text-low whitespace-pre-wrap">{subtask.description}</p>
          )}
          {subtask.status && (
            <span className="inline-block rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
              {subtask.status}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
