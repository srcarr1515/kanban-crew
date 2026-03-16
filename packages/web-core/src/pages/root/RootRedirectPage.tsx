import { useEffect } from 'react';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { getFirstProjectDestination } from '@/shared/lib/firstProjectDestination';
import { useOrganizationStore } from '@/shared/stores/useOrganizationStore';
import { useUiPreferencesStore } from '@/shared/stores/useUiPreferencesStore';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { IS_LOCAL_MODE } from '@/shared/lib/local/isLocalMode';
import {
  listLocalProjects,
  createLocalProject,
} from '@/shared/lib/local/localApi';

async function getLocalProjectDestination(
  savedProjectId: string | null | undefined
): Promise<string | null> {
  let projects = await listLocalProjects();

  if (savedProjectId && projects.some((p) => p.id === savedProjectId)) {
    return savedProjectId;
  }

  if (projects.length > 0) {
    return projects[0].id;
  }

  // No projects yet — create a default one
  const created = await createLocalProject('My Project');
  return created.id;
}

export function RootRedirectPage() {
  const { config, loading, loginStatus } = useUserSystem();
  const setSelectedOrgId = useOrganizationStore((s) => s.setSelectedOrgId);
  const appNavigation = useAppNavigation();

  useEffect(() => {
    if (loading || !config) {
      return;
    }

    let isActive = true;
    void (async () => {
      if (!config.remote_onboarding_acknowledged) {
        appNavigation.goToOnboarding({ replace: true });
        return;
      }

      // ── Local mode: skip cloud auth, use local projects ──────────────────
      if (IS_LOCAL_MODE) {
        const { selectedProjectId } = useUiPreferencesStore.getState();
        const projectId = await getLocalProjectDestination(selectedProjectId);
        if (!isActive) return;
        if (projectId) {
          appNavigation.goToProject(projectId, { replace: true });
        } else {
          appNavigation.goToWorkspacesCreate({ replace: true });
        }
        return;
      }

      // ── Remote mode ───────────────────────────────────────────────────────
      if (loginStatus?.status !== 'loggedin') {
        appNavigation.goToWorkspacesCreate({ replace: true });
        return;
      }

      // Read saved selections imperatively to avoid re-triggering this effect
      // when the scratch store initializes from the server
      const { selectedOrgId, selectedProjectId } =
        useUiPreferencesStore.getState();

      const destination = await getFirstProjectDestination(
        setSelectedOrgId,
        selectedOrgId,
        selectedProjectId
      );
      if (!isActive) {
        return;
      }

      if (destination?.kind === 'project') {
        appNavigation.goToProject(destination.projectId, { replace: true });
        return;
      }

      appNavigation.goToWorkspacesCreate({ replace: true });
    })();

    return () => {
      isActive = false;
    };
  }, [appNavigation, config, loading, loginStatus?.status, setSelectedOrgId]);

  return (
    <div className="h-screen bg-primary flex items-center justify-center">
      <p className="text-low">Loading...</p>
    </div>
  );
}
