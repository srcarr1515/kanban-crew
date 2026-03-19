import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureAuthRuntime } from '@/shared/lib/auth/runtime';
import { setLocalApiTransport } from '@/shared/lib/localApiTransport';
import {
  streamChatCompletion,
  listChatThreads,
  createChatThread,
} from './chatApi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock AuthRuntime with controllable token behaviour. */
function mockAuthRuntime(
  overrides: {
    getToken?: () => Promise<string | null>;
    triggerRefresh?: () => Promise<string | null>;
  } = {},
) {
  return {
    getToken: overrides.getToken ?? (async () => 'test-token-abc'),
    triggerRefresh:
      overrides.triggerRefresh ?? (async () => 'refreshed-token-xyz'),
    registerShape: () => () => {},
    getCurrentUser: async () => ({ user_id: 'user-1' }),
  };
}

/** Create a fake Response from a JSON body (for non-streaming endpoints). */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Create a fake SSE streaming Response. */
function sseResponse(events: string[], status = 200): Response {
  const body = events.join('\n') + '\n';
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

type TransportCall = [string, RequestInit];

/** Extract the nth transport call as [path, init] with typed headers. */
function getCall(
  spy: ReturnType<typeof vi.fn>,
  n: number,
): { path: string; headers: Record<string, string>; body: string; init: RequestInit } {
  const [path, init] = spy.mock.calls[n] as TransportCall;
  return {
    path,
    headers: (init.headers ?? {}) as Record<string, string>,
    body: (init.body as string) ?? '',
    init,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('chatApi auth flow', () => {
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

  // ── Token attachment ────────────────────────────────────────────────────

  describe('attaches auth token to requests', () => {
    it('sends Authorization header on chatFetch calls (listChatThreads)', async () => {
      configureAuthRuntime(mockAuthRuntime());
      transportSpy.mockResolvedValueOnce(jsonResponse([]));

      await listChatThreads('proj-1');

      expect(transportSpy).toHaveBeenCalledOnce();
      const call = getCall(transportSpy, 0);
      expect(call.headers['Authorization']).toBe('Bearer test-token-abc');
      expect(call.headers['Content-Type']).toBe('application/json');
    });

    it('sends Authorization header on streamChatCompletion', async () => {
      configureAuthRuntime(mockAuthRuntime());
      transportSpy.mockResolvedValueOnce(sseResponse(['data: [DONE]']));

      const gen = streamChatCompletion('thread-1', 'hello');
      // Consume the generator to trigger the request
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of gen) {
        /* drain */
      }

      expect(transportSpy).toHaveBeenCalledOnce();
      const call = getCall(transportSpy, 0);
      expect(call.path).toBe('/api/local/chat/completions');
      expect(call.headers['Authorization']).toBe('Bearer test-token-abc');
    });

    it('sends crew_member_id in request body when provided', async () => {
      configureAuthRuntime(mockAuthRuntime());
      transportSpy.mockResolvedValueOnce(sseResponse(['data: [DONE]']));

      const gen = streamChatCompletion('thread-1', 'hello', 'crew-42');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of gen) {
        /* drain */
      }

      const parsed = JSON.parse(getCall(transportSpy, 0).body);
      expect(parsed.crew_member_id).toBe('crew-42');
      expect(parsed.thread_id).toBe('thread-1');
      expect(parsed.content).toBe('hello');
    });
  });

  // ── 401 retry with token refresh ──────────────────────────────────────

  describe('401 retry with token refresh', () => {
    it('retries with refreshed token on 401 for chatFetch calls', async () => {
      configureAuthRuntime(
        mockAuthRuntime({
          triggerRefresh: async () => 'new-fresh-token',
        }),
      );

      // First call returns 401, retry returns success
      transportSpy
        .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
        .mockResolvedValueOnce(jsonResponse([]));

      const threads = await listChatThreads('proj-1');

      expect(transportSpy).toHaveBeenCalledTimes(2);
      // Second call should use refreshed token
      const retryCall = getCall(transportSpy, 1);
      expect(retryCall.headers['Authorization']).toBe(
        'Bearer new-fresh-token',
      );
      expect(threads).toEqual([]);
    });

    it('retries with refreshed token on 401 for streamChatCompletion', async () => {
      configureAuthRuntime(
        mockAuthRuntime({
          triggerRefresh: async () => 'new-fresh-token',
        }),
      );

      transportSpy
        .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
        .mockResolvedValueOnce(sseResponse(['data: [DONE]']));

      const gen = streamChatCompletion('thread-1', 'hello');
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of gen) {
        /* drain */
      }

      expect(transportSpy).toHaveBeenCalledTimes(2);
      const retryCall = getCall(transportSpy, 1);
      expect(retryCall.headers['Authorization']).toBe(
        'Bearer new-fresh-token',
      );
    });

    it('returns original 401 when refresh fails', async () => {
      configureAuthRuntime(
        mockAuthRuntime({
          triggerRefresh: async () => {
            throw new Error('refresh failed');
          },
        }),
      );

      transportSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 }),
      );

      await expect(listChatThreads('proj-1')).rejects.toThrow(
        'Chat API error 401',
      );
      // Should NOT retry — only one call
      expect(transportSpy).toHaveBeenCalledOnce();
    });

    it('returns original 401 when refresh returns null', async () => {
      configureAuthRuntime(
        mockAuthRuntime({
          triggerRefresh: async () => null,
        }),
      );

      transportSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 }),
      );

      await expect(listChatThreads('proj-1')).rejects.toThrow(
        'Chat API error 401',
      );
      expect(transportSpy).toHaveBeenCalledOnce();
    });
  });

  // ── Graceful degradation without auth ─────────────────────────────────

  describe('graceful degradation without auth runtime', () => {
    it('proceeds without Authorization header when getToken throws', async () => {
      configureAuthRuntime(
        mockAuthRuntime({
          getToken: async () => {
            throw new Error('Auth runtime has not been configured');
          },
        }),
      );

      transportSpy.mockResolvedValueOnce(jsonResponse([]));

      const threads = await listChatThreads('proj-1');

      expect(transportSpy).toHaveBeenCalledOnce();
      const call = getCall(transportSpy, 0);
      expect(call.headers['Authorization']).toBeUndefined();
      expect(threads).toEqual([]);
    });

    it('proceeds without Authorization when getToken returns null', async () => {
      configureAuthRuntime(mockAuthRuntime({ getToken: async () => null }));
      transportSpy.mockResolvedValueOnce(jsonResponse([]));

      await listChatThreads('proj-1');

      const call = getCall(transportSpy, 0);
      expect(call.headers['Authorization']).toBeUndefined();
    });
  });

  // ── Streaming parsing ─────────────────────────────────────────────────

  describe('streamChatCompletion SSE parsing', () => {
    it('yields text chunks from content_block_delta events', async () => {
      configureAuthRuntime(mockAuthRuntime());

      const events = [
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}',
        'data: {"type":"content_block_delta","delta":{"text":" world"}}',
        'data: [DONE]',
      ];
      transportSpy.mockResolvedValueOnce(sseResponse(events));

      const chunks: string[] = [];
      for await (const chunk of streamChatCompletion('t-1', 'hi')) {
        if (chunk.type === 'text') chunks.push(chunk.text);
      }

      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('yields vision_fallback metadata events', async () => {
      configureAuthRuntime(mockAuthRuntime());

      const events = [
        'data: {"type":"vision_fallback","metadata":{"vision_fallback":true,"original_provider":"openai","original_model":"gpt-4","vision_provider":"anthropic","vision_model":"claude-3"}}',
        'data: [DONE]',
      ];
      transportSpy.mockResolvedValueOnce(sseResponse(events));

      const results = [];
      for await (const chunk of streamChatCompletion('t-1', 'hi')) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('vision_fallback');
    });

    it('throws on non-OK status from streaming endpoint', async () => {
      configureAuthRuntime(mockAuthRuntime());
      transportSpy.mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      );

      const gen = streamChatCompletion('t-1', 'hi');
      await expect(gen.next()).rejects.toThrow('Chat completion error 500');
    });
  });

  // ── createChatThread with auth ────────────────────────────────────────

  describe('createChatThread with auth', () => {
    it('sends auth headers and crew_member_id on thread creation', async () => {
      configureAuthRuntime(mockAuthRuntime());
      const thread = {
        id: 'thr-1',
        project_id: 'proj-1',
        issue_id: null,
        crew_member_id: 'crew-5',
        title: 'Test',
        created_at: '',
        updated_at: '',
      };
      transportSpy.mockResolvedValueOnce(jsonResponse(thread));

      const result = await createChatThread({
        project_id: 'proj-1',
        crew_member_id: 'crew-5',
      });

      const call = getCall(transportSpy, 0);
      expect(call.path).toBe('/api/local/chat/threads');
      expect(call.init.method).toBe('POST');
      expect(call.headers['Authorization']).toBe('Bearer test-token-abc');
      const body = JSON.parse(call.body);
      expect(body.crew_member_id).toBe('crew-5');
      expect(result.id).toBe('thr-1');
    });
  });
});
