import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { repoApi, configApi } from '@/shared/lib/api';
import { getProjectRepoDefaults } from '@/shared/hooks/useProjectRepoDefaults';
import { getAutoCreateExecutor } from '@/shared/components/DefaultRepoDialog';
import { useCreateWorkspace } from '@/shared/hooks/useCreateWorkspace';
import { listLocalProjects } from '@/shared/lib/local/localApi';
import { BaseCodingAgent } from 'shared/types';
import type { Issue } from 'shared/remote-types';

/**
 * Hook that auto-creates a workspace when a task is dragged to "in_progress".
 * Reads repo/branch from the project's DB fields first, falling back to scratch storage.
 * Supports per-task branch override.
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
      hasWorkspaces: boolean,
      taskBranch?: string | null,
    ) => {
      // Skip if task already has workspaces or auto-create is already in flight
      if (hasWorkspaces || pendingRef.current.has(issueId)) return;
      pendingRef.current.add(issueId);

      try {
        // Try project DB fields first (default_repo_id + default_branch)
        let repoId: string | null = null;
        let targetBranch: string | null = null;

        const projects = await listLocalProjects();
        const project = projects.find((p) => p.id === projectId);
        if (project?.default_repo_id && project?.default_branch) {
          repoId = project.default_repo_id;
          targetBranch = project.default_branch;
        }

        // Fall back to scratch storage for backwards compatibility
        if (!repoId) {
          const repoDefaults = await getProjectRepoDefaults(projectId);
          if (repoDefaults && repoDefaults.length > 0) {
            repoId = repoDefaults[0].repo_id;
            targetBranch = repoDefaults[0].target_branch;
          }
        }

        if (!repoId || !targetBranch) {
          toast.warning('No repository configured for this project. Set one in project settings to enable auto-workspace creation.');
          return;
        }

        // Validate repo still exists
        const allRepos = await repoApi.list();
        if (!allRepos.some((r) => r.id === repoId)) {
          toast.warning('The configured repository no longer exists. Update the repo in project settings.');
          return;
        }

        // Per-task branch overrides project default
        const effectiveBranch = taskBranch || targetBranch;

        // Resolve executor — use saved preference, fall back to CLAUDE_CODE or first available
        const systemInfo = await configApi.getConfig();
        const executors = systemInfo.executors ?? {};
        const executorKeys = Object.keys(executors);
        if (executorKeys.length === 0) {
          toast.warning('No coding agent (executor) is available. Check your configuration.');
          return;
        }

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
            repos: [{
              repo_id: repoId,
              target_branch: effectiveBranch,
            }],
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
        toast.error(`Failed to create workspace: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        pendingRef.current.delete(issueId);
      }
    },
    [projectId, createWorkspace, queryClient]
  );

  return { triggerAutoCreate };
}
