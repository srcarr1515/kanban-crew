import { makeLocalApiRequest } from '@/shared/lib/localApiTransport';
import type { LocalTask } from './taskAdapter';
import type { Workspace as LocalWorkspace } from 'shared/types';

// ── Shared helpers ────────────────────────────────────────────────────────────

interface ApiResponse<T> {
  data: T;
}

async function localFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await makeLocalApiRequest(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Local API error ${res.status}: ${body}`);
  }
  const json: ApiResponse<T> = await res.json();
  return json.data;
}

// ── Local project types ───────────────────────────────────────────────────────

export interface LocalProject {
  id: string;
  name: string;
  default_agent_working_dir: string | null;
  remote_project_id: string | null;
  auto_pickup_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ── Projects ──────────────────────────────────────────────────────────────────

export function listLocalProjects(): Promise<LocalProject[]> {
  return localFetch<LocalProject[]>('/api/local/projects');
}

export function createLocalProject(name: string): Promise<LocalProject> {
  return localFetch<LocalProject>('/api/local/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function updateLocalProject(
  id: string,
  changes: { auto_pickup_enabled?: boolean },
): Promise<LocalProject> {
  return localFetch<LocalProject>(`/api/local/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export function listLocalTasks(projectId: string): Promise<LocalTask[]> {
  return localFetch<LocalTask[]>(
    `/api/local/tasks?project_id=${encodeURIComponent(projectId)}`
  );
}

export function createLocalTask(data: {
  project_id: string;
  title: string;
  description?: string | null;
  status?: string;
  sort_order?: number;
  parent_task_id?: string | null;
  parent_task_sort_order?: number | null;
}): Promise<LocalTask> {
  return localFetch<LocalTask>('/api/local/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateLocalTask(
  id: string,
  changes: {
    title?: string;
    description?: string | null;
    status?: string;
    sort_order?: number;
    parent_task_id?: string | null;
    parent_task_sort_order?: number | null;
  },
): Promise<LocalTask> {
  return localFetch<LocalTask>(`/api/local/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export function deleteLocalTask(id: string): Promise<void> {
  return localFetch<void>(`/api/local/tasks/${id}`, { method: 'DELETE' });
}

export interface LocalBulkUpdateItem {
  id: string;
  status?: string;
  sort_order?: number;
  parent_task_sort_order?: number | null;
}

export function bulkUpdateLocalTasks(
  updates: LocalBulkUpdateItem[]
): Promise<void> {
  return localFetch<void>('/api/local/tasks/bulk-update', {
    method: 'POST',
    body: JSON.stringify({ updates }),
  });
}

// ── Workspace-Task linking ───────────────────────────────────────────────────

export function listTaskWorkspaces(taskId: string): Promise<LocalWorkspace[]> {
  return localFetch<LocalWorkspace[]>(`/api/local/tasks/${taskId}/workspaces`);
}

export function linkWorkspaceToTask(
  taskId: string,
  workspaceId: string,
): Promise<void> {
  return localFetch<void>(
    `/api/local/tasks/${taskId}/workspaces/${workspaceId}/link`,
    { method: 'POST' },
  );
}

export function unlinkWorkspaceFromTask(
  taskId: string,
  workspaceId: string,
): Promise<void> {
  return localFetch<void>(
    `/api/local/tasks/${taskId}/workspaces/${workspaceId}/link`,
    { method: 'DELETE' },
  );
}
