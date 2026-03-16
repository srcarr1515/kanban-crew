import type { Workspace as RemoteWorkspace } from 'shared/remote-types';
import type { Workspace as LocalWorkspace } from 'shared/types';

/**
 * Maps a local Workspace (from the local SQLite DB) to the remote
 * Workspace shape used by ProjectContext. This allows the existing
 * IssueWorkspacesSectionContainer to work unchanged in local mode.
 *
 * Key mapping:
 *  - issue_id = task_id  (task_id is the local equivalent of issue_id)
 *  - local_workspace_id = id  (in local mode they're the same entity)
 */
export function localWorkspaceToRemote(
  ws: LocalWorkspace,
  projectId: string,
): RemoteWorkspace {
  return {
    id: ws.id,
    project_id: projectId,
    owner_user_id: '',
    issue_id: ws.task_id,
    local_workspace_id: ws.id,
    name: ws.name,
    archived: ws.archived,
    files_changed: null,
    lines_added: null,
    lines_removed: null,
    created_at: ws.created_at,
    updated_at: ws.updated_at,
  };
}
