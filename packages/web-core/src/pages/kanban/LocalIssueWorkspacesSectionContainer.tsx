import { useMemo, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LinkIcon, PlusIcon } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useProjectWorkspaceCreateDraft } from '@/shared/hooks/useProjectWorkspaceCreateDraft';
import { unlinkWorkspaceFromTask } from '@/shared/lib/local/localApi';
import { workspacesApi } from '@/shared/lib/api';
import { getWorkspaceDefaults } from '@/shared/lib/workspaceDefaults';
import {
  buildLinkedIssueCreateState,
  buildLocalWorkspaceIdSet,
  buildWorkspaceCreateInitialState,
  buildWorkspaceCreatePrompt,
} from '@/shared/lib/workspaceCreateState';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import type { WorkspaceWithStats } from '@vibe/ui/components/IssueWorkspaceCard';
import { IssueWorkspacesSection } from '@vibe/ui/components/IssueWorkspacesSection';
import type { SectionAction } from '@vibe/ui/components/CollapsibleSectionHeader';

interface LocalIssueWorkspacesSectionContainerProps {
  issueId: string;
}

/**
 * Local-mode container for the workspaces section in the issue panel.
 * Uses ProjectContext.getWorkspacesForIssue() (wired up by LocalProjectProvider)
 * and workspace sidebar data for running status.
 */
