import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useOrgContext } from '@/shared/hooks/useOrgContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useActions } from '@/shared/hooks/useActions';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useIsMobile } from '@/shared/hooks/useIsMobile';
import { cn } from '@/shared/lib/utils';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import {
  useUiPreferencesStore,
  resolveKanbanProjectState,
  KANBAN_ASSIGNEE_FILTER_VALUES,
  KANBAN_PROJECT_VIEW_IDS,
  type KanbanFilterState,
  type KanbanSortField,
} from '@/shared/stores/useUiPreferencesStore';
import {
  useKanbanFilters,
  PRIORITY_ORDER,
} from '../model/hooks/useKanbanFilters';
import {
  bulkUpdateIssues,
  type BulkUpdateIssueItem,
} from '@/shared/lib/remoteApi';
import { PlusIcon, DotsThreeIcon } from '@phosphor-icons/react';
import { StatusIcon } from '@vibe/ui/components/StatusIcon';
import { Actions } from '@/shared/actions';
import {
  buildKanbanIssueComposerKey,
  closeKanbanIssueComposer,
  openKanbanIssueComposer,
  type ProjectIssueCreateOptions,
  useKanbanIssueComposer,
} from '@/shared/stores/useKanbanIssueComposerStore';
import type { OrganizationMemberWithProfile } from 'shared/types';
import {
  KanbanProvider,
  KanbanBoard,
  KanbanCard,
  KanbanCards,
  KanbanHeader,
  type DropResult,
} from '@vibe/ui/components/KanbanBoard';
import { KanbanCardContent } from '@vibe/ui/components/KanbanCardContent';
import {
  IssueWorkspaceCard,
  type WorkspaceWithStats,
  type WorkspacePr,
} from '@vibe/ui/components/IssueWorkspaceCard';
import { resolveRelationshipsForIssue } from '@/shared/lib/resolveRelationships';
import { KanbanFilterBar } from '@vibe/ui/components/KanbanFilterBar';
import { ViewNavTabs } from '@vibe/ui/components/ViewNavTabs';
import { IssueListView } from '@vibe/ui/components/IssueListView';
import { CommandBarDialog } from '@/shared/dialogs/command-bar/CommandBarDialog';
import { KanbanFiltersDialog } from '@/shared/dialogs/kanban/KanbanFiltersDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@vibe/ui/components/Dropdown';
import { SearchableTagDropdownContainer } from '@/shared/components/SearchableTagDropdownContainer';
import type { IssuePriority } from 'shared/remote-types';
import { IS_LOCAL_MODE } from '@/shared/lib/local/isLocalMode';
import { useAutoCreateWorkspace } from '@/shared/hooks/useAutoCreateWorkspace';
import { DefaultRepoDialog } from '@/shared/components/DefaultRepoDialog';
import { workspacesApi, sessionsApi, configApi } from '@/shared/lib/api';
import { ApiError } from '@/shared/lib/api';
import { getAutoCreateExecutor } from '@/shared/components/DefaultRepoDialog';
import { linkWorkspaceToTask, listTaskComments } from '@/shared/lib/local/localApi';
import type { BaseCodingAgent } from 'shared/types';
import { MergeOnDoneDialog } from '@/shared/dialogs/kanban/MergeOnDoneDialog';
import { ResumeWorkDialog } from '@/shared/dialogs/kanban/ResumeWorkDialog';
import { SubTaskWorkspaceDialog } from '@/shared/dialogs/kanban/SubTaskWorkspaceDialog';
import { createLocalTask, listLocalProjects, updateLocalProject } from '@/shared/lib/local/localApi';
import { ConfirmDialog } from '@/shared/dialogs/shared/ConfirmDialog';
import { toast } from 'sonner';

const areStringSetsEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
};

const areKanbanFiltersEqual = (
  left: KanbanFilterState,
  right: KanbanFilterState
): boolean => {
  if (left.searchQuery.trim() !== right.searchQuery.trim()) {
    return false;
  }

  if (!areStringSetsEqual(left.priorities, right.priorities)) {
    return false;
  }

  if (!areStringSetsEqual(left.assigneeIds, right.assigneeIds)) {
    return false;
  }

  if (!areStringSetsEqual(left.tagIds, right.tagIds)) {
    return false;
  }

  return (
    left.sortField === right.sortField &&
    left.sortDirection === right.sortDirection
  );
};

function LoadingState() {
  const { t } = useTranslation('common');
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-low">{t('states.loading')}</p>
    </div>
  );
}

/**
 * KanbanContainer displays the kanban board using data from ProjectContext and OrgContext.
 * Must be rendered within both OrgProvider and ProjectProvider.
 */
