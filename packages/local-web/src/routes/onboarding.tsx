import { createFileRoute, redirect } from '@tanstack/react-router';
import { repoApi } from '@/shared/lib/api';
import { shouldRedirectToWorkspaceCreate } from '@/shared/lib/guards/repoBranchGuard';
import { LandingPage } from '@/features/onboarding/ui/LandingPage';

function OnboardingLandingRouteComponent() {
  return <LandingPage />;
}

export const Route = createFileRoute('/onboarding')({
  beforeLoad: async () => {
    const repos = await repoApi.list();
    if (shouldRedirectToWorkspaceCreate(repos)) {
      throw redirect({ to: '/workspaces/create' });
    }
  },
  component: OnboardingLandingRouteComponent,
});
