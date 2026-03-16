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
} from '@phosphor-icons/react';
import type { Proposal, ProposalTicket } from '@/shared/lib/local/chatApi';
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
}

const EditProposalDialogImpl = create<EditProposalProps>(
  ({ proposal, projectId }) => {
    const modal = useModal();
    const queryClient = useQueryClient();
    const [tickets, setTickets] = useState<ProposalTicket[]>([]);
    const [status, setStatus] = useState<'idle' | 'creating'>('idle');

    useEffect(() => {
      if (modal.visible) {
        setTickets(proposal.tickets.map((t) => ({ ...t })));
        setStatus('idle');
      }
    }, [modal.visible, proposal.tickets]);

    const updateTicket = (
      index: number,
      field: keyof ProposalTicket,
      value: string
    ) => {
      setTickets((prev) =>
        prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
      );
    };

    const removeTicket = (index: number) => {
      setTickets((prev) => prev.filter((_, i) => i !== index));
    };

    const addTicket = () => {
      setTickets((prev) => [
        ...prev,
        { title: '', description: '', status: 'todo' },
      ]);
    };

    const handleCreate = async () => {
      const valid = tickets.filter((t) => t.title.trim());
      if (valid.length === 0) return;

      setStatus('creating');
      try {
        for (const ticket of valid) {
          await createLocalTask({
            project_id: projectId,
            title: ticket.title.trim(),
            description: ticket.description.trim() || undefined,
            status: ticket.status || 'todo',
          });
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

        // Open the kanban issue composer with this ticket's data
        const composerKey = buildKanbanIssueComposerKey(null, projectId);
        openKanbanIssueComposer(composerKey);
        patchKanbanIssueComposer(composerKey, {
          title: ticket.title,
          description: ticket.description || null,
        });

        // Remove from the modal list
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

    const validCount = tickets.filter((t) => t.title.trim()).length;

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
                          <option value="backlog">Backlog</option>
                          <option value="todo">To Do</option>
                          <option value="in_progress">In Progress</option>
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
            {validCount > 0 && (
              <Button
                onClick={handleCreate}
                disabled={status === 'creating' || validCount === 0}
              >
                {status === 'creating' ? (
                  <span className="flex items-center gap-2">
                    <SpinnerIcon className="size-4 animate-spin" />
                    Creating...
                  </span>
                ) : (
                  `Create ${validCount} Ticket${validCount === 1 ? '' : 's'}`
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
