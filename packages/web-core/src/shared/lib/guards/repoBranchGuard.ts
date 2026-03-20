import type { Repo } from 'shared/types';

/**
 * Returns true when the repo list is empty, meaning the user has not
 * registered any repository yet and onboarding routes should redirect
 * to the workspace-creation flow.
 */
export function shouldRedirectToWorkspaceCreate(repos: Repo[]): boolean {
  return repos.length === 0;
}

/**
 * Returns true when at least one repo has a `default_target_branch` configured,
 * meaning the user has completed the repo + branch setup and project creation
 * should be enabled.
 */
export function hasRepoWithBranch(repos: Pick<Repo, 'default_target_branch'>[]): boolean {
  return repos.some((r) => !!r.default_target_branch);
}
