import type { ProjectStatus } from 'shared/remote-types';

/**
 * Synthetic ProjectStatus objects that map the local TaskStatus enum values.
 * These are used by LocalProjectProvider as stand-ins for Electric-synced statuses.
 *
 * Status id == status name (the string stored in tasks.status column).
 */
export const LOCAL_STATUSES: ProjectStatus[] = [
  {
    id: 'todo',
    project_id: '',
    name: 'To Do',
    color: '#6B7280',
    sort_order: 0,
    hidden: false,
    created_at: new Date(0).toISOString(),
  },
  {
    id: 'ready',
    project_id: '',
    name: 'Ready',
    color: '#8B5CF6',
    sort_order: 1,
    hidden: false,
    created_at: new Date(0).toISOString(),
  },
  {
    id: 'in_progress',
    project_id: '',
    name: 'In Progress',
    color: '#3B82F6',
    sort_order: 2,
    hidden: false,
    created_at: new Date(0).toISOString(),
  },
  {
    id: 'in_review',
    project_id: '',
    name: 'In Review',
    color: '#F59E0B',
    sort_order: 3,
    hidden: false,
    created_at: new Date(0).toISOString(),
  },
  {
    id: 'done',
    project_id: '',
    name: 'Done',
    color: '#10B981',
    sort_order: 4,
    hidden: false,
    created_at: new Date(0).toISOString(),
  },
  {
    id: 'cancelled',
    project_id: '',
    name: 'Cancelled',
    color: '#EF4444',
    sort_order: 5,
    hidden: false,
    created_at: new Date(0).toISOString(),
  },
];

/** Build status list stamped with the correct project_id. */
export function getLocalStatuses(projectId: string): ProjectStatus[] {
  return LOCAL_STATUSES.map((s) => ({ ...s, project_id: projectId }));
}
