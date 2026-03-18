import { useMemo, useCallback, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { OrgContext, type OrgContextValue } from '@/shared/hooks/useOrgContext';
import {
  listLocalProjects,
  createLocalProject,
  listCrewMembers,
  type LocalProject,
  type CrewMember,
} from '@/shared/lib/local/localApi';
import type { Project } from 'shared/remote-types';
import { MemberRole } from 'shared/types';
import type { OrganizationMemberWithProfile } from 'shared/types';
import type { InsertResult, MutationResult } from '@/shared/lib/electric/types';

/** Synthetic org ID used in local mode (no real cloud org exists). */
export const LOCAL_ORG_ID = 'local';

/** Map a local project to the remote Project shape expected by OrgContextValue. */
function localProjectToRemote(p: LocalProject): Project {
  return {
    id: p.id,
    organization_id: LOCAL_ORG_ID,
    name: p.name,
    color: '#6366F1',
    sort_order: 0,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

interface LocalOrgProviderProps {
  children: ReactNode;
}

/** Map a crew member to the OrganizationMemberWithProfile shape used by KanbanContainer. */
function crewMemberToOrgMember(cm: CrewMember): OrganizationMemberWithProfile {
  return {
    user_id: cm.id,
    role: MemberRole.MEMBER,
    joined_at: cm.created_at,
    first_name: cm.name,
    last_name: null,
    username: cm.role,
    email: null,
    avatar_url: null,
  };
}

export function LocalOrgProvider({ children }: LocalOrgProviderProps) {
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: ['local', 'projects'],
    queryFn: listLocalProjects,
  });

  const crewMembersQuery = useQuery({
    queryKey: ['local', 'crew-members'],
    queryFn: listCrewMembers,
  });

  const projects = useMemo<Project[]>(
    () => (projectsQuery.data ?? []).map(localProjectToRemote),
    [projectsQuery.data]
  );

  const createMutation = useMutation({
    mutationFn: (name: string) => createLocalProject(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['local', 'projects'] });
    },
  });

  const projectsById = useMemo(() => {
    const map = new Map<string, Project>();
    for (const p of projects) {
      map.set(p.id, p);
    }
    return map;
  }, [projects]);

  const getProject = useCallback(
    (id: string) => projectsById.get(id),
    [projectsById]
  );

  const insertProject = useCallback(
    (data: { name: string }): InsertResult<Project> => {
      const optimisticId = crypto.randomUUID();
      const optimistic: Project = {
        id: optimisticId,
        organization_id: LOCAL_ORG_ID,
        name: data.name,
        color: '#6366F1',
        sort_order: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const persisted = createMutation
        .mutateAsync(data.name)
        .then(localProjectToRemote);
      return { data: optimistic, persisted };
    },
    [createMutation]
  );

  const noop = useCallback((): MutationResult => {
    return { persisted: Promise.resolve() };
  }, []);

  const retry = useCallback(() => {
    projectsQuery.refetch();
  }, [projectsQuery]);

  const membersWithProfilesById = useMemo(() => {
    const map = new Map<string, OrganizationMemberWithProfile>();
    for (const cm of crewMembersQuery.data ?? []) {
      map.set(cm.id, crewMemberToOrgMember(cm));
    }
    return map;
  }, [crewMembersQuery.data]);

  const value = useMemo<OrgContextValue>(
    () => ({
      organizationId: LOCAL_ORG_ID,
      projects,
      isLoading: projectsQuery.isLoading,
      error: null,
      retry,
      insertProject,
      updateProject: noop,
      removeProject: noop,
      getProject,
      projectsById,
      membersWithProfilesById,
    }),
    [
      projects,
      projectsQuery.isLoading,
      retry,
      insertProject,
      noop,
      getProject,
      projectsById,
      membersWithProfilesById,
    ]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
