import { CollapsibleSectionHeader } from './CollapsibleSectionHeader';
import { cn } from '../lib/cn';

export interface JobRunItem {
  id: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  started_at: string | null;
  outcome_json: string | null;
  spawned_task_id: string | null;
  spawned_task_simple_id?: string | null;
}

export interface IssueHistorySectionProps {
  runs: JobRunItem[];
  isLoading?: boolean;
  onSpawnedTaskClick?: (taskId: string) => void;
}

const STATUS_STYLES: Record<
  JobRunItem['status'],
  { bg: string; text: string; label: string }
> = {
  pending: { bg: 'bg-yellow-500/15', text: 'text-yellow-600', label: 'Pending' },
  running: { bg: 'bg-blue-500/15', text: 'text-blue-600', label: 'Running' },
  success: { bg: 'bg-green-500/15', text: 'text-green-600', label: 'Success' },
  failed: { bg: 'bg-red-500/15', text: 'text-red-600', label: 'Failed' },
  cancelled: { bg: 'bg-gray-500/15', text: 'text-gray-500', label: 'Cancelled' },
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseOutcome(json: string | null): string | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed.message ?? parsed.error ?? JSON.stringify(parsed);
  } catch {
    return json;
  }
}

export function IssueHistorySection({
  runs,
  isLoading,
  onSpawnedTaskClick,
}: IssueHistorySectionProps) {
  return (
    <CollapsibleSectionHeader
      title="History"
      persistKey="kanban-issue-history"
      defaultExpanded={true}
    >
      <div className="px-base py-base border-t">
        {isLoading ? (
          <p className="text-low text-sm py-half">Loading history…</p>
        ) : runs.length === 0 ? (
          <p className="text-low text-sm py-half">No runs yet</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {runs.map((run) => {
              const style = STATUS_STYLES[run.status];
              const outcome = parseOutcome(run.outcome_json);
              return (
                <div
                  key={run.id}
                  className="flex items-center gap-2 text-sm py-1 px-1.5 rounded hover:bg-panel/50"
                >
                  <span className="text-low text-xs shrink-0 w-[7.5rem]">
                    {formatTimestamp(run.started_at)}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium shrink-0',
                      style.bg,
                      style.text
                    )}
                  >
                    {style.label}
                  </span>
                  {outcome && (
                    <span className="text-xs text-low truncate" title={outcome}>
                      {outcome}
                    </span>
                  )}
                  {run.spawned_task_id && onSpawnedTaskClick && (
                    <button
                      type="button"
                      className="ml-auto text-xs text-brand hover:underline shrink-0"
                      onClick={() => onSpawnedTaskClick(run.spawned_task_id!)}
                    >
                      {run.spawned_task_simple_id ?? 'View task'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CollapsibleSectionHeader>
  );
}
