import { createFileRoute, redirect } from '@tanstack/react-router';
import { repoApi } from '@/shared/lib/api';
import { shouldRedirectToWorkspaceCreate } from '@/shared/lib/guards/repoBranchGuard';
import { OnboardingSignInPage } from '@/features/onboarding/ui/OnboardingSignInPage';

function OnboardingSignInRouteComponent() {
  return <OnboardingSignInPage />;
}

export const Route = createFileRoute('/onboarding_/sign-in')({
  beforeLoad: async () => {
    const repos = await repoApi.list();
    if (shouldRedirectToWorkspaceCreate(repos)) {
      throw redirect({ to: '/workspaces/create' });
    }
  },
  component: OnboardingSignInRouteComponent,
});
