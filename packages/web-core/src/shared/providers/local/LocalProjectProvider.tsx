import { useMemo, useCallback, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/shared/hooks/useProjectContext';
import {
  listLocalTasks,
  createLocalTask,
  updateLocalTask,
  deleteLocalTask,
  bulkUpdateLocalTasks,
} from '@/shared/lib/local/localApi';
import { taskToIssue, type LocalTask } from '@/shared/lib/local/taskAdapter';
import { getLocalStatuses } from '@/shared/lib/local/localStatuses';
import type { Issue } from 'shared/remote-types';
import type { InsertResult, MutationResult } from '@/shared/lib/electric/types';
import type {
  CreateIssueRequest,
  UpdateIssueRequest,
} from 'shared/remote-types';
import type { BulkUpdateIssueItem } from '@/shared/lib/remoteApi';

interface LocalProjectProviderProps {
  projectId: string;
  children: ReactNode;
}

export function LocalProjectProvider({
  projectId,
  children,
}: LocalProjectProviderProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['local', 'tasks', projectId], [projectId]);

  const tasksQuery = useQuery({
    queryKey,
    queryFn: () => listLocalTasks(projectId),
    enabled: Boolean(projectId),
  });

  const issues = useMemo<Issue[]>(
    () => (tasksQuery.data ?? []).map(taskToIssue),
    [tasksQuery.data]
  );

  const statuses = useMemo(
    () => getLocalStatuses(projectId),
    [projectId]
  );

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: {
      title: string;
      description?: string | null;
      status?: string;
      sort_order?: number;
    }) => createLocalTask({ ...data, project_id: projectId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      changes,
    }: {
      id: string;
      changes: Partial<UpdateIssueRequest>;
    }) =>
      updateLocalTask(id, {
        title: changes.title ?? undefined,
        description: changes.description ?? undefined,
        status: changes.status_id ?? undefined,
        sort_order: changes.sort_order ?? undefined,
      }),
    onMutate: async ({ id, changes }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousTasks = queryClient.getQueryData<LocalTask[]>(queryKey);
      queryClient.setQueryData<LocalTask[]>(queryKey, (old) => {
        if (!old) return old;
        return old.map((task) => {
          if (task.id !== id) return task;
          return {
            ...task,
            ...(changes.title != null ? { title: changes.title } : {}),
            ...(changes.description !== undefined
              ? { description: changes.description }
              : {}),
            ...(changes.status_id != null
              ? { status: changes.status_id }
              : {}),
            ...(changes.sort_order != null
              ? { sort_order: changes.sort_order }
              : {}),
          };
        });
      });
      return { previousTasks };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(queryKey, context.previousTasks);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLocalTask(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const bulkMutation = useMutation({
    mutationFn: (updates: BulkUpdateIssueItem[]) =>
      bulkUpdateLocalTasks(
        updates.map((u) => ({
          id: u.id,
          status: u.changes.status_id ?? undefined,
          sort_order: u.changes.sort_order ?? undefined,
        }))
      ),
    onMutate: async (updates) => {
      // Cancel in-flight refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey });

      // Snapshot for rollback
      const previousTasks = queryClient.getQueryData<LocalTask[]>(queryKey);

      // Optimistically update the cache
      queryClient.setQueryData<LocalTask[]>(queryKey, (old) => {
        if (!old) return old;
        const changeMap = new Map(
          updates.map((u) => [u.id, u.changes] as const)
        );
        return old.map((task) => {
          const changes = changeMap.get(task.id);
          if (!changes) return task;
          return {
            ...task,
            ...(changes.status_id != null ? { status: changes.status_id } : {}),
            ...(changes.sort_order != null
              ? { sort_order: changes.sort_order }
              : {}),
          };
        });
      });

      return { previousTasks };
    },
    onError: (_err, _updates, context) => {
      // Roll back to previous state on failure
      if (context?.previousTasks) {
        queryClient.setQueryData(queryKey, context.previousTasks);
      }
    },
    onSettled: () => {
      // Always refetch after mutation to sync with server
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // ── ProjectContextValue helpers ────────────────────────────────────────────

  const issuesById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues) {
      map.set(issue.id, issue);
    }
    return map;
  }, [issues]);

  const statusesById = useMemo(() => {
    const map = new Map(statuses.map((s) => [s.id, s]));
    return map;
  }, [statuses]);

  const getIssue = useCallback(
    (id: string) => issuesById.get(id),
    [issuesById]
  );

  const getIssuesForStatus = useCallback(
    (statusId: string) => issues.filter((i) => i.status_id === statusId),
    [issues]
  );

  const getStatus = useCallback(
    (id: string) => statusesById.get(id),
    [statusesById]
  );

  const retry = useCallback(() => {
    tasksQuery.refetch();
  }, [tasksQuery]);

  // ── Mutation wrappers matching ProjectContextValue signatures ──────────────

  const insertIssue = useCallback(
    (data: CreateIssueRequest): InsertResult<Issue> => {
      const optimisticId = crypto.randomUUID();
      const optimistic: Issue = {
        id: optimisticId,
        project_id: projectId,
        issue_number: 0,
        simple_id: optimisticId.slice(0, 8),
        status_id: data.status_id ?? 'todo',
        title: data.title,
        description: data.description ?? null,
        priority: data.priority ?? null,
        start_date: null,
        target_date: null,
        completed_at: null,
        sort_order: data.sort_order ?? 0,
        parent_issue_id: null,
        parent_issue_sort_order: null,
        extension_metadata: {},
        creator_user_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const persisted = createMutation
        .mutateAsync({
          title: data.title,
          description: data.description,
          status: data.status_id ?? 'todo',
          sort_order: data.sort_order ?? 0,
        })
        .then(taskToIssue);
      return { data: optimistic, persisted };
    },
    [projectId, createMutation]
  );

  const updateIssue = useCallback(
    (id: string, changes: Partial<UpdateIssueRequest>): MutationResult => {
      const persisted = updateMutation
        .mutateAsync({ id, changes })
        .then(() => undefined);
      return { persisted };
    },
    [updateMutation]
  );

  const removeIssue = useCallback(
    (id: string): MutationResult => {
      const persisted = deleteMutation.mutateAsync(id).then(() => undefined);
      return { persisted };
    },
    [deleteMutation]
  );

  const onBulkStatusUpdate = useCallback(
    async (updates: BulkUpdateIssueItem[]): Promise<void> => {
      await bulkMutation.mutateAsync(updates);
    },
    [bulkMutation]
  );

  // Stub returning the input as both data and persisted (for unsupported entities)
  // Note: avoid generic arrow functions in .tsx files (parsed as JSX)
  const stubMutation = useCallback(
    (): MutationResult => ({ persisted: Promise.resolve() }),
    []
  );

  const value = useMemo<ProjectContextValue>(
    () => ({
      projectId,

      issues,
      statuses,
      tags: [],
      issueAssignees: [],
      issueFollowers: [],
      issueTags: [],
      issueRelationships: [],
      pullRequests: [],
      workspaces: [],

      isLoading: tasksQuery.isLoading,
      error: null,
      retry,

      insertIssue,
      updateIssue,
      removeIssue,

      // Status mutations — stubs (local statuses are fixed)
      insertStatus: (data) => ({ data: data as never, persisted: Promise.resolve(data as never) }),
      updateStatus: stubMutation,
      removeStatus: stubMutation,

      // Tag mutations — stubs
      insertTag: (data) => ({ data: data as never, persisted: Promise.resolve(data as never) }),
      updateTag: stubMutation,
      removeTag: stubMutation,

      // Relationship / assignee / follower / tag mutations — stubs
      insertIssueAssignee: (data) => ({ data: data as never, persisted: Promise.resolve(data as never) }),
      removeIssueAssignee: stubMutation,
      insertIssueFollower: (data) => ({ data: data as never, persisted: Promise.resolve(data as never) }),
      removeIssueFollower: stubMutation,
      insertIssueTag: (data) => ({ data: data as never, persisted: Promise.resolve(data as never) }),
      removeIssueTag: stubMutation,
      insertIssueRelationship: (data) => ({ data: data as never, persisted: Promise.resolve(data as never) }),
      removeIssueRelationship: stubMutation,

      // Lookup helpers
      getIssue,
      getIssuesForStatus,
      getAssigneesForIssue: () => [],
      getFollowersForIssue: () => [],
      getTagsForIssue: () => [],
      getTagObjectsForIssue: () => [],
      getRelationshipsForIssue: () => [],
      getStatus,
      getTag: () => undefined,
      getPullRequestsForIssue: () => [],
      getWorkspacesForIssue: () => [],

      // Computed maps
      issuesById,
      statusesById,
      tagsById: new Map(),

      // Local-only: bulk status/sort update for drag-drop
      onBulkStatusUpdate,
    }),
    [
      projectId,
      issues,
      statuses,
      tasksQuery.isLoading,
      retry,
      insertIssue,
      updateIssue,
      removeIssue,
      getIssue,
      getIssuesForStatus,
      getStatus,
      issuesById,
      statusesById,
      onBulkStatusUpdate,
      stubMutation,
    ]
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}