export function LocalIssueWorkspacesSectionContainer({
  issueId,
}: LocalIssueWorkspacesSectionContainerProps) {
  const { t } = useTranslation('common');
  const { projectId } = useParams({ strict: false });
  const appNavigation = useAppNavigation();
  const queryClient = useQueryClient();
  const { openWorkspaceCreateFromState } = useProjectWorkspaceCreateDraft();

  const {
    getIssue,
    getWorkspacesForIssue,
    issues,
    isLoading,
  } = useProjectContext();
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();

  const localWorkspacesById = useMemo(() => {
    const map = new Map<string, (typeof activeWorkspaces)[number]>();
    for (const workspace of activeWorkspaces) {
      map.set(workspace.id, workspace);
    }
    for (const workspace of archivedWorkspaces) {
      map.set(workspace.id, workspace);
    }
    return map;
  }, [activeWorkspaces, archivedWorkspaces]);

  const workspacesWithStats: WorkspaceWithStats[] = useMemo(() => {
    const rawWorkspaces = getWorkspacesForIssue(issueId);

    return rawWorkspaces.map((workspace) => {
      const localWorkspace = workspace.local_workspace_id
        ? localWorkspacesById.get(workspace.local_workspace_id)
        : undefined;

      return {
        id: workspace.id,
        localWorkspaceId: workspace.local_workspace_id,
        name: workspace.name,
        archived: workspace.archived,
        filesChanged: workspace.files_changed ?? 0,
        linesAdded: workspace.lines_added ?? 0,
        linesRemoved: workspace.lines_removed ?? 0,
        prs: [],
        owner: null,
        updatedAt: workspace.updated_at,
        isOwnedByCurrentUser: true,
        isRunning: localWorkspace?.isRunning,
        hasPendingApproval: localWorkspace?.hasPendingApproval,
        hasRunningDevServer: localWorkspace?.hasRunningDevServer,
        hasUnseenActivity: localWorkspace?.hasUnseenActivity,
        latestProcessCompletedAt: localWorkspace?.latestProcessCompletedAt,
        latestProcessStatus: localWorkspace?.latestProcessStatus,
      };
    });
  }, [issueId, getWorkspacesForIssue, localWorkspacesById]);

  const shouldAnimateCreateButton = useMemo(() => {
    if (issues.length !== 1) return false;
    return issues.every(
      (issue) => getWorkspacesForIssue(issue.id).length === 0,
    );
  }, [issues, getWorkspacesForIssue]);

  const invalidateWorkspaces = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['local', 'workspaces'] });
    queryClient.invalidateQueries({ queryKey: ['local', 'tasks'] });
  }, [queryClient]);

  // Create a new workspace and link it to this task
  const handleAddWorkspace = useCallback(async () => {
    if (!projectId) return;

    const issue = getIssue(issueId);
    const initialPrompt = buildWorkspaceCreatePrompt(
      issue?.title ?? null,
      issue?.description ?? null,
    );
    const localWorkspaceIds = buildLocalWorkspaceIdSet(
      activeWorkspaces,
      archivedWorkspaces,
    );
    const defaults = await getWorkspaceDefaults(
      [],
      localWorkspaceIds,
      projectId,
    );
    const createState = buildWorkspaceCreateInitialState({
      prompt: initialPrompt,
      defaults,
      linkedIssue: buildLinkedIssueCreateState(issue, projectId),
    });

    const draftId = await openWorkspaceCreateFromState(createState, {
      issueId,
    });
    if (!draftId) {
      await ConfirmDialog.show({
        title: t('common:error'),
        message: 'Failed to prepare workspace draft. Please try again.',
        confirmText: t('common:ok'),
        showCancelButton: false,
      });
    }
  }, [
    projectId,
    openWorkspaceCreateFromState,
    getIssue,
    issueId,
    activeWorkspaces,
    archivedWorkspaces,
    t,
  ]);

  // Link an existing workspace to this task
  const handleLinkWorkspace = useCallback(async () => {
    if (!projectId) return;

    const { WorkspaceSelectionDialog } = await import(
      '@/shared/dialogs/command-bar/WorkspaceSelectionDialog'
    );
    await WorkspaceSelectionDialog.show({ projectId, issueId });
  }, [projectId, issueId]);

  // Navigate to workspace
  const handleWorkspaceClick = useCallback(
    (localWorkspaceId: string | null) => {
      if (projectId && localWorkspaceId) {
        appNavigation.goToProjectIssueWorkspace(
          projectId,
          issueId,
          localWorkspaceId,
        );
      }
    },
    [projectId, issueId, appNavigation],
  );

  // Unlink workspace from task
  const handleUnlinkWorkspace = useCallback(
    async (localWorkspaceId: string) => {
      const result = await ConfirmDialog.show({
        title: t('workspaces.unlinkFromIssue', 'Unlink workspace'),
        message: t(
          'workspaces.unlinkConfirmMessage',
          'This will remove the workspace from this issue. The workspace itself will not be deleted.',
        ),
        confirmText: t('workspaces.unlink', 'Unlink'),
        variant: 'destructive',
      });

      if (result === 'confirmed') {
        try {
          await unlinkWorkspaceFromTask(issueId, localWorkspaceId);
          invalidateWorkspaces();
        } catch (error) {
          await ConfirmDialog.show({
            title: t('common:error'),
            message:
              error instanceof Error ? error.message : 'Failed to unlink workspace',
            confirmText: t('common:ok'),
            showCancelButton: false,
          });
        }
      }
    },
    [issueId, t, invalidateWorkspaces],
  );

  // Delete workspace
  const handleDeleteWorkspace = useCallback(
    async (localWorkspaceId: string) => {
      const result = await ConfirmDialog.show({
        title: 'Delete workspace',
        message:
          'This will permanently delete this workspace and all its data. This action cannot be undone.',
        confirmText: 'Delete',
        variant: 'destructive',
      });

      if (result === 'confirmed') {
        try {
          await workspacesApi.delete(localWorkspaceId, false);
          invalidateWorkspaces();
        } catch (error) {
          await ConfirmDialog.show({
            title: t('common:error'),
            message:
              error instanceof Error ? error.message : 'Failed to delete workspace',
            confirmText: t('common:ok'),
            showCancelButton: false,
          });
        }
      }
    },
    [t, invalidateWorkspaces],
  );

  const actions: SectionAction[] = useMemo(
    () => [
      {
        icon: PlusIcon,
        onClick: handleAddWorkspace,
      },
      {
        icon: LinkIcon,
        onClick: handleLinkWorkspace,
      },
    ],
    [handleAddWorkspace, handleLinkWorkspace],
  );

  return (
    <IssueWorkspacesSection
      workspaces={workspacesWithStats}
      isLoading={isLoading}
      actions={actions}
      onWorkspaceClick={handleWorkspaceClick}
      onCreateWorkspace={handleAddWorkspace}
      onUnlinkWorkspace={handleUnlinkWorkspace}
      onDeleteWorkspace={handleDeleteWorkspace}
      shouldAnimateCreateButton={shouldAnimateCreateButton}
    />
  );
}
