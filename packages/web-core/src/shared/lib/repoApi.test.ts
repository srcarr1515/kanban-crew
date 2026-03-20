import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setLocalApiTransport } from '@/shared/lib/localApiTransport';
import { repoApi } from './api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ success: true, data, error_data: null, message: null }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

type TransportCall = [string, RequestInit];

function getCall(spy: ReturnType<typeof vi.fn>, n: number) {
  const [path, init] = spy.mock.calls[n] as TransportCall;
  return {
    path,
    body: (init.body as string) ?? '',
    init,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('repoApi.update persists default_target_branch', () => {
  const transportSpy = vi.fn();

  beforeEach(() => {
    transportSpy.mockReset();
    setLocalApiTransport({
      request: transportSpy,
      openWebSocket: () => ({}) as WebSocket,
    });
  });

  afterEach(() => {
    setLocalApiTransport(null);
  });

  it('sends PUT /api/repos/:id with default_target_branch in body', async () => {
    const updatedRepo = {
      id: 'repo-1',
      name: 'my-repo',
      display_name: 'My Repo',
      path: '/home/user/project',
      default_target_branch: 'main',
      default_working_dir: null,
      setup_script: null,
      cleanup_script: null,
      archive_script: null,
      copy_files: null,
      parallel_setup_script: false,
      dev_server_script: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    transportSpy.mockResolvedValueOnce(jsonResponse(updatedRepo));

    const result = await repoApi.update('repo-1', {
      default_target_branch: 'main',
    });

    expect(transportSpy).toHaveBeenCalledOnce();
    const call = getCall(transportSpy, 0);
    expect(call.path).toBe('/api/repos/repo-1');
    expect(call.init.method).toBe('PUT');

    const body = JSON.parse(call.body);
    expect(body).toEqual({ default_target_branch: 'main' });
    expect(result.default_target_branch).toBe('main');
  });

  it('sends null to clear default_target_branch', async () => {
    const updatedRepo = {
      id: 'repo-1',
      name: 'my-repo',
      display_name: 'My Repo',
      path: '/home/user/project',
      default_target_branch: null,
      default_working_dir: null,
      setup_script: null,
      cleanup_script: null,
      archive_script: null,
      copy_files: null,
      parallel_setup_script: false,
      dev_server_script: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    transportSpy.mockResolvedValueOnce(jsonResponse(updatedRepo));

    const result = await repoApi.update('repo-1', {
      default_target_branch: null,
    });

    const call = getCall(transportSpy, 0);
    const body = JSON.parse(call.body);
    expect(body).toEqual({ default_target_branch: null });
    expect(result.default_target_branch).toBeNull();
  });

  it('does not include default_target_branch when not provided', async () => {
    const updatedRepo = {
      id: 'repo-1',
      name: 'my-repo',
      display_name: 'My Repo',
      path: '/home/user/project',
      default_target_branch: 'main',
      default_working_dir: null,
      setup_script: null,
      cleanup_script: null,
      archive_script: null,
      copy_files: null,
      parallel_setup_script: false,
      dev_server_script: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    transportSpy.mockResolvedValueOnce(jsonResponse(updatedRepo));

    await repoApi.update('repo-1', { display_name: 'New Name' });

    const call = getCall(transportSpy, 0);
    const body = JSON.parse(call.body);
    expect(body).toEqual({ display_name: 'New Name' });
    expect(body).not.toHaveProperty('default_target_branch');
  });
});
