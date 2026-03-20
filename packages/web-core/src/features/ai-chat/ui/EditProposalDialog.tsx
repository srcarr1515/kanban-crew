import { useState, useEffect, useCallback } from 'react';
import { Button } from '@vibe/ui/components/Button';
import { Input } from '@vibe/ui/components/Input';
import { Label } from '@vibe/ui/components/Label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@vibe/ui/components/KeyboardDialog';
import { create, useModal } from '@ebay/nice-modal-react';
import {
  TrashIcon,
  PlusIcon,
  SpinnerIcon,
  ArrowSquareOutIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowBendUpLeftIcon,
} from '@phosphor-icons/react';
import { type Proposal, type ProposalTicket, buildTicketDescription } from '@/shared/lib/local/chatApi';
import { createLocalTask } from '@/shared/lib/local/localApi';
import { useQueryClient } from '@tanstack/react-query';
import { defineModal } from '@/shared/lib/modals';
import {
  openKanbanIssueComposer,
  buildKanbanIssueComposerKey,
  patchKanbanIssueComposer,
} from '@/shared/stores/useKanbanIssueComposerStore';

export type EditProposalResult = 'created' | 'canceled';

interface EditProposalProps {
  proposal: Proposal;
  projectId: string;
  crewMemberId?: string;
}

const STATUS_OPTIONS = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
];

