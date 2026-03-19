import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ThemeMode } from 'shared/types';
import { usePostHog } from 'posthog-js/react';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { useTheme } from '@/shared/hooks/useTheme';
import { OAuthSignInButton } from '@vibe/ui/components/OAuthButtons';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import { getFirstProjectDestination } from '@/shared/lib/firstProjectDestination';
import { useOrganizationStore } from '@/shared/stores/useOrganizationStore';
import { isTauriApp } from '@/shared/lib/platform';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';

type OnboardingDestination =
  | { kind: 'workspaces-create' }
  | { kind: 'project'; projectId: string };

const REMOTE_ONBOARDING_EVENTS = {
  STAGE_VIEWED: 'remote_onboarding_ui_stage_viewed',
  STAGE_SUBMITTED: 'remote_onboarding_ui_stage_submitted',
  STAGE_COMPLETED: 'remote_onboarding_ui_stage_completed',
  STAGE_FAILED: 'remote_onboarding_ui_stage_failed',
  PROVIDER_CLICKED: 'remote_onboarding_ui_sign_in_provider_clicked',
  PROVIDER_RESULT: 'remote_onboarding_ui_sign_in_provider_result',
  MORE_OPTIONS_OPENED: 'remote_onboarding_ui_sign_in_more_options_opened',
} as const;

type SignInCompletionMethod =
  | 'continue_logged_in'
  | 'skip_sign_in'
  | 'oauth_github'
  | 'oauth_google';
function resolveTheme(theme: ThemeMode): 'light' | 'dark' {
  if (theme === ThemeMode.SYSTEM) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return theme === ThemeMode.DARK ? 'dark' : 'light';
}

