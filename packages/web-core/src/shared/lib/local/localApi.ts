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
  changes: { auto_pickup_enabled?: boolean }
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
  crew_member_id?: string | null;
  proposing_crew_member_id?: string | null;
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
    crew_member_id?: string | null;
    proposing_crew_member_id?: string | null;
  }
): Promise<LocalTask> {
  return localFetch<LocalTask>(`/api/local/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export function deleteLocalTask(
  id: string,
  proposingCrewMemberId?: string
): Promise<void> {
  const params = proposingCrewMemberId
    ? `?proposing_crew_member_id=${encodeURIComponent(proposingCrewMemberId)}`
    : '';
  return localFetch<void>(`/api/local/tasks/${id}${params}`, {
    method: 'DELETE',
  });
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
  workspaceId: string
): Promise<void> {
  return localFetch<void>(
    `/api/local/tasks/${taskId}/workspaces/${workspaceId}/link`,
    { method: 'POST' }
  );
}

export function unlinkWorkspaceFromTask(
  taskId: string,
  workspaceId: string
): Promise<void> {
  return localFetch<void>(
    `/api/local/tasks/${taskId}/workspaces/${workspaceId}/link`,
    { method: 'DELETE' }
  );
}

// ── Crew Members ─────────────────────────────────────────────────────────────

export interface CrewMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  role_prompt: string;
  tool_access: string;
  personality: string;
  ai_provider: string | null;
  ai_model: string | null;
  skills: string | null;
  can_create_workspace: boolean;
  can_merge_workspace: boolean;
  can_propose_tasks: boolean;
  can_query_database: boolean;
  created_at: string;
  updated_at: string;
}

export function listCrewMembers(): Promise<CrewMember[]> {
  return localFetch<CrewMember[]>('/api/local/crew-members');
}

export function createCrewMember(data: {
  name: string;
  role: string;
  avatar?: string;
  role_prompt?: string;
  tool_access?: unknown[];
  personality?: string;
}): Promise<CrewMember> {
  return localFetch<CrewMember>('/api/local/crew-members', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCrewMember(
  id: string,
  changes: {
    name?: string;
    role?: string;
    avatar?: string;
    role_prompt?: string;
    tool_access?: unknown[];
    personality?: string;
    ai_provider?: string;
    ai_model?: string;
    can_create_workspace?: boolean;
    can_merge_workspace?: boolean;
    can_propose_tasks?: boolean;
    can_query_database?: boolean;
  }
): Promise<CrewMember> {
  return localFetch<CrewMember>(`/api/local/crew-members/${id}`, {
    method: 'PUT',
    body: JSON.stringify(changes),
  });
}

export function deleteCrewMember(id: string): Promise<void> {
  return localFetch<void>(`/api/local/crew-members/${id}`, {
    method: 'DELETE',
  });
}

// ── Crew Member Skills ────────────────────────────────────────────────────────

export interface CrewMemberSkillEntry {
  crew_member_id: string;
  skill_id: string;
  sort_order: number;
}

export function listCrewMemberSkills(
  crewMemberId: string
): Promise<import('@/shared/lib/api').SkillEntry[]> {
  return localFetch<import('@/shared/lib/api').SkillEntry[]>(
    `/api/local/crew-members/${encodeURIComponent(crewMemberId)}/skills`
  );
}

export function replaceCrewMemberSkills(
  crewMemberId: string,
  skills: { skill_id: string; sort_order?: number }[]
): Promise<CrewMemberSkillEntry[]> {
  return localFetch<CrewMemberSkillEntry[]>(
    `/api/local/crew-members/${encodeURIComponent(crewMemberId)}/skills`,
    {
      method: 'PUT',
      body: JSON.stringify({ skills }),
    }
  );
}

// ── Task Comments ────────────────────────────────────────────────────────────

export interface TaskComment {
  id: string;
  task_id: string;
  author_type: string;
  author_name: string;
  content: string;
  created_at: string;
}

export function listTaskComments(taskId: string): Promise<TaskComment[]> {
  return localFetch<TaskComment[]>(`/api/local/tasks/${taskId}/comments`);
}

export function createTaskComment(
  taskId: string,
  data: { author_type: string; author_name: string; content: string }
): Promise<TaskComment> {
  return localFetch<TaskComment>(`/api/local/tasks/${taskId}/comments`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Artifacts ────────────────────────────────────────────────────────────────

export interface Artifact {
  id: string;
  task_id: string;
  crew_member_id: string | null;
  artifact_type: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function listTaskArtifacts(taskId: string): Promise<Artifact[]> {
  return localFetch<Artifact[]>(
    `/api/local/artifacts?task_id=${encodeURIComponent(taskId)}`
  );
}

export function deleteArtifact(id: string): Promise<void> {
  return localFetch<void>(`/api/local/artifacts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
