import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { repoApi, configApi } from '@/shared/lib/api';
import { getProjectRepoDefaults } from '@/shared/hooks/useProjectRepoDefaults';
import { getAutoCreateExecutor } from '@/shared/components/DefaultRepoDialog';
import { useCreateWorkspace } from '@/shared/hooks/useCreateWorkspace';
import { BaseCodingAgent } from 'shared/types';
import type { Issue } from 'shared/remote-types';

/**
 * Hook that auto-creates a workspace when a task is dragged to "in_progress".
 * Only fires when project repo defaults are configured and the task has no existing workspaces.
 */
export function useAutoCreateWorkspace(projectId: string) {
  const { createWorkspace } = useCreateWorkspace();
  const queryClient = useQueryClient();
  // Track in-flight auto-creates to prevent duplicates
  const pendingRef = useRef<Set<string>>(new Set());

  const triggerAutoCreate = useCallback(
    async (
      issueId: string,
      issue: Issue | undefined,
      hasWorkspaces: boolean
    ) => {
      // Skip if task already has workspaces or auto-create is already in flight
      if (hasWorkspaces || pendingRef.current.has(issueId)) return;
      pendingRef.current.add(issueId);

      try {
        // Check for project repo defaults — this is the "on/off switch"
        const repoDefaults = await getProjectRepoDefaults(projectId);
        if (!repoDefaults || repoDefaults.length === 0) return;

        // Validate repos still exist
        const allRepos = await repoApi.list();
        const availableRepoIds = new Set(allRepos.map((r) => r.id));
        const validRepos = repoDefaults.filter((r) =>
          availableRepoIds.has(r.repo_id)
        );
        if (validRepos.length === 0) return;

        // Resolve executor — use saved preference, fall back to CLAUDE_CODE or first available
        const systemInfo = await configApi.getConfig();
        const executors = systemInfo.executors ?? {};
        const executorKeys = Object.keys(executors);
        if (executorKeys.length === 0) return;

        const savedExecutor = getAutoCreateExecutor(projectId);
        const executorName =
          (savedExecutor && executorKeys.includes(savedExecutor)
            ? savedExecutor
            : null) ??
          (executorKeys.includes('CLAUDE_CODE') ? 'CLAUDE_CODE' : null) ??
          executorKeys[0]!;

        const title = issue?.title ?? 'Untitled task';
        const description = issue?.description ?? '';
        const prompt = description
          ? `${title}\n\n${description}`
          : title;

        await createWorkspace.mutateAsync({
          data: {
            name: title,
            repos: validRepos.map((r) => ({
              repo_id: r.repo_id,
              target_branch: r.target_branch,
            })),
            linked_issue: {
              remote_project_id: projectId,
              issue_id: issueId,
            },
            executor_config: {
              executor: executorName as BaseCodingAgent,
            },
            prompt,
            image_ids: null,
          },
        });

        // Refresh kanban data
        queryClient.invalidateQueries({ queryKey: ['local', 'workspaces'] });
        queryClient.invalidateQueries({ queryKey: ['local', 'tasks'] });
      } catch (err) {
        console.error('[AutoCreate] Failed to auto-create workspace:', err);
      } finally {
        pendingRef.current.delete(issueId);
      }
    },
    [projectId, createWorkspace, queryClient]
  );

  return { triggerAutoCreate };
}