export function OnboardingSignInPage() {
  const appNavigation = useAppNavigation();
  const { t } = useTranslation('common');
  const { theme } = useTheme();
  const posthog = usePostHog();
  const { config, loginStatus, loading, updateAndSaveConfig } = useUserSystem();
  const setSelectedOrgId = useOrganizationStore((s) => s.setSelectedOrgId);

  const [saving, setSaving] = useState(false);
  const isCompletingOnboardingRef = useRef(false);
  const hasTrackedStageViewRef = useRef(false);
  const hasRedirectedToRootRef = useRef(false);

  const trackRemoteOnboardingEvent = useCallback(
    (eventName: string, properties: Record<string, unknown> = {}) => {
      posthog?.capture(eventName, {
        ...properties,
        flow: 'remote_onboarding_ui',
        source: 'frontend',
      });
    },
    [posthog]
  );

  // const logoSrc =
  //   resolveTheme(theme) === 'dark'
  //     ? '/kanban-crew-logo-dark.svg'
  //     : '/kanban-crew-logo.svg';

  const isLoggedIn = loginStatus?.status === 'loggedin';

  useEffect(() => {
    if (loading || !config || hasTrackedStageViewRef.current) return;

    trackRemoteOnboardingEvent(REMOTE_ONBOARDING_EVENTS.STAGE_VIEWED, {
      stage: 'sign_in',
      is_logged_in: isLoggedIn,
    });
    hasTrackedStageViewRef.current = true;
  }, [config, isLoggedIn, loading, trackRemoteOnboardingEvent]);

  useEffect(() => {
    if (!config?.remote_onboarding_acknowledged) {
      return;
    }
    if (isCompletingOnboardingRef.current || hasRedirectedToRootRef.current) {
      return;
    }

    hasRedirectedToRootRef.current = true;
    appNavigation.goToRoot({ replace: true });
  }, [appNavigation, config?.remote_onboarding_acknowledged]);

  const getOnboardingDestination = async (): Promise<OnboardingDestination> => {
    const firstProjectDestination =
      await getFirstProjectDestination(setSelectedOrgId);
    if (
      !firstProjectDestination ||
      firstProjectDestination.kind !== 'project'
    ) {
      trackRemoteOnboardingEvent(REMOTE_ONBOARDING_EVENTS.STAGE_FAILED, {
        stage: 'sign_in',
        reason: 'destination_lookup_failed',
      });
      return { kind: 'workspaces-create' };
    }

    return firstProjectDestination;
  };

  const finishOnboarding = async (options: {
    method: SignInCompletionMethod;
  }) => {
    if (!config || saving || isCompletingOnboardingRef.current) return;

    trackRemoteOnboardingEvent(REMOTE_ONBOARDING_EVENTS.STAGE_SUBMITTED, {
      stage: 'sign_in',
      method: options.method,
      is_logged_in: isLoggedIn,
    });

    isCompletingOnboardingRef.current = true;
    setSaving(true);
    const success = await updateAndSaveConfig({
      remote_onboarding_acknowledged: true,
      onboarding_acknowledged: true,
      disclaimer_acknowledged: true,
    });

    if (!success) {
      trackRemoteOnboardingEvent(REMOTE_ONBOARDING_EVENTS.STAGE_FAILED, {
        stage: 'sign_in',
        method: options.method,
        reason: 'config_save_failed',
      });
      isCompletingOnboardingRef.current = false;
      setSaving(false);
      return;
    }

    const destination = await getOnboardingDestination();
    trackRemoteOnboardingEvent(REMOTE_ONBOARDING_EVENTS.STAGE_COMPLETED, {
      stage: 'sign_in',
      method: options.method,
      destination_kind: destination.kind,
      destination_project_id:
        destination.kind === 'project' ? destination.projectId : null,
    });
    switch (destination.kind) {
      case 'workspaces-create':
        appNavigation.goToWorkspacesCreate({ replace: true });
        return;
      case 'project':
        appNavigation.goToProject(destination.projectId, { replace: true });
        return;
    }
  };


  if (loading || !config) {
    return (
      <div className="h-screen bg-primary flex items-center justify-center">
        <p className="text-low">Loading...</p>
      </div>
    );
  }

  if (
    config.remote_onboarding_acknowledged &&
    !isCompletingOnboardingRef.current
  ) {
    return null;
  }

  return (
    <div className="h-screen overflow-auto bg-primary">
      {isTauriApp() && (
        <div
          data-tauri-drag-region
          className="fixed inset-x-0 top-0 h-10 z-10"
        />
      )}
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-base py-double">
        <div className="rounded-sm border border-border bg-secondary p-double space-y-double">
          <header className="space-y-double text-center">
            {/* Logo hidden until branding assets are ready
            <div className="flex justify-center">
              <img
                src={logoSrc}
                alt="Kanban Crew"
                className="h-8 w-auto logo"
              />
            </div>
            */}
            <h1 className="text-lg font-semibold text-normal">Kanban Crew</h1>
            {!isLoggedIn && (
              <p className="text-sm text-low">
                {t('onboardingSignIn.subtitle')}
              </p>
            )}
          </header>

          {isLoggedIn ? (
            <section className="space-y-base">
              <p className="text-sm text-normal text-center">
                {t('onboardingSignIn.signedInAs', {
                  name:
                    loginStatus.profile.username || loginStatus.profile.email,
                })}
              </p>
              <div className="flex justify-end">
                <PrimaryButton
                  value={saving ? 'Continuing...' : 'Continue'}
                  onClick={() =>
                    void finishOnboarding({ method: 'continue_logged_in' })
                  }
                  disabled={saving}
                />
              </div>
            </section>
          ) : (
            <>
              <section className="flex flex-col items-center gap-3">
                <PrimaryButton
                  value={saving ? 'Continuing...' : 'Continue without signing in'}
                  onClick={() =>
                    void finishOnboarding({ method: 'skip_sign_in' })
                  }
                  disabled={saving}
                />

                <div className="flex items-center gap-3 w-full max-w-xs">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-low">or sign in</span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                <OAuthSignInButton
                  provider="github"
                  onClick={() => toast.info('Sign in with GitHub is coming soon.')}
                  disabled={saving}
                />
                <OAuthSignInButton
                  provider="google"
                  onClick={() => toast.info('Sign in with Google is coming soon.')}
                  disabled={saving}
                />
              </section>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