const EditProposalDialogImpl = create<EditProposalProps>(
  ({ proposal, projectId, crewMemberId }) => {
    const modal = useModal();
    const queryClient = useQueryClient();
    const [tickets, setTickets] = useState<ProposalTicket[]>([]);
    const [status, setStatus] = useState<'idle' | 'creating'>('idle');

    useEffect(() => {
      if (modal.visible) {
        setTickets(
          proposal.tickets.map((t) => ({
            ...t,
            subtasks: t.subtasks ? t.subtasks.map((s) => ({ ...s })) : [],
          }))
        );
        setStatus('idle');
      }
    }, [modal.visible, proposal.tickets]);

    // ── Field updates ──────────────────────────────────────────────────────

    const updateTicket = (
      index: number,
      field: keyof Omit<ProposalTicket, 'subtasks'>,
      value: string
    ) => {
      setTickets((prev) =>
        prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
      );
    };

    const updateSubtask = (
      parentIndex: number,
      subIndex: number,
      field: keyof Omit<ProposalTicket, 'subtasks'>,
      value: string
    ) => {
      setTickets((prev) =>
        prev.map((t, i) => {
          if (i !== parentIndex) return t;
          return {
            ...t,
            subtasks: (t.subtasks ?? []).map((s, j) =>
              j === subIndex ? { ...s, [field]: value } : s
            ),
          };
        })
      );
    };

    // ── Add / remove ───────────────────────────────────────────────────────

    const addTicket = () => {
      setTickets((prev) => [
        ...prev,
        { title: '', description: '', status: 'todo', subtasks: [] },
      ]);
    };

    const removeTicket = (index: number) => {
      setTickets((prev) => prev.filter((_, i) => i !== index));
    };

    const addSubtask = (parentIndex: number) => {
      setTickets((prev) =>
        prev.map((t, i) => {
          if (i !== parentIndex) return t;
          return {
            ...t,
            subtasks: [
              ...(t.subtasks ?? []),
              { title: '', description: '', status: 'todo' },
            ],
          };
        })
      );
    };

    const removeSubtask = (parentIndex: number, subIndex: number) => {
      setTickets((prev) =>
        prev.map((t, i) => {
          if (i !== parentIndex) return t;
          return {
            ...t,
            subtasks: (t.subtasks ?? []).filter((_, j) => j !== subIndex),
          };
        })
      );
    };

    // ── Reorder subtasks ───────────────────────────────────────────────────

    const moveSubtaskUp = (parentIndex: number, subIndex: number) => {
      if (subIndex === 0) return;
      setTickets((prev) =>
        prev.map((t, i) => {
          if (i !== parentIndex) return t;
          const subs = [...(t.subtasks ?? [])];
          [subs[subIndex - 1], subs[subIndex]] = [subs[subIndex], subs[subIndex - 1]];
          return { ...t, subtasks: subs };
        })
      );
    };

    const moveSubtaskDown = (parentIndex: number, subIndex: number) => {
      setTickets((prev) =>
        prev.map((t, i) => {
          if (i !== parentIndex) return t;
          const subs = [...(t.subtasks ?? [])];
          if (subIndex >= subs.length - 1) return t;
          [subs[subIndex], subs[subIndex + 1]] = [subs[subIndex + 1], subs[subIndex]];
          return { ...t, subtasks: subs };
        })
      );
    };

    // ── Promote / demote ───────────────────────────────────────────────────

    /** Lift a subtask out of its parent and insert it as a top-level ticket. */
    const promoteSubtask = (parentIndex: number, subIndex: number) => {
      setTickets((prev) => {
        const parent = prev[parentIndex];
        const sub = (parent.subtasks ?? [])[subIndex];
        if (!sub) return prev;
        const updatedParent = {
          ...parent,
          subtasks: (parent.subtasks ?? []).filter((_, j) => j !== subIndex),
        };
        const next = prev.map((t, i) => (i === parentIndex ? updatedParent : t));
        // Insert the promoted ticket immediately after its former parent
        next.splice(parentIndex + 1, 0, { ...sub, subtasks: [] });
        return next;
      });
    };

    /** Move a top-level ticket into the subtasks of another ticket. */
    const demoteTicket = (ticketIndex: number, targetParentIndex: number) => {
      setTickets((prev) => {
        const ticket = prev[ticketIndex];
        const newSub: ProposalTicket = {
          title: ticket.title,
          description: ticket.description,
          status: ticket.status,
        };
        const without = prev.filter((_, i) => i !== ticketIndex);
        // After removal the target's index shifts down by 1 if it was after the removed item
        const adjusted =
          targetParentIndex > ticketIndex
            ? targetParentIndex - 1
            : targetParentIndex;
        return without.map((t, i) => {
          if (i !== adjusted) return t;
          return { ...t, subtasks: [...(t.subtasks ?? []), newSub] };
        });
      });
    };

    // ── Create ─────────────────────────────────────────────────────────────

    const handleCreate = async () => {
      const valid = tickets.filter((t) => t.title.trim());
      if (valid.length === 0) return;

      setStatus('creating');
      try {
        for (const ticket of valid) {
          const parent = await createLocalTask({
            project_id: projectId,
            title: ticket.title.trim(),
            description: buildTicketDescription(ticket).trim() || undefined,
            status: ticket.status || 'todo',
            proposing_crew_member_id: crewMemberId,
          });
          const validSubs = (ticket.subtasks ?? []).filter((s) =>
            s.title.trim()
          );
          for (let i = 0; i < validSubs.length; i++) {
            const sub = validSubs[i];
            await createLocalTask({
              project_id: projectId,
              title: sub.title.trim(),
              description: buildTicketDescription(sub).trim() || undefined,
              status: sub.status || 'todo',
              parent_task_id: parent.id,
              parent_task_sort_order: i,
              proposing_crew_member_id: crewMemberId,
            });
          }
        }
        await queryClient.invalidateQueries({
          queryKey: ['local', 'tasks', projectId],
        });
        modal.resolve('created' as EditProposalResult);
        modal.hide();
      } catch {
        setStatus('idle');
      }
    };

    const handleOpenInComposer = useCallback(
      (index: number) => {
        const ticket = tickets[index];
        if (!ticket) return;

        const composerKey = buildKanbanIssueComposerKey(null, projectId);
        openKanbanIssueComposer(composerKey);
        patchKanbanIssueComposer(composerKey, {
          title: ticket.title,
          description: ticket.description || null,
        });

        setTickets((prev) => prev.filter((_, i) => i !== index));
      },
      [tickets, projectId]
    );

    const handleCancel = () => {
      modal.resolve('canceled' as EditProposalResult);
      modal.hide();
    };

    const handleOpenChange = (open: boolean) => {
      if (!open) handleCancel();
    };

    const validParentCount = tickets.filter((t) => t.title.trim()).length;
    const validSubtaskCount = tickets.reduce(
      (sum, t) =>
        sum + (t.subtasks ?? []).filter((s) => s.title.trim()).length,
      0
    );
    const totalCount = validParentCount + validSubtaskCount;

    return (
      <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Review & Edit Tickets</DialogTitle>
            <DialogDescription>
              Edit here or open in the full issue composer for the complete
              editing experience.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-2">
            {tickets.map((ticket, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-secondary p-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-xs text-low font-medium mt-2">
                    #{i + 1}
                  </span>
                  <div className="flex-1 space-y-2">
                    <div>
                      <Label htmlFor={`ticket-title-${i}`} className="text-xs">
                        Title
                      </Label>
                      <Input
                        id={`ticket-title-${i}`}
                        value={ticket.title}
                        onChange={(e) =>
                          updateTicket(i, 'title', e.target.value)
                        }
                        placeholder="Ticket title"
                        disabled={status === 'creating'}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`ticket-desc-${i}`} className="text-xs">
                        Description
                      </Label>
                      <textarea
                        id={`ticket-desc-${i}`}
                        value={ticket.description}
                        onChange={(e) =>
                          updateTicket(i, 'description', e.target.value)
                        }
                        placeholder="Describe what this ticket covers..."
                        disabled={status === 'creating'}
                        rows={3}
                        className="w-full resize-none rounded-md border border-border bg-primary px-3 py-2 text-sm text-high placeholder:text-low focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
                      />
                    </div>
                    {ticket.files_affected && ticket.files_affected.length > 0 && (
                      <div>
                        <Label className="text-xs">Files Affected</Label>
                        <div className="mt-1 space-y-0.5">
                          {ticket.files_affected.map((f, fi) => (
                            <div key={fi} className="text-xs text-muted-foreground font-mono bg-muted rounded px-2 py-0.5">
                              {f}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {ticket.acceptance_criteria && ticket.acceptance_criteria.length > 0 && (
                      <div>
                        <Label className="text-xs">Acceptance Criteria</Label>
                        <ul className="mt-1 space-y-0.5">
                          {ticket.acceptance_criteria.map((c, ci) => (
                            <li key={ci} className="text-xs text-muted-foreground flex items-start gap-1.5">
                              <span className="shrink-0 mt-0.5">☐</span>
                              <span>{c}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Label
                          htmlFor={`ticket-status-${i}`}
                          className="text-xs shrink-0"
                        >
                          Status
                        </Label>
                        <select
                          id={`ticket-status-${i}`}
                          value={ticket.status || 'todo'}
                          onChange={(e) =>
                            updateTicket(i, 'status', e.target.value)
                          }
                          disabled={status === 'creating'}
                          className="rounded-md border border-border bg-primary px-2 py-1 text-xs text-high focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenInComposer(i)}
                        disabled={status === 'creating' || !ticket.title.trim()}
                        className="flex items-center gap-1 text-xs text-brand hover:text-brand/80 transition-colors disabled:opacity-40"
                        title="Open in the full issue composer"
                      >
                        <ArrowSquareOutIcon className="size-3.5" />
                        Open in Composer
                      </button>
                    </div>

                    {/* Subtasks */}
                    {(ticket.subtasks ?? []).length > 0 && (
                      <div className="space-y-1.5 pl-3 border-l-2 border-brand/20">
                        <span className="text-xs text-low font-medium">
                          Subtasks
                        </span>
                        {(ticket.subtasks ?? []).map((sub, j) => {
                          const subs = ticket.subtasks ?? [];
                          return (
                            <div key={j} className="flex items-center gap-1.5">
                              {/* Reorder */}
                              <div className="flex flex-col shrink-0">
                                <button
                                  type="button"
                                  onClick={() => moveSubtaskUp(i, j)}
                                  disabled={status === 'creating' || j === 0}
                                  className="p-0.5 rounded text-low hover:text-normal disabled:opacity-20 transition-colors"
                                  title="Move up"
                                >
                                  <ArrowUpIcon className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveSubtaskDown(i, j)}
                                  disabled={
                                    status === 'creating' ||
                                    j === subs.length - 1
                                  }
                                  className="p-0.5 rounded text-low hover:text-normal disabled:opacity-20 transition-colors"
                                  title="Move down"
                                >
                                  <ArrowDownIcon className="size-3" />
                                </button>
                              </div>
                              <Input
                                value={sub.title}
                                onChange={(e) =>
                                  updateSubtask(i, j, 'title', e.target.value)
                                }
                                placeholder="Subtask title"
                                disabled={status === 'creating'}
                                className="flex-1 text-xs"
                              />
                              {/* Promote to top-level ticket */}
                              <button
                                type="button"
                                onClick={() => promoteSubtask(i, j)}
                                disabled={status === 'creating'}
                                className="shrink-0 p-1 rounded text-low hover:text-brand hover:bg-brand/10 transition-colors disabled:opacity-50"
                                title="Promote to standalone ticket"
                              >
                                <ArrowBendUpLeftIcon className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeSubtask(i, j)}
                                disabled={status === 'creating'}
                                className="shrink-0 p-1 rounded text-low hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                                title="Remove subtask"
                              >
                                <TrashIcon className="size-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => addSubtask(i)}
                        disabled={status === 'creating'}
                        className="flex items-center gap-1 text-xs text-low hover:text-brand transition-colors disabled:opacity-50"
                      >
                        <PlusIcon className="size-3" weight="bold" />
                        Add subtask
                      </button>

                      {/* Demote this ticket to a subtask of another */}
                      {tickets.filter((_, k) => k !== i && tickets[k].title.trim()).length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-low">Nest under:</span>
                          <select
                            value=""
                            onChange={(e) => {
                              if (e.target.value !== '')
                                demoteTicket(i, parseInt(e.target.value, 10));
                            }}
                            disabled={status === 'creating'}
                            className="rounded border border-border bg-primary px-1.5 py-0.5 text-xs text-high focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50 max-w-[140px]"
                          >
                            <option value="">— choose parent —</option>
                            {tickets.map((t, k) =>
                              k !== i && t.title.trim() ? (
                                <option key={k} value={k}>
                                  {t.title.length > 24
                                    ? t.title.slice(0, 22) + '…'
                                    : t.title}
                                </option>
                              ) : null
                            )}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTicket(i)}
                    disabled={status === 'creating'}
                    className="shrink-0 p-1.5 rounded text-low hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    title="Remove ticket"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>
              </div>
            ))}

            {tickets.length === 0 && (
              <div className="text-center text-sm text-low py-4">
                All tickets moved to the composer.
              </div>
            )}

            <button
              type="button"
              onClick={addTicket}
              disabled={status === 'creating'}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs text-low hover:text-normal hover:border-brand/50 transition-colors disabled:opacity-50"
            >
              <PlusIcon className="size-3.5" weight="bold" />
              Add ticket
            </button>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={status === 'creating'}
            >
              {tickets.length === 0 ? 'Close' : 'Cancel'}
            </Button>
            {totalCount > 0 && (
              <Button
                onClick={handleCreate}
                disabled={status === 'creating' || totalCount === 0}
              >
                {status === 'creating' ? (
                  <span className="flex items-center gap-2">
                    <SpinnerIcon className="size-4 animate-spin" />
                    Creating...
                  </span>
                ) : (
                  `Create ${totalCount} Ticket${totalCount === 1 ? '' : 's'}`
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const EditProposalDialog = defineModal<
  EditProposalProps,
  EditProposalResult
>(EditProposalDialogImpl);
