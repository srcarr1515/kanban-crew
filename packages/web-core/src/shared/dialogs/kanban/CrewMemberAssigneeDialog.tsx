import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { create, useModal } from '@ebay/nice-modal-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckIcon, UserCircleMinusIcon } from '@phosphor-icons/react';
import { defineModal } from '@/shared/lib/modals';
import { CommandDialog } from '@vibe/ui/components/Command';
import {
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@vibe/ui/components/Command';
import { listCrewMembers, updateLocalTask } from '@/shared/lib/local/localApi';
import { useProjectContext } from '@/shared/hooks/useProjectContext';

export interface CrewMemberAssigneeDialogProps {
  taskId: string;
}

function CrewMemberAssigneeContent({ taskId }: { taskId: string }) {
  const { t } = useTranslation('common');
  const modal = useModal();
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const { issueAssignees } = useProjectContext();

  const crewMembersQuery = useQuery({
    queryKey: ['local', 'crew-members'],
    queryFn: listCrewMembers,
  });

  const crewMembers = crewMembersQuery.data ?? [];

  const currentAssigneeId = useMemo(() => {
    const assignee = issueAssignees.find((a) => a.issue_id === taskId);
    return assignee?.user_id ?? null;
  }, [issueAssignees, taskId]);

  useEffect(() => {
    if (modal.visible) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setSearch('');
    }
  }, [modal.visible]);

  const handleSelect = useCallback(
    async (crewMemberId: string | null) => {
      await updateLocalTask(taskId, { crew_member_id: crewMemberId });
      modal.hide();
    },
    [taskId, modal],
  );

  const handleCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    previousFocusRef.current?.focus();
  }, []);

  return (
    <CommandDialog
      open={modal.visible}
      onOpenChange={(open) => !open && modal.hide()}
      onCloseAutoFocus={handleCloseAutoFocus}
    >
      <CommandInput
        placeholder={t('kanban.selectAssignees', 'Select assignee...')}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>
          {t('kanban.noResultsFound', 'No crew members found.')}
        </CommandEmpty>
        <CommandGroup>
          {currentAssigneeId && (
            <CommandItem
              value="__unassign__"
              onSelect={() => handleSelect(null)}
            >
              <UserCircleMinusIcon className="mr-base size-icon-sm" />
              <span>{t('kanban.unassign', 'Unassign')}</span>
            </CommandItem>
          )}
          {crewMembers.map((cm) => (
            <CommandItem
              key={cm.id}
              value={`${cm.name} ${cm.role}`}
              onSelect={() => handleSelect(cm.id)}
            >
              <div className="flex items-center gap-base flex-1">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs">
                  {cm.avatar || cm.name.charAt(0)}
                </span>
                <span>{cm.name}</span>
                <span className="text-low text-sm">{cm.role}</span>
              </div>
              {currentAssigneeId === cm.id && (
                <CheckIcon className="size-icon-xs text-accent" />
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

const CrewMemberAssigneeDialogImpl = create<CrewMemberAssigneeDialogProps>(
  ({ taskId }) => <CrewMemberAssigneeContent taskId={taskId} />,
);

export const CrewMemberAssigneeDialog = defineModal<
  CrewMemberAssigneeDialogProps,
  void
>(CrewMemberAssigneeDialogImpl);
