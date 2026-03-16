import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { create, useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import { GitBranchIcon, PlusIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { defineModal } from '@/shared/lib/modals';
import { ApiError, workspacesApi } from '@/shared/lib/api';
import { getWorkspaceDefaults } from '@/shared/lib/workspaceDefaults';
import { ErrorDialog } from '@vibe/ui/components/ErrorDialog';
import { useProjectWorkspaceCreateDraft } from '@/shared/hooks/useProjectWorkspaceCreateDraft';
import {
  buildLinkedIssueCreateState,
  buildLocalWorkspaceIdSet,
  buildWorkspaceCreateInitialState,
  buildWorkspaceCreatePrompt,
} from '@/shared/lib/workspaceCreateState';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@vibe/ui/components/Command';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { ProjectProvider } from '@/shared/providers/remote/ProjectProvider';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { UserProvider } from '@/shared/providers/remote/UserProvider';
import { useUserContext } from '@/shared/hooks/useUserContext';
import { IS_LOCAL_MODE } from '@/shared/lib/local/isLocalMode';
import { linkWorkspaceToTask } from '@/shared/lib/local/localApi';
import type { Workspace as RemoteWorkspace } from 'shared/remote-types';

export interface WorkspaceSelectionDialogProps {
  projectId: string;
  issueId: string;
}

const PAGE_SIZE = 50;

function getLinkWorkspaceErrorMessage(error: unknown): string | null {
  if (error instanceof ApiError && error.status === 409) {
    return 'This workspace is already linked to an issue.';
  }

  if (error instanceof Error) {
    const normalizedMessage = error.message.toLowerCase();
    if (
      normalizedMessage.includes('already exists') ||
      normalizedMessage.includes('already linked')
    ) {
      return 'This workspace is already linked to an issue.';
    }
    return error.message;
  }

  return null;
}

/** Shared selection UI used by both local and remote content components */
function WorkspaceSelectionUI({
  projectId,
  issueId,
  linkedWorkspaces,
  remoteWorkspacesForDefaults,
  onLinkWorkspace,
}: {
  projectId: string;
  issueId: string;
  linkedWorkspaces: RemoteWorkspace[];
  remoteWorkspacesForDefaults: RemoteWorkspace[];
  onLinkWorkspace: (workspaceId: string) => Promise<void>;
}) {
  const { t } = useTranslation('common');
  const modal = useModal();
  const { openWorkspaceCreateFromState } = useProjectWorkspaceCreateDraft();
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();
  const { getIssue } = useProjectContext();

  const [search, setSearch] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  useEffect(() => {
    if (modal.visible) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setSearch('');
      setIsLinking(false);
    }
  }, [modal.visible]);

  const linkedLocalWorkspaceIds = useMemo(() => {
    return new Set(
      linkedWorkspaces
        .map((w) => w.local_workspace_id)
        .filter((id): id is string => id !== null)
    );
  }, [linkedWorkspaces]);

  const allWorkspaces = useMemo(() => {
    const active = activeWorkspaces.map((ws) => ({ ...ws, isArchived: false }));
    const archived = archivedWorkspaces.map((ws) => ({
      ...ws,
      isArchived: true,
    }));
    return [...active, ...archived];
  }, [activeWorkspaces, archivedWorkspaces]);

  const searchLower = search.toLowerCase();
  const isSearching = search.length > 0;

  const filteredWorkspaces = useMemo(() => {
    return allWorkspaces.filter((ws) => {
      if (linkedLocalWorkspaceIds.has(ws.id)) return false;
      if (isSearching) {
        return (
          ws.name.toLowerCase().includes(searchLower) ||
          ws.branch.toLowerCase().includes(searchLower)
        );
      }
      return true;
    });
  }, [allWorkspaces, linkedLocalWorkspaceIds, isSearching, searchLower]);

  const displayedWorkspaces = useMemo(() => {
    return isSearching
      ? filteredWorkspaces
      : filteredWorkspaces.slice(0, PAGE_SIZE);
  }, [filteredWorkspaces, isSearching]);

  const handleLinkWorkspace = useCallback(
    async (workspaceId: string) => {
      if (isLinking) return;

      setIsLinking(true);
      try {
        await onLinkWorkspace(workspaceId);
        modal.hide();
      } catch (err) {
        const errorMessage =
          getLinkWorkspaceErrorMessage(err) ??
          t('workspaces.linkError', 'Failed to link workspace');

        await ErrorDialog.show({
          title: t('common:error'),
          message: errorMessage,
          buttonText: t('common:ok'),
        });
      } finally {
        setIsLinking(false);
      }
    },
    [isLinking, modal, t, onLinkWorkspace]
  );

  const handleCreateNewWorkspace = useCallback(async () => {
    if (isLinking) return;
    setIsLinking(true);

    try {
      const issue = getIssue(issueId);
      const initialPrompt = buildWorkspaceCreatePrompt(
        issue?.title ?? null,
        issue?.description ?? null
      );

      const localWorkspaceIds = buildLocalWorkspaceIdSet(
        activeWorkspaces,
        archivedWorkspaces
      );

      const defaults = await getWorkspaceDefaults(
        remoteWorkspacesForDefaults,
        localWorkspaceIds,
        projectId
      );

      const createState = buildWorkspaceCreateInitialState({
        prompt: initialPrompt,
        defaults,
        linkedIssue: buildLinkedIssueCreateState(issue, projectId),
      });

      modal.hide();
      const draftId = await openWorkspaceCreateFromState(createState, {
        issueId,
      });
      if (!draftId) {
        await ErrorDialog.show({
          title: t('common:error'),
          message: t(
            'workspaces.createDraftError',
            'Failed to prepare workspace draft. Please try again.'
          ),
          buttonText: t('common:ok'),
        });
      }
    } finally {
      setIsLinking(false);
    }
  }, [
    modal,
    openWorkspaceCreateFromState,
    getIssue,
    issueId,
    projectId,
    remoteWorkspacesForDefaults,
    isLinking,
    activeWorkspaces,
    archivedWorkspaces,
    t,
  ]);

  const handleCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    previousFocusRef.current?.focus();
  }, []);

  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
  }, []);

  return (
    <CommandDialog
      open={modal.visible}
      onOpenChange={(open) => !open && modal.hide()}
      onCloseAutoFocus={handleCloseAutoFocus}
      onOpenAutoFocus={handleOpenAutoFocus}
    >
      <Command
        className="rounded-sm border border-border [&_[cmdk-group-heading]]:px-base [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-low [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-half [&_[cmdk-input-wrapper]_svg]:h-4 [&_[cmdk-input-wrapper]_svg]:w-4 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-base [&_[cmdk-item]]:py-half"
        loop
        filter={(value, search) => {
          if (value.toLowerCase().includes(search.toLowerCase())) return 1;
          return 0;
        }}
      >
        <div className="flex items-center border-b border-border">
          <CommandInput
            placeholder={t('kanban.linkWorkspace', 'Link workspace...')}
            value={search}
            onValueChange={setSearch}
          />
        </div>
        <CommandList className="min-h-[200px]">
          <CommandEmpty>
            {t('commandBar.noResults', 'No results found')}
          </CommandEmpty>

          <CommandGroup>
            <CommandItem
              value="__create_new__"
              onSelect={handleCreateNewWorkspace}
              disabled={isLinking}
            >
              <PlusIcon className="h-4 w-4" weight="bold" />
              <span>
                {t('kanban.createNewWorkspace', 'Create new workspace')}
              </span>
            </CommandItem>
          </CommandGroup>

          {displayedWorkspaces.length > 0 && (
            <CommandGroup heading={t('kanban.workspaces', 'Workspaces')}>
              {displayedWorkspaces.map((workspace) => (
                <CommandItem
                  key={workspace.id}
                  value={`${workspace.id} ${workspace.name} ${workspace.branch}${workspace.isArchived ? ' archived' : ''}`}
                  onSelect={() => handleLinkWorkspace(workspace.id)}
                  disabled={isLinking}
                >
                  <GitBranchIcon
                    className={`h-4 w-4 shrink-0 ${workspace.isArchived ? 'text-low' : ''}`}
                    weight="regular"
                  />
                  <span
                    className={`truncate ${workspace.isArchived ? 'text-low' : ''}`}
                  >
                    {workspace.name}
                  </span>
                  {workspace.isArchived && (
                    <span className="text-xs text-low">
                      ({t('workspaces.archived').toLowerCase()})
                    </span>
                  )}
                  <span className="ml-auto text-xs text-low truncate max-w-[120px]">
                    {workspace.branch}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!isSearching && filteredWorkspaces.length > PAGE_SIZE && (
            <div className="px-base py-half text-xs text-low text-center">
              {t('kanban.showingWorkspaces', 'Showing {{count}} of {{total}}', {
                count: PAGE_SIZE,
                total: filteredWorkspaces.length,
              })}
            </div>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/** Remote-mode content: uses UserContext for linked workspace info */
function RemoteWorkspaceSelectionContent({
  projectId,
  issueId,
}: {
  projectId: string;
  issueId: string;
}) {
  const { getWorkspacesForIssue, workspaces } = useUserContext();

  const linkedWorkspaces = useMemo(
    () => getWorkspacesForIssue(issueId),
    [getWorkspacesForIssue, issueId]
  );

  const handleLink = useCallback(
    (workspaceId: string) =>
      workspacesApi.linkToIssue(workspaceId, projectId, issueId),
    [projectId, issueId]
  );

  return (
    <WorkspaceSelectionUI
      projectId={projectId}
      issueId={issueId}
      linkedWorkspaces={linkedWorkspaces}
      remoteWorkspacesForDefaults={workspaces}
      onLinkWorkspace={handleLink}
    />
  );
}

/** Local-mode content: uses ProjectContext for linked workspace info */
function LocalWorkspaceSelectionContent({
  projectId,
  issueId,
}: {
  projectId: string;
  issueId: string;
}) {
  const { getWorkspacesForIssue } = useProjectContext();
  const queryClient = useQueryClient();

  const linkedWorkspaces = useMemo(
    () => getWorkspacesForIssue(issueId),
    [getWorkspacesForIssue, issueId]
  );

  const handleLink = useCallback(
    async (workspaceId: string) => {
      await linkWorkspaceToTask(issueId, workspaceId);
      queryClient.invalidateQueries({ queryKey: ['local', 'workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['local', 'tasks'] });
    },
    [issueId, queryClient]
  );

  return (
    <WorkspaceSelectionUI
      projectId={projectId}
      issueId={issueId}
      linkedWorkspaces={linkedWorkspaces}
      remoteWorkspacesForDefaults={[]}
      onLinkWorkspace={handleLink}
    />
  );
}

/** Wrapper that provides the right context based on mode */
function WorkspaceSelectionWithContext({
  projectId,
  issueId,
}: WorkspaceSelectionDialogProps) {
  if (!projectId) {
    return null;
  }

  if (IS_LOCAL_MODE) {
    return (
      <LocalWorkspaceSelectionContent
        projectId={projectId}
        issueId={issueId}
      />
    );
  }

  return (
    <UserProvider>
      <ProjectProvider projectId={projectId}>
        <RemoteWorkspaceSelectionContent
          projectId={projectId}
          issueId={issueId}
        />
      </ProjectProvider>
    </UserProvider>
  );
}

const WorkspaceSelectionDialogImpl = create<WorkspaceSelectionDialogProps>(
  ({ projectId, issueId }) => {
    return (
      <WorkspaceSelectionWithContext projectId={projectId} issueId={issueId} />
    );
  }
);

export const WorkspaceSelectionDialog = defineModal<
  WorkspaceSelectionDialogProps,
  void
>(WorkspaceSelectionDialogImpl);
