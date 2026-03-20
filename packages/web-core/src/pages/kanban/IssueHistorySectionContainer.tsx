import { useState, useEffect, useCallback, useMemo } from 'react';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { jobsApi, jobRunsApi } from '@/shared/lib/api';
import type { JobRun } from '@/shared/lib/api';
import {
  IssueHistorySection,
  type JobRunItem,
} from '@vibe/ui/components/IssueHistorySection';

interface IssueHistorySectionContainerProps {
  issueId: string;
}

export function IssueHistorySectionContainer({
  issueId,
}: IssueHistorySectionContainerProps) {
  const { projectId, issues } = useProjectContext();
  const appNavigation = useAppNavigation();
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasJobs, setHasJobs] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const allJobs = await jobsApi.list();
        const matchingJobs = allJobs.filter(
          (j) => j.template_task_id === issueId
        );
        if (cancelled) return;

        setHasJobs(matchingJobs.length > 0);

        if (matchingJobs.length === 0) {
          setRuns([]);
          setIsLoading(false);
          return;
        }

        const allRuns = await Promise.all(
          matchingJobs.map((job) => jobRunsApi.list({ job_id: job.id }))
        );
        if (cancelled) return;

        const flatRuns = allRuns
          .flat()
          .sort(
            (a, b) =>
              new Date(b.started_at ?? b.created_at).getTime() -
              new Date(a.started_at ?? a.created_at).getTime()
          );
        setRuns(flatRuns);
      } catch (err) {
        console.error('Failed to load job history:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  const issueMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues) {
      map.set(issue.id, issue.simple_id);
    }
    return map;
  }, [issues]);

  const runItems: JobRunItem[] = useMemo(
    () =>
      runs.map((run: JobRun) => ({
        id: run.id,
        status: run.status,
        started_at: run.started_at,
        outcome_json: run.outcome_json,
        spawned_task_id: run.spawned_task_id,
        spawned_task_simple_id: run.spawned_task_id
          ? (issueMap.get(run.spawned_task_id) ?? null)
          : null,
      })),
    [runs, issueMap]
  );

  const handleSpawnedTaskClick = useCallback(
    (taskId: string) => {
      appNavigation.goToProjectIssue(projectId, taskId);
    },
    [appNavigation, projectId]
  );

  // Don't render the section at all if this task isn't a template
  if (!isLoading && !hasJobs) {
    return null;
  }

  return (
    <IssueHistorySection
      runs={runItems}
      isLoading={isLoading}
      onSpawnedTaskClick={handleSpawnedTaskClick}
    />
  );
}
