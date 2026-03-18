import type { Issue } from 'shared/remote-types';

/**
 * Shape returned by the local /api/local/tasks endpoint.
 * Mirrors the LocalTask struct in crates/server/src/routes/local/mod.rs.
 */
export interface LocalTask {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  /** One of: "todo" | "ready" | "in_progress" | "in_review" | "done" | "cancelled" */
  status: string;
  sort_order: number;
  parent_task_id: string | null;
  parent_task_sort_order: number | null;
  crew_member_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Maps a LocalTask (from the Rust REST API) to the Electric Issue shape
 * expected by the Kanban UI.
 *
 * Fields with no local equivalent are set to null / sensible defaults.
 * Critically: status_id == task.status so the Kanban's status-column lookup works.
 */
export function taskToIssue(task: LocalTask): Issue {
  return {
    id: task.id,
    project_id: task.project_id,
    issue_number: 0,
    simple_id: task.id.slice(0, 8),
    status_id: task.status,
    title: task.title,
    description: task.description,
    priority: null,
    start_date: null,
    target_date: null,
    completed_at:
      task.status === 'done' || task.status === 'cancelled'
        ? task.updated_at
        : null,
    sort_order: task.sort_order,
    parent_issue_id: task.parent_task_id,
    parent_issue_sort_order: task.parent_task_sort_order,
    extension_metadata: {},
    creator_user_id: null,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}