export function KanbanContainer() {
  const isMobile = useIsMobile();
  const { t } = useTranslation('common');
  const appNavigation = useAppNavigation();
  const routeState = useCurrentKanbanRouteState();

  // Get data from contexts (set up by WorkspacesLayout)
  const {
    projectId,
    issues,
    statuses,
    tags,
    issueAssignees,
    issueTags,
    getTagObjectsForIssue,
    getTagsForIssue,
    getPullRequestsForIssue,
    getWorkspacesForIssue,
    getRelationshipsForIssue,
    issuesById,
    insertIssueTag,
    removeIssueTag,
    insertTag,
    updateIssue,
    pullRequests,
    isLoading: projectLoading,
    onBulkStatusUpdate,
  } = useProjectContext();

  const {
    projects,
    membersWithProfilesById,
    isLoading: orgLoading,
  } = useOrgContext();
  const { activeWorkspaces } = useWorkspaceContext();
  const { userId } = useAuth();
  const { triggerAutoCreate } = useAutoCreateWorkspace(projectId);
  const queryClient = useQueryClient();

  // Auto-pickup toggle (local mode only)
  const localProjectsQuery = useQuery({
    queryKey: ['local', 'projects'],
    queryFn: listLocalProjects,
    enabled: IS_LOCAL_MODE,
  });
  const autoPickupEnabled = IS_LOCAL_MODE
    ? localProjectsQuery.data?.find((p) => p.id === projectId)?.auto_pickup_enabled ?? false
    : false;
  const toggleAutoPickupMutation = useMutation({
    mutationFn: (enabled: boolean) => updateLocalProject(projectId, { auto_pickup_enabled: enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['local', 'projects'] }),
  });

  // Get project name by finding the project matching current projectId
  const projectName = projects.find((p) => p.id === projectId)?.name ?? '';

  const selectedKanbanIssueId = routeState.issueId;
  const issueComposerKey = useMemo(
    () => buildKanbanIssueComposerKey(routeState.hostId, projectId),
    [routeState.hostId, projectId]
  );
  const issueComposer = useKanbanIssueComposer(issueComposerKey);
  const isIssueComposerOpen = issueComposer !== null;
  const openIssue = useCallback(
    (issueId: string) => {
      if (isIssueComposerOpen) {
        closeKanbanIssueComposer(issueComposerKey);
      }

      appNavigation.goToProjectIssue(projectId, issueId);
    },
    [isIssueComposerOpen, issueComposerKey, appNavigation, projectId]
  );
  const openIssueWorkspace = useCallback(
    (issueId: string, workspaceAttemptId: string) => {
      appNavigation.goToProjectIssueWorkspace(
        projectId,
        issueId,
        workspaceAttemptId
      );
    },
    [appNavigation, projectId]
  );
  const startCreate = useCallback(
    (options?: ProjectIssueCreateOptions) => {
      openKanbanIssueComposer(issueComposerKey, options);
    },
    [issueComposerKey]
  );

  // Get setter and executor from ActionsContext
  const {
    setDefaultCreateStatusId,
    executeAction,
    openPrioritySelection,
    openAssigneeSelection,
  } = useActions();
  const openProjectsGuide = useCallback(() => {
    executeAction(Actions.ProjectsGuide);
  }, [executeAction]);

  const projectViewSelection = useUiPreferencesStore(
    (s) => s.kanbanProjectViewSelections[projectId]
  );
  const projectViewPreferencesById = useUiPreferencesStore(
    (s) => s.kanbanProjectViewPreferences[projectId]
  );
  const setKanbanProjectView = useUiPreferencesStore(
    (s) => s.setKanbanProjectView
  );
  const setKanbanProjectViewFilters = useUiPreferencesStore(
    (s) => s.setKanbanProjectViewFilters
  );
  const setKanbanProjectViewShowSubIssues = useUiPreferencesStore(
    (s) => s.setKanbanProjectViewShowSubIssues
  );
  const setKanbanProjectViewShowWorkspaces = useUiPreferencesStore(
    (s) => s.setKanbanProjectViewShowWorkspaces
  );
  const clearKanbanProjectViewPreferences = useUiPreferencesStore(
    (s) => s.clearKanbanProjectViewPreferences
  );
  const resolvedProjectState = useMemo(
    () => resolveKanbanProjectState(projectViewSelection),
    [projectViewSelection]
  );
  const {
    activeViewId,
    filters: defaultKanbanFilters,
    showSubIssues: defaultShowSubIssues,
    showWorkspaces: defaultShowWorkspaces,
  } = resolvedProjectState;
  const projectViewPreferences = projectViewPreferencesById?.[activeViewId];
  const kanbanFilters = projectViewPreferences?.filters ?? defaultKanbanFilters;
  const showSubIssues =
    projectViewPreferences?.showSubIssues ?? defaultShowSubIssues;
  const showWorkspaces =
    projectViewPreferences?.showWorkspaces ?? defaultShowWorkspaces;

  const hasActiveFilters = useMemo(
    () =>
      !areKanbanFiltersEqual(kanbanFilters, defaultKanbanFilters) ||
      showSubIssues !== defaultShowSubIssues ||
      showWorkspaces !== defaultShowWorkspaces,
    [
      kanbanFilters,
      defaultKanbanFilters,
      showSubIssues,
      defaultShowSubIssues,
      showWorkspaces,
      defaultShowWorkspaces,
    ]
  );
  const shouldAnimateCreateButton = issues.length === 0;

  const { filteredIssues } = useKanbanFilters({
    issues,
    issueAssignees,
    issueTags,
    filters: kanbanFilters,
    showSubIssues,
    currentUserId: userId,
  });

  const setKanbanSearchQuery = useCallback(
    (searchQuery: string) => {
      setKanbanProjectViewFilters(projectId, activeViewId, {
        ...kanbanFilters,
        searchQuery,
      });
    },
    [activeViewId, kanbanFilters, projectId, setKanbanProjectViewFilters]
  );

  const setKanbanPriorities = useCallback(
    (priorities: IssuePriority[]) => {
      setKanbanProjectViewFilters(projectId, activeViewId, {
        ...kanbanFilters,
        priorities,
      });
    },
    [activeViewId, kanbanFilters, projectId, setKanbanProjectViewFilters]
  );

  const setKanbanAssignees = useCallback(
    (assigneeIds: string[]) => {
      setKanbanProjectViewFilters(projectId, activeViewId, {
        ...kanbanFilters,
        assigneeIds,
      });
    },
    [activeViewId, kanbanFilters, projectId, setKanbanProjectViewFilters]
  );

  const setKanbanTags = useCallback(
    (tagIds: string[]) => {
      setKanbanProjectViewFilters(projectId, activeViewId, {
        ...kanbanFilters,
        tagIds,
      });
    },
    [activeViewId, kanbanFilters, projectId, setKanbanProjectViewFilters]
  );

  const setKanbanSort = useCallback(
    (sortField: KanbanSortField, sortDirection: 'asc' | 'desc') => {
      setKanbanProjectViewFilters(projectId, activeViewId, {
        ...kanbanFilters,
        sortField,
        sortDirection,
      });
    },
    [activeViewId, kanbanFilters, projectId, setKanbanProjectViewFilters]
  );

  const setShowSubIssues = useCallback(
    (show: boolean) => {
      setKanbanProjectViewShowSubIssues(projectId, activeViewId, show);
    },
    [activeViewId, projectId, setKanbanProjectViewShowSubIssues]
  );

  const setShowWorkspaces = useCallback(
    (show: boolean) => {
      setKanbanProjectViewShowWorkspaces(projectId, activeViewId, show);
    },
    [activeViewId, projectId, setKanbanProjectViewShowWorkspaces]
  );

  const clearKanbanFilters = useCallback(() => {
    clearKanbanProjectViewPreferences(projectId, activeViewId);
  }, [activeViewId, clearKanbanProjectViewPreferences, projectId]);

  const handleKanbanProjectViewChange = useCallback(
    (viewId: string) => {
      setKanbanProjectView(projectId, viewId);
    },
    [projectId, setKanbanProjectView]
  );
  const kanbanViewMode = useUiPreferencesStore((s) => s.kanbanViewMode);
  const listViewStatusFilter = useUiPreferencesStore(
    (s) => s.listViewStatusFilter
  );
  const setKanbanViewMode = useUiPreferencesStore((s) => s.setKanbanViewMode);
  const setListViewStatusFilter = useUiPreferencesStore(
    (s) => s.setListViewStatusFilter
  );
  // Reset view mode when navigating projects
  const prevProjectIdRef = useRef<string | null>(null);

  // Track when drag-drop sync is in progress to prevent flicker
  const isSyncingRef = useRef(false);

  // Keep latest onBulkStatusUpdate in a ref to avoid stale closures in handleDragEnd
  const onBulkStatusUpdateRef = useRef(onBulkStatusUpdate);
  onBulkStatusUpdateRef.current = onBulkStatusUpdate;

  useEffect(() => {
    if (
      prevProjectIdRef.current !== null &&
      prevProjectIdRef.current !== projectId
    ) {
      setKanbanViewMode('kanban');
      setListViewStatusFilter(null);
    }

    prevProjectIdRef.current = projectId;
  }, [projectId, setKanbanViewMode, setListViewStatusFilter]);

  // Sort all statuses for display settings
  const sortedStatuses = useMemo(
    () => [...statuses].sort((a, b) => a.sort_order - b.sort_order),
    [statuses]
  );

  // Filter statuses: visible (non-hidden) for kanban, hidden for tabs
  const visibleStatuses = useMemo(
    () => sortedStatuses.filter((s) => !s.hidden),
    [sortedStatuses]
  );

  // Map status ID to 1-based column index for sort_order calculation
  const statusColumnIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    visibleStatuses.forEach((status, index) => {
      map.set(status.id, index + 1);
    });
    return map;
  }, [visibleStatuses]);

  const hiddenStatuses = useMemo(
    () => sortedStatuses.filter((s) => s.hidden),
    [sortedStatuses]
  );

  const defaultCreateStatusId = useMemo(() => {
    if (kanbanViewMode === 'kanban') {
      return visibleStatuses[0]?.id;
    }
    if (listViewStatusFilter) {
      return listViewStatusFilter;
    }
    return sortedStatuses[0]?.id;
  }, [kanbanViewMode, visibleStatuses, listViewStatusFilter, sortedStatuses]);

  // Update default create status for command bar based on current tab
  useEffect(() => {
    setDefaultCreateStatusId(defaultCreateStatusId);
  }, [defaultCreateStatusId, setDefaultCreateStatusId]);

  const createAssigneeIds = useMemo(() => {
    const assigneeIds = new Set<string>();

    for (const assigneeId of kanbanFilters.assigneeIds) {
      if (assigneeId === KANBAN_ASSIGNEE_FILTER_VALUES.UNASSIGNED) {
        continue;
      }

      if (assigneeId === KANBAN_ASSIGNEE_FILTER_VALUES.SELF) {
        if (userId) {
          assigneeIds.add(userId);
        }
        continue;
      }

      assigneeIds.add(assigneeId);
    }

    return [...assigneeIds];
  }, [kanbanFilters.assigneeIds, userId]);

  // Get statuses to display in list view (all or filtered to one)
  const listViewStatuses = useMemo(() => {
    if (listViewStatusFilter) {
      return sortedStatuses.filter((s) => s.id === listViewStatusFilter);
    }
    return sortedStatuses;
  }, [sortedStatuses, listViewStatusFilter]);

  // Track items as arrays of IDs grouped by status
  const [items, setItems] = useState<Record<string, string[]>>({});
  const [isFiltersDialogOpen, setIsFiltersDialogOpen] = useState(false);
  const [isDefaultRepoOpen, setIsDefaultRepoOpen] = useState(false);

  // Sync items from filtered issues when they change
  useEffect(() => {
    // Skip rebuild during drag-drop sync to prevent flicker
    if (isSyncingRef.current) {
      return;
    }

    const { sortField, sortDirection } = kanbanFilters;
    const grouped: Record<string, string[]> = {};

    for (const status of statuses) {
      // Filter issues for this status
      let statusIssues = filteredIssues.filter(
        (i) => i.status_id === status.id
      );

      // Sort within column based on user preference
      statusIssues = [...statusIssues].sort((a, b) => {
        let comparison = 0;
        switch (sortField) {
          case 'priority':
            comparison =
              (a.priority ? PRIORITY_ORDER[a.priority] : Infinity) -
              (b.priority ? PRIORITY_ORDER[b.priority] : Infinity);
            break;
          case 'created_at':
            comparison =
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime();
            break;
          case 'updated_at':
            comparison =
              new Date(a.updated_at).getTime() -
              new Date(b.updated_at).getTime();
            break;
          case 'title':
            comparison = a.title.localeCompare(b.title);
            break;
          case 'sort_order':
          default:
            comparison = a.sort_order - b.sort_order;
        }
        return sortDirection === 'desc' ? -comparison : comparison;
      });

      grouped[status.id] = statusIssues.map((i) => i.id);
    }
    setItems(grouped);
  }, [filteredIssues, statuses, kanbanFilters]);

  // Create a lookup map for issue data
  const issueMap = useMemo(() => {
    const map: Record<string, (typeof issues)[0]> = {};
    for (const issue of issues) {
      map[issue.id] = issue;
    }
    return map;
  }, [issues]);

  // Create a lookup map for issue assignees (issue_id -> OrganizationMemberWithProfile[])
  const issueAssigneesMap = useMemo(() => {
    const map: Record<string, OrganizationMemberWithProfile[]> = {};
    for (const assignee of issueAssignees) {
      const member = membersWithProfilesById.get(assignee.user_id);
      if (member) {
        if (!map[assignee.issue_id]) {
          map[assignee.issue_id] = [];
        }
        map[assignee.issue_id].push(member);
      }
    }
    return map;
  }, [issueAssignees, membersWithProfilesById]);

  const membersWithProfiles = useMemo(
    () => [...membersWithProfilesById.values()],
    [membersWithProfilesById]
  );

  const localWorkspacesById = useMemo(() => {
    const map = new Map<string, (typeof activeWorkspaces)[number]>();

    for (const workspace of activeWorkspaces) {
      map.set(workspace.id, workspace);
    }

    return map;
  }, [activeWorkspaces]);

  const prsByWorkspaceId = useMemo(() => {
    const map = new Map<string, WorkspacePr[]>();

    for (const pr of pullRequests) {
      if (!pr.workspace_id) continue;

      const prs = map.get(pr.workspace_id) ?? [];
      prs.push({
        number: pr.number,
        url: pr.url,
        status: pr.status as 'open' | 'merged' | 'closed',
      });
      map.set(pr.workspace_id, prs);
    }

    return map;
  }, [pullRequests]);

  const workspacesByIssueId = useMemo(() => {
    if (!showWorkspaces) {
      return new Map<string, WorkspaceWithStats[]>();
    }

    const map = new Map<string, WorkspaceWithStats[]>();

    for (const issue of issues) {
      const nonArchivedWorkspaces = getWorkspacesForIssue(issue.id)
        .filter(
          (workspace) =>
            !workspace.archived &&
            !!workspace.local_workspace_id &&
            localWorkspacesById.has(workspace.local_workspace_id)
        )
        .map((workspace) => {
          const localWorkspace = localWorkspacesById.get(
            workspace.local_workspace_id!
          );

          return {
            id: workspace.id,
            localWorkspaceId: workspace.local_workspace_id,
            name: workspace.name,
            archived: workspace.archived,
            filesChanged: workspace.files_changed ?? 0,
            linesAdded: workspace.lines_added ?? 0,
            linesRemoved: workspace.lines_removed ?? 0,
            prs: prsByWorkspaceId.get(workspace.id) ?? [],
            owner: membersWithProfilesById.get(workspace.owner_user_id) ?? null,
            updatedAt: workspace.updated_at,
            isOwnedByCurrentUser: workspace.owner_user_id === userId,
            isRunning: localWorkspace?.isRunning,
            hasPendingApproval: localWorkspace?.hasPendingApproval,
            hasRunningDevServer: localWorkspace?.hasRunningDevServer,
            hasUnseenActivity: localWorkspace?.hasUnseenActivity,
            latestProcessCompletedAt: localWorkspace?.latestProcessCompletedAt,
            latestProcessStatus: localWorkspace?.latestProcessStatus,
          };
        });

      if (nonArchivedWorkspaces.length > 0) {
        map.set(issue.id, nonArchivedWorkspaces);
      }
    }

    return map;
  }, [
    showWorkspaces,
    issues,
    getWorkspacesForIssue,
    localWorkspacesById,
    prsByWorkspaceId,
    membersWithProfilesById,
    userId,
  ]);

  // Calculate sort_order based on column index and issue position
  // Formula: 1000 * [COLUMN_INDEX] + [ISSUE_INDEX] (both 1-based)
  const calculateSortOrder = useCallback(
    (statusId: string, issueIndex: number): number => {
      const columnIndex = statusColumnIndexMap.get(statusId) ?? 1;
      return 1000 * columnIndex + (issueIndex + 1);
    },
    [statusColumnIndexMap]
  );

  // Build "Implementation Notes from Completed Sub-tasks" section for prompts.
  // Fetches the most recent agent comment from each completed/in_review sibling.
  const buildSiblingCommentsSection = useCallback(
    async (parentIssueId: string, currentTaskId: string): Promise<string> => {
      const siblingTasks = issues.filter(
        (i) =>
          i.parent_issue_id === parentIssueId &&
          i.id !== currentTaskId &&
          (i.status_id === 'in_review' || i.status_id === 'done')
      );

      if (siblingTasks.length === 0) return '';

      const entries: { title: string; status: string; content: string }[] = [];
      for (const sib of siblingTasks) {
        try {
          const comments = await listTaskComments(sib.id);
          // Get the most recent agent comment
          const agentComments = comments.filter((c) => c.author_type === 'agent');
          const latest = agentComments[agentComments.length - 1];
          if (latest) {
            entries.push({
              title: sib.title,
              status: sib.status_id,
              content: latest.content,
            });
          }
        } catch {
          // Skip siblings whose comments fail to load
        }
      }

      if (entries.length === 0) return '';

      // Truncate older siblings first to stay under ~2000 chars total
      const MAX_TOTAL = 2000;
      const totalLen = entries.reduce((sum, e) => sum + e.content.length, 0);
      if (totalLen > MAX_TOTAL) {
        let remaining = MAX_TOTAL;
        for (let i = entries.length - 1; i >= 0; i--) {
          if (remaining === 0) {
            entries[i].content = '[truncated]';
          } else if (entries[i].content.length > remaining) {
            entries[i].content =
              entries[i].content.slice(0, remaining) + '...[truncated]';
            remaining = 0;
          } else {
            remaining -= entries[i].content.length;
          }
        }
      }

      let section = '\n## Implementation Notes from Completed Sub-tasks\n';
      for (const e of entries) {
        const marker = e.status === 'done' ? 'done' : 'in review';
        section += `### Sub-task: "${e.title}" (${marker})\n${e.content}\n\n`;
      }
      return section;
    },
    [issues]
  );

  // When a parent ticket with sub-tasks is dragged to "in_progress", let the
  // user choose which sub-task the agent should work on first.
  const triggerResumeWork = useCallback(
    async (issueId: string): Promise<boolean> => {
      const issue = issuesById.get(issueId);
      if (!issue) return false;

      const subTasks = issues.filter((i) => i.parent_issue_id === issueId);
      if (subTasks.length === 0) return false;

      const result = await ResumeWorkDialog.show({
        parentTitle: issue.title,
        subTasks: subTasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status_id,
        })),
      });

      if (result.type === 'cancel') {
        // Revert parent back to previous status
        updateIssue(issueId, { status_id: issue.status_id });
        return true; // handled — don't auto-create
      }

      if (result.type === 'subtask') {
        const subTask = issuesById.get(result.subtaskId);
        // Check if parent already has a workspace we can reuse
        const parentWorkspaces = getWorkspacesForIssue(issueId);
        const parentWsId = parentWorkspaces[0]?.local_workspace_id;

        if (parentWsId) {
          // Reuse the parent's workspace with a fresh session (clean context)
          try {
            // Re-link workspace to the sub-task
            await linkWorkspaceToTask(result.subtaskId, parentWsId);

            // Move sub-task to in_progress; parent stays in_progress
            // (parent will transition to in_review once all sub-tasks complete)
            updateIssue(result.subtaskId, { status_id: 'in_progress' });

            // Resolve executor config
            const systemInfo = await configApi.getConfig();
            const executors = systemInfo.executors ?? {};
            const executorKeys = Object.keys(executors);
            const savedExecutor = getAutoCreateExecutor(projectId);
            const executorName =
              (savedExecutor && executorKeys.includes(savedExecutor)
                ? savedExecutor
                : null) ??
              (executorKeys.includes('CLAUDE_CODE') ? 'CLAUDE_CODE' : null) ??
              executorKeys[0];

            if (executorName) {
              // Create a fresh session on the same workspace so the agent
              // starts with a clean context instead of the previous sub-task's history
              const newSession = await sessionsApi.create({
                workspace_id: parentWsId,
                executor: executorName,
              });

              // Build enriched prompt with parent context and sibling statuses
              const subTitle = subTask?.title ?? 'Untitled sub-task';
              const subDesc = subTask?.description ?? '';
              const siblingTasks = issues.filter(
                (i) => i.parent_issue_id === issueId
              );

              const statusLabel = (s: string) => {
                switch (s) {
                  case 'done': return '[done]';
                  case 'in_review': return '[in review]';
                  case 'in_progress': return '[in progress]';
                  case 'cancelled': return '[cancelled]';
                  default: return '[ready]';
                }
              };

              const siblingLines = siblingTasks
                .map((t) => {
                  const marker = statusLabel(t.status_id);
                  const here = t.id === result.subtaskId ? '  <-- you are here' : '';
                  return `- ${marker} ${t.title}${here}`;
                })
                .join('\n');

              // Fetch completed sibling comments for context
              const siblingCommentsSection = await buildSiblingCommentsSection(
                issueId,
                result.subtaskId
              );

              let prompt = `You are working on a sub-task as part of a larger effort.\n\n`;
              prompt += `## Parent Task\nTitle: ${issue.title}\n`;
              if (issue.description) {
                prompt += `Description: ${issue.description}\n`;
              }
              if (siblingLines) {
                prompt += `\n## Sub-tasks\n${siblingLines}\n`;
              }
              if (siblingCommentsSection) {
                prompt += siblingCommentsSection;
              }
              prompt += `\n## Your Task\nImplement the following:\n\nTitle: ${subTitle}\n`;
              if (subDesc) {
                prompt += `\nDescription: ${subDesc}\n`;
              }
              prompt += `\nThe workspace and branch were created for the parent task. Previous sub-tasks have already been implemented on this branch. Build on the existing work.`;

              await sessionsApi.followUp(newSession.id, {
                prompt,
                executor_config: {
                  executor: executorName as BaseCodingAgent,
                },
                retry_process_id: null,
                force_when_dirty: null,
                perform_git_reset: null,
              });
            }

            queryClient.invalidateQueries({ queryKey: ['local', 'tasks'] });
            queryClient.invalidateQueries({ queryKey: ['local', 'workspaces'] });
          } catch (err) {
            console.error('[ResumeWork] Failed to reuse parent workspace:', err);
          }
        } else {
          // No parent workspace — create a new one for the sub-task
          updateIssue(result.subtaskId, { status_id: 'in_progress' });
          const hasWorkspaces =
            getWorkspacesForIssue(result.subtaskId).length > 0;
          triggerAutoCreate(result.subtaskId, subTask, hasWorkspaces);
        }
        return true; // handled — don't auto-create for parent
      }

      return true; // cancel was handled above
    },
    [issues, issuesById, updateIssue, getWorkspacesForIssue, triggerAutoCreate, projectId, queryClient, buildSiblingCommentsSection]
  );

  // When a sub-task is dragged to "in_progress", ask whether to reuse the
  // parent's workspace or create a new one.
  // Returns true if handled (dialog shown), false to fall through to normal auto-create.
  const triggerSubTaskWorkspace = useCallback(
    async (issueId: string): Promise<boolean> => {
      const issue = issuesById.get(issueId);
      if (!issue?.parent_issue_id) return false;

      // Find the parent's workspace
      const parentWorkspaces = getWorkspacesForIssue(issue.parent_issue_id);
      const parentWs = parentWorkspaces[0];
      if (!parentWs?.local_workspace_id) return false;

      const parentIssue = issuesById.get(issue.parent_issue_id);

      let workspaceName: string;
      try {
        const ws = await workspacesApi.get(parentWs.local_workspace_id);
        workspaceName = ws.name || ws.branch || 'parent workspace';
      } catch {
        workspaceName = 'parent workspace';
      }

      const result = await SubTaskWorkspaceDialog.show({
        subTaskTitle: issue.title,
        parentTitle: parentIssue?.title ?? 'Parent task',
        parentWorkspaceName: workspaceName,
      });

      if (result === 'cancel') {
        // Revert to previous status
        updateIssue(issueId, { status_id: issue.status_id });
        return true;
      }

      if (result === 'reuse') {
        const parentWsId = parentWs.local_workspace_id;
        try {
          await linkWorkspaceToTask(issueId, parentWsId);

          // Parent stays in_progress — it will transition to in_review
          // once all sub-tasks are complete.

          // Start a fresh session on the same workspace (clean context)
          const systemInfo = await configApi.getConfig();
          const executors = systemInfo.executors ?? {};
          const executorKeys = Object.keys(executors);
          const savedExecutor = getAutoCreateExecutor(projectId);
          const executorName =
            (savedExecutor && executorKeys.includes(savedExecutor)
              ? savedExecutor
              : null) ??
            (executorKeys.includes('CLAUDE_CODE') ? 'CLAUDE_CODE' : null) ??
            executorKeys[0];

          if (executorName) {
            const newSession = await sessionsApi.create({
              workspace_id: parentWsId,
              executor: executorName,
            });

            // Build enriched prompt with parent context and sibling statuses
            const siblingTasks = issues.filter(
              (i) => i.parent_issue_id === issue.parent_issue_id
            );

            const statusLabel = (s: string) => {
              switch (s) {
                case 'done': return '[done]';
                case 'in_review': return '[in review]';
                case 'in_progress': return '[in progress]';
                case 'cancelled': return '[cancelled]';
                default: return '[ready]';
              }
            };

            const siblingLines = siblingTasks
              .map((t) => {
                const marker = statusLabel(t.status_id);
                const here = t.id === issueId ? '  <-- you are here' : '';
                return `- ${marker} ${t.title}${here}`;
              })
              .join('\n');

            // Fetch completed sibling comments for context
            const siblingCommentsSection = await buildSiblingCommentsSection(
              issue.parent_issue_id!,
              issueId
            );

            let prompt = `You are working on a sub-task as part of a larger effort.\n\n`;
            prompt += `## Parent Task\nTitle: ${parentIssue?.title ?? 'Parent task'}\n`;
            if (parentIssue?.description) {
              prompt += `Description: ${parentIssue.description}\n`;
            }
            if (siblingLines) {
              prompt += `\n## Sub-tasks\n${siblingLines}\n`;
            }
            if (siblingCommentsSection) {
              prompt += siblingCommentsSection;
            }
            prompt += `\n## Your Task\nImplement the following:\n\nTitle: ${issue.title}\n`;
            if (issue.description) {
              prompt += `\nDescription: ${issue.description}\n`;
            }
            prompt += `\nThe workspace and branch were created for the parent task. Previous sub-tasks have already been implemented on this branch. Build on the existing work.`;

            await sessionsApi.followUp(newSession.id, {
              prompt,
              executor_config: {
                executor: executorName as BaseCodingAgent,
              },
              retry_process_id: null,
              force_when_dirty: null,
              perform_git_reset: null,
            });
          }

          queryClient.invalidateQueries({ queryKey: ['local', 'tasks'] });
          queryClient.invalidateQueries({ queryKey: ['local', 'workspaces'] });
        } catch (err) {
          console.error('[SubTaskWorkspace] Failed to reuse parent workspace:', err);
        }
        return true;
      }

      // result === 'new' — fall through to normal auto-create
      return false;
    },
    [issuesById, getWorkspacesForIssue, updateIssue, projectId, queryClient, buildSiblingCommentsSection]
  );

  // Perform the actual merge operation for a workspace, handling conflicts and rebase.
  // Returns true if merge succeeded, false if it failed (caller should revert statuses).
  // Helper: prompt user to create a conflict-resolution subtask under the parent task.
  const promptConflictSubtask = useCallback(
    async (
      title: string,
      dialogTitle: string,
      dialogMessage: string,
      description: string,
      parentTaskId: string,
    ) => {
      const confirmCreate = await ConfirmDialog.show({
        title: dialogTitle,
        message: dialogMessage,
        confirmText: 'Create Task',
        cancelText: 'Skip',
      });
      if (confirmCreate === 'confirmed') {
        try {
          const projects = await listLocalProjects();
          if (projects.length > 0) {
            await createLocalTask({
              project_id: projects[0]!.id,
              title,
              description,
              status: 'todo',
              parent_task_id: parentTaskId,
            });
            toast.success('Conflict resolution task created');
            queryClient.invalidateQueries({ queryKey: ['local', 'tasks'] });
          }
        } catch (taskErr) {
          console.error('Failed to create conflict task:', taskErr);
          toast.error('Failed to create conflict task');
        }
      }
    },
    [queryClient],
  );

  const performMerge = useCallback(
    async (localWsId: string, workspace: { name: string | null; branch: string }, unmergedRepos: { repo_id: string; repo_name: string; target_branch_name: string }[], parentTaskId: string): Promise<boolean> => {
      let allSucceeded = true;

      for (const repo of unmergedRepos) {
        try {
          await workspacesApi.merge(localWsId, {
            repo_id: repo.repo_id,
          });
          toast.success('Branch merged successfully');
        } catch (err) {
          // Check for merge conflicts
          if (
            err instanceof ApiError &&
            err.error_data &&
            typeof err.error_data === 'object' &&
            'type' in err.error_data &&
            (err.error_data as { type: string }).type === 'merge_conflicts'
          ) {
            allSucceeded = false;
            const conflictData = err.error_data as {
              conflicted_files: string[];
              target_branch: string;
            };
            const fileList = conflictData.conflicted_files.slice(0, 10);
            const moreCount = Math.max(0, conflictData.conflicted_files.length - 10);
            await promptConflictSubtask(
              `Resolve merge conflicts: ${workspace.name || workspace.branch}`,
              'Merge Conflicts Detected',
              `Cannot merge "${workspace.branch}" into "${conflictData.target_branch}" — conflicts in:\n\n${fileList.map((f) => `  • ${f}`).join('\n')}${moreCount > 0 ? `\n  ...and ${moreCount} more` : ''}\n\nCreate a sub-task to resolve these conflicts?`,
              `Merge of branch "${workspace.branch}" into "${conflictData.target_branch}" failed due to conflicts.\n\nConflicted files:\n${conflictData.conflicted_files.map((f) => `- ${f}`).join('\n')}\n\nResolve these conflicts and then merge the branch.`,
              parentTaskId,
            );
          } else if (
            err instanceof ApiError &&
            (err.message?.includes('commits ahead') || err.status === 409)
          ) {
            // Branch diverged — try rebase then merge
            // (This path should rarely trigger now that the backend auto-rebases,
            // but kept as a fallback for edge cases.)
            try {
              const rebaseResult = await workspacesApi.rebase(localWsId, {
                repo_id: repo.repo_id,
                old_base_branch: null,
                new_base_branch: null,
              });
              if (rebaseResult.success) {
                try {
                  await workspacesApi.merge(localWsId, {
                    repo_id: repo.repo_id,
                  });
                  toast.success('Branch rebased and merged successfully');
                } catch (retryErr) {
                  allSucceeded = false;
                  if (
                    retryErr instanceof ApiError &&
                    retryErr.error_data &&
                    typeof retryErr.error_data === 'object' &&
                    'type' in retryErr.error_data &&
                    (retryErr.error_data as { type: string }).type === 'merge_conflicts'
                  ) {
                    const conflictData = retryErr.error_data as {
                      conflicted_files: string[];
                      target_branch: string;
                    };
                    await promptConflictSubtask(
                      `Resolve merge conflicts: ${workspace.name || workspace.branch}`,
                      'Merge Conflicts After Rebase',
                      `Rebased successfully but merge has conflicts in ${conflictData.conflicted_files.length} file(s). Create a sub-task to resolve them?`,
                      `Merge of branch "${workspace.branch}" into "${conflictData.target_branch}" failed due to conflicts after rebase.\n\nConflicted files:\n${conflictData.conflicted_files.map((f) => `- ${f}`).join('\n')}\n\nResolve these conflicts and then merge the branch.`,
                      parentTaskId,
                    );
                  } else {
                    toast.error('Merge failed after rebase');
                    console.error('Merge failed after rebase:', retryErr);
                  }
                }
              } else {
                allSucceeded = false;
                // Rebase returned a non-success result — check for conflict details
                const rebaseError = rebaseResult.error_data;
                const hasConflictFiles =
                  rebaseError &&
                  typeof rebaseError === 'object' &&
                  'conflicted_files' in rebaseError;

                if (hasConflictFiles) {
                  const conflictData = rebaseError as {
                    conflicted_files: string[];
                    target_branch: string;
                  };
                  await promptConflictSubtask(
                    `Resolve rebase conflicts: ${workspace.name || workspace.branch}`,
                    'Rebase Conflicts',
                    `Your branch "${workspace.branch}" has conflicts with the target branch that need to be resolved before merging.\n\n${conflictData.conflicted_files.length} conflicting file(s):\n${conflictData.conflicted_files.slice(0, 5).map((f) => `  • ${f}`).join('\n')}${conflictData.conflicted_files.length > 5 ? `\n  ...and ${conflictData.conflicted_files.length - 5} more` : ''}\n\nCreate a sub-task to resolve these?`,
                    `Rebase of branch "${workspace.branch}" onto "${conflictData.target_branch ?? repo.target_branch_name}" failed due to conflicts.\n\nConflicted files:\n${conflictData.conflicted_files.map((f) => `- ${f}`).join('\n')}\n\nResolve these conflicts and complete the merge manually.`,
                    parentTaskId,
                  );
                } else {
                  // No conflict details — show the API message which usually
                  // explains the issue (e.g. uncommitted changes)
                  const errorMsg = rebaseResult.message || 'Unknown error during rebase';

                  if (errorMsg.includes('uncommitted changes')) {
                    toast.error('Cannot rebase — workspace has uncommitted changes. Commit or revert them, then try merging again.', { duration: 8000 });
                  } else {
                    toast.error(`Rebase failed: ${errorMsg}`, { duration: 8000 });
                  }
                  console.error('Rebase failed:', rebaseResult);
                }
              }
            } catch (rebaseErr) {
              allSucceeded = false;
              const errMsg = rebaseErr instanceof ApiError ? rebaseErr.message : 'Unknown error';
              toast.error(`Rebase failed: ${errMsg}`);
              console.error('Rebase request failed:', rebaseErr);
            }
          } else {
            allSucceeded = false;
            const errMsg = err instanceof ApiError ? err.message : 'Unknown error';
            toast.error(`Merge failed: ${errMsg}`);
            console.error('Merge failed:', err);
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: ['local', 'tasks'] });
      queryClient.invalidateQueries({ queryKey: ['local', 'workspaces'] });
      return allSucceeded;
    },
    [queryClient, promptConflictSubtask]
  );

  // Check for unmerged branches when moving a task to "done" from "in_review"
  const triggerMergeOnDone = useCallback(
    async (issueId: string) => {
      const issue = issuesById.get(issueId);
      const isSubTask = !!issue?.parent_issue_id;
      const parentId = isSubTask ? issue.parent_issue_id! : issueId;

      // For sub-tasks, find workspace via parent; for parents, find directly
      const wsForIssue = isSubTask
        ? getWorkspacesForIssue(parentId)
        : getWorkspacesForIssue(issueId);
      if (wsForIssue.length === 0) return;

      const localWsId = wsForIssue[0]?.local_workspace_id;
      if (!localWsId) return;

      try {
        const branchStatuses = await workspacesApi.getBranchStatus(localWsId);
        const unmergedRepos = branchStatuses.filter(
          (s) => (s.commits_ahead ?? 0) > 0
        );

        if (unmergedRepos.length === 0) return; // already merged

        const workspace = await workspacesApi.get(localWsId);

        if (isSubTask) {
          // Sub-task variant: show "Merge All" dialog
          const siblingCount = issues.filter(
            (i) =>
              i.parent_issue_id === parentId &&
              i.id !== issueId
          ).length;

          const parentIssue = issuesById.get(parentId);

          const result = await MergeOnDoneDialog.show({
            workspaceName: workspace.name || workspace.branch,
            repos: unmergedRepos.map((s) => ({
              repoId: s.repo_id,
              repoName: s.repo_name,
              targetBranch: s.target_branch_name,
            })),
            subTaskContext: {
              parentTitle: parentIssue?.title ?? 'Parent task',
              siblingCount,
            },
          });

          if (result === 'cancel') {
            const localHandler = onBulkStatusUpdateRef.current;
            if (localHandler) {
              await localHandler([
                { id: issueId, changes: { status_id: 'in_review' } },
              ]);
            }
            return;
          }

          if (result === 'merge_all') {
            const mergeOk = await performMerge(localWsId, workspace, unmergedRepos, parentId);
            if (!mergeOk) {
              // Merge failed — revert sub-task back to in_review
              const localHandler = onBulkStatusUpdateRef.current;
              if (localHandler) {
                await localHandler([
                  { id: issueId, changes: { status_id: 'in_review' } },
                ]);
              }
              return;
            }

            // Transition parent + all sub-tasks to done
            const allRelated = issues.filter(
              (i) =>
                (i.id === parentId || i.parent_issue_id === parentId) &&
                i.status_id !== 'done' &&
                i.status_id !== 'cancelled'
            );
            if (allRelated.length > 0) {
              const localHandler = onBulkStatusUpdateRef.current;
              if (localHandler) {
                await localHandler(
                  allRelated.map((t) => ({
                    id: t.id,
                    changes: { status_id: 'done' },
                  }))
                );
              }
              queryClient.invalidateQueries({ queryKey: ['local', 'tasks'] });
            }
          }
          // 'skip' (No Thanks) — sub-task moves to done, nothing else happens
        } else {
          // Parent/standalone variant: build detailed sub-task status breakdown
          const subTasks = issues.filter(
            (i) =>
              i.parent_issue_id === issueId &&
              i.status_id !== 'cancelled'
          );

          const subTaskStatus = subTasks.length > 0 ? {
            notStarted: subTasks.filter((t) => t.status_id === 'todo' || t.status_id === 'ready').length,
            inProgress: subTasks.filter((t) => t.status_id === 'in_progress').length,
            inReview: subTasks.filter((t) => t.status_id === 'in_review').length,
            done: subTasks.filter((t) => t.status_id === 'done').length,
            workspaceRunning: !!localWorkspacesById.get(localWsId)?.isRunning,
          } : undefined;

          const result = await MergeOnDoneDialog.show({
            workspaceName: workspace.name || workspace.branch,
            repos: unmergedRepos.map((s) => ({
              repoId: s.repo_id,
              repoName: s.repo_name,
              targetBranch: s.target_branch_name,
            })),
            subTaskStatus,
          });

          if (result === 'cancel') {
            const localHandler = onBulkStatusUpdateRef.current;
            if (localHandler) {
              await localHandler([
                { id: issueId, changes: { status_id: 'in_review' } },
              ]);
            }
            return;
          }

          if (result === 'merge') {
            const mergeOk = await performMerge(localWsId, workspace, unmergedRepos, parentId);
            if (!mergeOk) {
              // Merge failed — revert parent back to in_review
              const localHandler = onBulkStatusUpdateRef.current;
              if (localHandler) {
                await localHandler([
                  { id: issueId, changes: { status_id: 'in_review' } },
                ]);
              }
              return;
            }
          }

          // For both 'merge' and 'skip': parent is going to done, so transition
          // all active sub-tasks to done as well (the branch work is finalized).
          if (result === 'merge' || result === 'skip') {
            const activeSubTasks = issues.filter(
              (i) =>
                i.parent_issue_id === issueId &&
                i.status_id !== 'done' &&
                i.status_id !== 'cancelled'
            );
            if (activeSubTasks.length > 0) {
              const localHandler = onBulkStatusUpdateRef.current;
              if (localHandler) {
                await localHandler(
                  activeSubTasks.map((t) => ({
                    id: t.id,
                    changes: { status_id: 'done' },
                  }))
                );
              }
              queryClient.invalidateQueries({ queryKey: ['local', 'tasks'] });
            }
          }
        }
      } catch (err) {
        console.error('[MergeOnDone] Failed to check branch status:', err);
      }
    },
    [getWorkspacesForIssue, issues, issuesById, localWorkspacesById, queryClient, performMerge]
  );

  // Simple onDragEnd handler - the library handles all visual movement
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { source, destination } = result;

      // Dropped outside a valid droppable
      if (!destination) return;

      // No movement
      if (
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      ) {
        return;
      }

      const isManualSort = kanbanFilters.sortField === 'sort_order';

      // Block within-column reordering when not in manual sort mode
      // (cross-column moves are always allowed for status changes)
      if (source.droppableId === destination.droppableId && !isManualSort) {
        return;
      }

      const sourceId = source.droppableId;
      const destId = destination.droppableId;
      const isCrossColumn = sourceId !== destId;

      // Update local state and capture new items for bulk update
      let newItems: Record<string, string[]> = {};
      let movedIssueId: string | undefined;
      setItems((prev) => {
        const sourceItems = [...(prev[sourceId] ?? [])];
        const [moved] = sourceItems.splice(source.index, 1);
        movedIssueId = moved;

        if (!isCrossColumn) {
          // Within-column reorder
          sourceItems.splice(destination.index, 0, moved);
          newItems = { ...prev, [sourceId]: sourceItems };
        } else {
          // Cross-column move
          const destItems = [...(prev[destId] ?? [])];
          destItems.splice(destination.index, 0, moved);
          newItems = {
            ...prev,
            [sourceId]: sourceItems,
            [destId]: destItems,
          };
        }
        return newItems;
      });

      // Build bulk updates for all issues in affected columns
      const updates: BulkUpdateIssueItem[] = [];

      // Always update destination column
      const destIssueIds = newItems[destId] ?? [];
      destIssueIds.forEach((issueId, index) => {
        updates.push({
          id: issueId,
          changes: {
            status_id: destId,
            sort_order: calculateSortOrder(destId, index),
          },
        });
      });

      // Update source column if cross-column move
      if (isCrossColumn) {
        const sourceIssueIds = newItems[sourceId] ?? [];
        sourceIssueIds.forEach((issueId, index) => {
          updates.push({
            id: issueId,
            changes: {
              sort_order: calculateSortOrder(sourceId, index),
            },
          });
        });
      }

      // Perform bulk update — use local handler when available (local mode),
      // otherwise fall back to remote Electric bulk update.
      isSyncingRef.current = true;
      const localHandler = onBulkStatusUpdateRef.current;
      const updateFn = localHandler
        ? () => localHandler(updates)
        : () => bulkUpdateIssues(updates);
      updateFn()
        .then(() => {
          if (IS_LOCAL_MODE && isCrossColumn && movedIssueId) {
            const id = movedIssueId;
            // When parent with sub-tasks is moved to "ready", offer to
            // set all sub-tasks to "ready" as well.
            if (destId === 'ready') {
              const issue = issuesById.get(id);
              if (issue) {
                const subTasks = issues.filter(
                  (i) => i.parent_issue_id === id && i.status_id === 'todo'
                );
                if (subTasks.length > 0) {
                  ConfirmDialog.show({
                    title: 'Set Sub-tasks to Ready?',
                    message: `"${issue.title}" has ${subTasks.length} sub-task${subTasks.length !== 1 ? 's' : ''} still in To Do. Set them all to Ready?`,
                    confirmText: 'Set to Ready',
                    cancelText: 'No, just the parent',
                    variant: 'default',
                  }).then((result) => {
                    if (result === 'confirmed') {
                      const subUpdates = subTasks.map((t) => ({
                        id: t.id,
                        changes: { status_id: 'ready' },
                      }));
                      const handler = onBulkStatusUpdateRef.current;
                      if (handler) {
                        handler(subUpdates).then(() => {
                          queryClient.invalidateQueries({
                            queryKey: ['local', 'tasks'],
                          });
                        });
                      }
                    }
                  });
                }
              }
            }
            // Auto-create workspace when task is dragged to "in_progress"
            if (destId === 'in_progress') {
              // Chain: parent with sub-tasks → sub-task reuse → default auto-create
              triggerResumeWork(id).then((handled) => {
                if (handled) return;
                return triggerSubTaskWorkspace(id).then((subHandled) => {
                  if (subHandled) return;
                  const issue = issuesById.get(id);
                  const hasWorkspaces =
                    getWorkspacesForIssue(id).length > 0;
                  triggerAutoCreate(id, issue, hasWorkspaces);
                });
              });
            }
            // Prompt merge when task is dragged from "in_review" to "done"
            if (sourceId === 'in_review' && destId === 'done') {
              triggerMergeOnDone(id);
            }
          }
        })
        .catch((err: unknown) => {
          console.error('[Kanban] Bulk status update failed:', err);
          // Force refetch to revert to server state
          isSyncingRef.current = false;
        })
        .finally(() => {
          // Delay clearing flag to let sync complete
          setTimeout(() => {
            isSyncingRef.current = false;
          }, 500);
        });
    },
    [
      kanbanFilters.sortField,
      calculateSortOrder,
      issuesById,
      getWorkspacesForIssue,
      triggerAutoCreate,
      triggerResumeWork,
      triggerSubTaskWorkspace,
      triggerMergeOnDone,
    ]
  );

  const handleCardClick = useCallback(
    (issueId: string) => {
      openIssue(issueId);
    },
    [openIssue]
  );

  const handleAddTask = useCallback(
    (statusId?: string) => {
      const createPayload = {
        statusId: statusId ?? defaultCreateStatusId,
        ...(createAssigneeIds.length > 0
          ? { assigneeIds: createAssigneeIds }
          : {}),
      };
      startCreate(createPayload);
    },
    [createAssigneeIds, defaultCreateStatusId, startCreate]
  );

  // Inline editing callbacks for kanban cards
  const handleCardPriorityClick = useCallback(
    (issueId: string) => {
      openPrioritySelection(projectId, [issueId]);
    },
    [projectId, openPrioritySelection]
  );

  const handleCardAssigneeClick = useCallback(
    (issueId: string) => {
      openAssigneeSelection(projectId, [issueId]);
    },
    [projectId, openAssigneeSelection]
  );

  const handleCardMoreActionsClick = useCallback(
    (issueId: string) => {
      CommandBarDialog.show({
        page: 'issueActions',
        projectId,
        issueIds: [issueId],
      });
    },
    [projectId]
  );

  const handleCardTagToggle = useCallback(
    (issueId: string, tagId: string) => {
      const currentIssueTags = getTagsForIssue(issueId);
      const existing = currentIssueTags.find((it) => it.tag_id === tagId);
      if (existing) {
        removeIssueTag(existing.id);
      } else {
        insertIssueTag({ issue_id: issueId, tag_id: tagId });
      }
    },
    [getTagsForIssue, insertIssueTag, removeIssueTag]
  );

  const getResolvedRelationshipsForIssue = useCallback(
    (issueId: string) =>
      resolveRelationshipsForIssue(
        issueId,
        getRelationshipsForIssue(issueId),
        issuesById
      ),
    [getRelationshipsForIssue, issuesById]
  );

  const handleCreateTag = useCallback(
    (data: { name: string; color: string }): string => {
      const { data: newTag } = insertTag({
        project_id: projectId,
        name: data.name,
        color: data.color,
      });
      return newTag.id;
    },
    [insertTag, projectId]
  );

  const isLoading = projectLoading || orgLoading;

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="flex flex-col h-full space-y-base">
      <div
        className={cn(
          'px-double pt-double space-y-base',
          isMobile && 'px-base pt-base'
        )}
      >
        <div className="flex items-center gap-half">
          <h2 className={cn('text-2xl font-medium', isMobile && 'text-lg')}>
            {projectName}
          </h2>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-half rounded-sm text-low hover:text-normal hover:bg-secondary transition-colors"
                aria-label="Project menu"
              >
                <DotsThreeIcon className="size-icon-sm" weight="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openProjectsGuide}>
                {t('kanban.openProjectsGuide', 'Projects guide')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => executeAction(Actions.ProjectSettings)}
              >
                {t('kanban.editProjectSettings', 'Edit project settings')}
              </DropdownMenuItem>
              {IS_LOCAL_MODE && (
                <DropdownMenuItem
                  onClick={() => setIsDefaultRepoOpen(true)}
                >
                  {t('kanban.defaultRepo', 'Default repository')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          className={cn(
            'flex items-start gap-base',
            isMobile ? 'flex-col' : 'flex-wrap'
          )}
        >
          <ViewNavTabs
            activeView={kanbanViewMode}
            onViewChange={setKanbanViewMode}
            hiddenStatuses={hiddenStatuses}
            selectedStatusId={listViewStatusFilter}
            onStatusSelect={setListViewStatusFilter}
          />
          <KanbanFilterBar
            isFiltersDialogOpen={isFiltersDialogOpen}
            onFiltersDialogOpenChange={setIsFiltersDialogOpen}
            tags={tags}
            users={membersWithProfiles}
            activeViewId={activeViewId}
            onViewChange={handleKanbanProjectViewChange}
            viewIds={KANBAN_PROJECT_VIEW_IDS}
            projectId={projectId}
            currentUserId={userId}
            filters={kanbanFilters}
            showSubIssues={showSubIssues}
            showWorkspaces={showWorkspaces}
            hasActiveFilters={hasActiveFilters}
            onSearchQueryChange={setKanbanSearchQuery}
            onPrioritiesChange={setKanbanPriorities}
            onAssigneesChange={setKanbanAssignees}
            onTagsChange={setKanbanTags}
            onSortChange={setKanbanSort}
            onShowSubIssuesChange={setShowSubIssues}
            onShowWorkspacesChange={setShowWorkspaces}
            onClearFilters={clearKanbanFilters}
            onCreateIssue={handleAddTask}
            shouldAnimateCreateButton={shouldAnimateCreateButton}
            autoPickupEnabled={autoPickupEnabled}
            onAutoPickupChange={
              IS_LOCAL_MODE
                ? (enabled: boolean) => toggleAutoPickupMutation.mutate(enabled)
                : undefined
            }
            renderFiltersDialog={(props) => <KanbanFiltersDialog {...props} />}
            isMobile={isMobile}
          />
        </div>
      </div>

      {kanbanViewMode === 'kanban' ? (
        visibleStatuses.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-low">{t('kanban.noVisibleStatuses')}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto px-double">
            <KanbanProvider onDragEnd={handleDragEnd}>
              {visibleStatuses.map((status) => {
                const issueIds = items[status.id] ?? [];

                return (
                  <KanbanBoard key={status.id}>
                    <KanbanHeader>
                      <div className="border-t sticky border-b top-0 z-20 flex shrink-0 items-center justify-between gap-2 p-base bg-secondary">
                        <div className="flex items-center gap-2">
                          <StatusIcon statusId={status.id} size="sm" />
                          <p className="m-0 text-sm">{status.name}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddTask(status.id)}
                          className="p-half rounded-sm text-low hover:text-normal hover:bg-secondary transition-colors"
                          aria-label="Add task"
                        >
                          <PlusIcon className="size-icon-xs" weight="bold" />
                        </button>
                      </div>
                    </KanbanHeader>
                    <KanbanCards id={status.id}>
                      {issueIds.map((issueId, index) => {
                        const issue = issueMap[issueId];
                        if (!issue) return null;
                        const issueWorkspaces =
                          workspacesByIssueId.get(issue.id) ?? [];
                        const workspaceIdsShownOnCard = new Set(
                          issueWorkspaces.map((workspace) => workspace.id)
                        );
                        const issueCardPullRequests = getPullRequestsForIssue(
                          issue.id
                        ).filter((pr) => {
                          if (!pr.workspace_id) {
                            return true;
                          }

                          // If this PR is already visible under a workspace card,
                          // do not render it again at the issue level.
                          return !workspaceIdsShownOnCard.has(pr.workspace_id);
                        });

                        return (
                          <KanbanCard
                            key={issue.id}
                            id={issue.id}
                            name={issue.title}
                            index={index}
                            className="group"
                            onClick={() => handleCardClick(issue.id)}
                            isOpen={selectedKanbanIssueId === issue.id}
                            isMobile={isMobile}
                          >
                            <KanbanCardContent
                              displayId={issue.simple_id}
                              title={issue.title}
                              description={issue.description}
                              priority={issue.priority}
                              tags={getTagObjectsForIssue(issue.id)}
                              assignees={issueAssigneesMap[issue.id] ?? []}
                              pullRequests={issueCardPullRequests}
                              relationships={resolveRelationshipsForIssue(
                                issue.id,
                                getRelationshipsForIssue(issue.id),
                                issuesById
                              )}
                              isSubIssue={!!issue.parent_issue_id}
                              isMobile={isMobile}
                              onPriorityClick={(e) => {
                                e.stopPropagation();
                                handleCardPriorityClick(issue.id);
                              }}
                              onAssigneeClick={(e) => {
                                e.stopPropagation();
                                handleCardAssigneeClick(issue.id);
                              }}
                              onMoreActionsClick={() =>
                                handleCardMoreActionsClick(issue.id)
                              }
                              tagEditProps={{
                                allTags: tags,
                                selectedTagIds: getTagsForIssue(issue.id).map(
                                  (it) => it.tag_id
                                ),
                                onTagToggle: (tagId) =>
                                  handleCardTagToggle(issue.id, tagId),
                                onCreateTag: handleCreateTag,
                                renderTagEditor: ({
                                  allTags,
                                  selectedTagIds,
                                  onTagToggle,
                                  onCreateTag,
                                  trigger,
                                }) => (
                                  <SearchableTagDropdownContainer
                                    tags={allTags}
                                    selectedTagIds={selectedTagIds}
                                    onTagToggle={onTagToggle}
                                    onCreateTag={onCreateTag}
                                    disabled={false}
                                    contentClassName=""
                                    trigger={trigger}
                                  />
                                ),
                              }}
                            />
                            {issueWorkspaces.length > 0 && (
                              <div className="mt-base flex flex-col gap-half">
                                {issueWorkspaces.map((workspace) => (
                                  <IssueWorkspaceCard
                                    key={workspace.id}
                                    workspace={workspace}
                                    onClick={
                                      workspace.localWorkspaceId
                                        ? () =>
                                            openIssueWorkspace(
                                              issue.id,
                                              workspace.localWorkspaceId!
                                            )
                                        : undefined
                                    }
                                    showOwner={false}
                                    showStatusBadge={false}
                                    showNoPrText={false}
                                  />
                                ))}
                              </div>
                            )}
                          </KanbanCard>
                        );
                      })}
                    </KanbanCards>
                  </KanbanBoard>
                );
              })}
            </KanbanProvider>
          </div>
        )
      ) : (
        <div className="flex-1 overflow-y-auto px-double">
          <KanbanProvider onDragEnd={handleDragEnd} className="!block !w-full">
            <IssueListView
              statuses={listViewStatuses}
              items={items}
              issueMap={issueMap}
              issueAssigneesMap={issueAssigneesMap}
              getTagObjectsForIssue={getTagObjectsForIssue}
              getResolvedRelationshipsForIssue={
                getResolvedRelationshipsForIssue
              }
              onIssueClick={handleCardClick}
              selectedIssueId={selectedKanbanIssueId}
            />
          </KanbanProvider>
        </div>
      )}

      {IS_LOCAL_MODE && (
        <DefaultRepoDialog
          projectId={projectId}
          open={isDefaultRepoOpen}
          onOpenChange={setIsDefaultRepoOpen}
        />
      )}
    </div>
  );
}
