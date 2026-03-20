import { describe, it, expect } from 'vitest';
import {
  shouldRedirectToWorkspaceCreate,
  hasRepoWithBranch,
} from './repoBranchGuard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(overrides: { default_target_branch?: string | null } = {}) {
  return {
    id: 'repo-1',
    path: '/home/user/project',
    name: 'my-project',
    display_name: 'My Project',
    setup_script: null,
    cleanup_script: null,
    archive_script: null,
    copy_files: null,
    parallel_setup_script: false,
    dev_server_script: null,
    default_target_branch: null,
    default_working_dir: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// shouldRedirectToWorkspaceCreate
// ---------------------------------------------------------------------------

describe('shouldRedirectToWorkspaceCreate', () => {
  it('returns true when repo list is empty', () => {
    expect(shouldRedirectToWorkspaceCreate([])).toBe(true);
  });

  it('returns false when at least one repo exists', () => {
    expect(shouldRedirectToWorkspaceCreate([makeRepo()])).toBe(false);
  });

  it('returns false with multiple repos', () => {
    expect(
      shouldRedirectToWorkspaceCreate([makeRepo(), makeRepo({ default_target_branch: 'main' })]),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasRepoWithBranch
// ---------------------------------------------------------------------------

describe('hasRepoWithBranch', () => {
  it('returns false when repo list is empty', () => {
    expect(hasRepoWithBranch([])).toBe(false);
  });

  it('returns false when all repos have null default_target_branch', () => {
    expect(
      hasRepoWithBranch([
        makeRepo({ default_target_branch: null }),
        makeRepo({ default_target_branch: null }),
      ]),
    ).toBe(false);
  });

  it('returns false when all repos have empty-string default_target_branch', () => {
    expect(
      hasRepoWithBranch([makeRepo({ default_target_branch: '' })]),
    ).toBe(false);
  });

  it('returns true when at least one repo has a branch configured', () => {
    expect(
      hasRepoWithBranch([
        makeRepo({ default_target_branch: null }),
        makeRepo({ default_target_branch: 'main' }),
      ]),
    ).toBe(true);
  });

  it('returns true when the only repo has a branch', () => {
    expect(
      hasRepoWithBranch([makeRepo({ default_target_branch: 'develop' })]),
    ).toBe(true);
  });

  it('returns true when all repos have branches', () => {
    expect(
      hasRepoWithBranch([
        makeRepo({ default_target_branch: 'main' }),
        makeRepo({ default_target_branch: 'develop' }),
      ]),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guard interaction: project creation visibility
// ---------------------------------------------------------------------------

describe('project creation guard', () => {
  it('hides create-project when no repos exist', () => {
    const repos: ReturnType<typeof makeRepo>[] = [];
    const shouldRedirect = shouldRedirectToWorkspaceCreate(repos);
    const canCreateProject = hasRepoWithBranch(repos);

    expect(shouldRedirect).toBe(true);
    expect(canCreateProject).toBe(false);
  });

  it('hides create-project when repo exists but has no branch', () => {
    const repos = [makeRepo({ default_target_branch: null })];
    const shouldRedirect = shouldRedirectToWorkspaceCreate(repos);
    const canCreateProject = hasRepoWithBranch(repos);

    expect(shouldRedirect).toBe(false);
    expect(canCreateProject).toBe(false);
  });

  it('shows create-project when repo exists with a branch', () => {
    const repos = [makeRepo({ default_target_branch: 'main' })];
    const shouldRedirect = shouldRedirectToWorkspaceCreate(repos);
    const canCreateProject = hasRepoWithBranch(repos);

    expect(shouldRedirect).toBe(false);
    expect(canCreateProject).toBe(true);
  });
});
