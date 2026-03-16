import { makeLocalApiRequest } from '@/shared/lib/localApiTransport';

interface ApiResponse<T> {
  data: T;
}

async function chatFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await makeLocalApiRequest(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chat API error ${res.status}: ${body}`);
  }
  const json: ApiResponse<T> = await res.json();
  return json.data;
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface ChatThread {
  id: string;
  project_id: string;
  issue_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: string | null;
  created_at: string;
}

export interface ProposalTicket {
  title: string;
  description: string;
  status: string;
}

export interface Proposal {
  tickets: ProposalTicket[];
}

// ── Threads ─────────────────────────────────────────────────────────────────

export function listChatThreads(projectId: string): Promise<ChatThread[]> {
  return chatFetch<ChatThread[]>(
    `/api/local/chat/threads?project_id=${encodeURIComponent(projectId)}`
  );
}

export function createChatThread(data: {
  project_id: string;
  issue_id?: string | null;
  title?: string;
}): Promise<ChatThread> {
  return chatFetch<ChatThread>('/api/local/chat/threads', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteChatThread(id: string): Promise<void> {
  return chatFetch<void>(`/api/local/chat/threads/${id}`, { method: 'DELETE' });
}

export function updateChatThreadTitle(
  id: string,
  title: string
): Promise<ChatThread> {
  return chatFetch<ChatThread>(`/api/local/chat/threads/${id}/title`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

// ── Messages ────────────────────────────────────────────────────────────────

export function listChatMessages(threadId: string): Promise<ChatMessage[]> {
  return chatFetch<ChatMessage[]>(
    `/api/local/chat/messages?thread_id=${encodeURIComponent(threadId)}`
  );
}

// ── Streaming completion ────────────────────────────────────────────────────

/**
 * Send a message and stream the assistant response.
 * Returns an async generator that yields text chunks.
 * The full user + assistant messages are persisted server-side.
 */
export async function* streamChatCompletion(
  threadId: string,
  content: string
): AsyncGenerator<string, void, unknown> {
  const res = await makeLocalApiRequest('/api/local/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread_id: threadId, content }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chat completion error ${res.status}: ${body}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      const data = line.startsWith('data: ') ? line.slice(6) : null;
      if (!data || data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        if (
          event.type === 'content_block_delta' &&
          event.delta?.text
        ) {
          yield event.delta.text;
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROPOSAL_REGEX = /```proposal\n([\s\S]*?)\n```/g;

/** Extract proposal blocks from an assistant message. */
export function extractProposals(content: string): Proposal[] {
  const proposals: Proposal[] = [];
  let match;
  while ((match = PROPOSAL_REGEX.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed.tickets)) {
        proposals.push(parsed);
      }
    } catch {
      // malformed proposal, skip
    }
  }
  return proposals;
}
