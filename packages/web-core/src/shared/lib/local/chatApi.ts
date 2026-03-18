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
  crew_member_id: string | null;
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
  subtasks?: ProposalTicket[];
}

export interface Proposal {
  tickets: ProposalTicket[];
}

export interface ModifyProposalItem {
  task_id: string;
  title?: string;
  description?: string;
  status?: string;
}

export interface ModifyProposal {
  modifications: ModifyProposalItem[];
}

export interface DeleteProposalItem {
  task_id: string;
  title: string;
}

export interface DeleteProposal {
  deletions: DeleteProposalItem[];
}

export interface QueryBlock {
  sql: string;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
}

export interface ChatAttachment {
  base64: string;
  mime_type: string;
}

export interface VisionFallbackInfo {
  vision_fallback: true;
  original_provider: string | null;
  original_model: string | null;
  vision_provider: string;
  vision_model: string;
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
  crew_member_id?: string | null;
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

export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'vision_fallback'; info: VisionFallbackInfo };

/**
 * Send a message and stream the assistant response.
 * Returns an async generator that yields stream chunks (text deltas and metadata).
 * The full user + assistant messages are persisted server-side.
 */
export async function* streamChatCompletion(
  threadId: string,
  content: string,
  crewMemberId?: string | null,
  attachments?: ChatAttachment[]
): AsyncGenerator<StreamChunk, void, unknown> {
  const body: Record<string, unknown> = { thread_id: threadId, content };
  if (crewMemberId) body.crew_member_id = crewMemberId;
  if (attachments && attachments.length > 0) body.images = attachments;

  const res = await makeLocalApiRequest('/api/local/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
          yield { type: 'text', text: event.delta.text };
        } else if (event.type === 'vision_fallback' && event.metadata) {
          yield { type: 'vision_fallback', info: event.metadata as VisionFallbackInfo };
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROPOSAL_REGEX = /```proposal\n([\s\S]*?)\n```/g;

/** Normalize a raw parsed object into a ProposalTicket, returning null if invalid. */
function normalizeTicket(raw: unknown): ProposalTicket | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.title !== 'string' || !t.title.trim()) return null;
  return {
    title: t.title.trim(),
    description: typeof t.description === 'string' ? t.description : '',
    status: typeof t.status === 'string' ? t.status : 'todo',
    subtasks: Array.isArray(t.subtasks)
      ? (t.subtasks.map(normalizeTicket).filter(Boolean) as ProposalTicket[])
      : undefined,
  };
}

/** Extract and normalize proposal blocks from an assistant message. */
export function extractProposals(content: string): Proposal[] {
  const proposals: Proposal[] = [];
  let match;
  while ((match = PROPOSAL_REGEX.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (!Array.isArray(parsed.tickets)) continue;
      const tickets = parsed.tickets
        .map(normalizeTicket)
        .filter(Boolean) as ProposalTicket[];
      if (tickets.length > 0) {
        proposals.push({ tickets });
      }
    } catch {
      // malformed JSON, skip
    }
  }
  return proposals;
}

const MODIFY_PROPOSAL_REGEX = /```modify_proposal\n([\s\S]*?)\n```/g;

/** Extract modify-proposal blocks from an assistant message. */
export function extractModifyProposals(content: string): ModifyProposal[] {
  const proposals: ModifyProposal[] = [];
  let match;
  while ((match = MODIFY_PROPOSAL_REGEX.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (!Array.isArray(parsed.modifications)) continue;
      const modifications = parsed.modifications.filter(
        (m: unknown) =>
          m &&
          typeof m === 'object' &&
          typeof (m as Record<string, unknown>).task_id === 'string'
      ) as ModifyProposalItem[];
      if (modifications.length > 0) {
        proposals.push({ modifications });
      }
    } catch {
      // malformed JSON, skip
    }
  }
  return proposals;
}

const QUERY_BLOCK_REGEX = /```query\n([\s\S]*?)\n```/g;

/** Extract query blocks from an assistant message. */
export function extractQueryBlocks(content: string): QueryBlock[] {
  const blocks: QueryBlock[] = [];
  let match;
  while ((match = QUERY_BLOCK_REGEX.exec(content)) !== null) {
    const sql = match[1].trim();
    if (sql) {
      blocks.push({ sql });
    }
  }
  return blocks;
}

/** Execute a read-only SQL query against the database. */
export function executeQuery(sql: string): Promise<QueryResult> {
  return chatFetch<QueryResult>('/api/local/chat/query', {
    method: 'POST',
    body: JSON.stringify({ sql }),
  });
}

const DELETE_PROPOSAL_REGEX = /```delete_proposal\n([\s\S]*?)\n```/g;

/** Extract delete-proposal blocks from an assistant message. */
export function extractDeleteProposals(content: string): DeleteProposal[] {
  const proposals: DeleteProposal[] = [];
  let match;
  while ((match = DELETE_PROPOSAL_REGEX.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (!Array.isArray(parsed.deletions)) continue;
      const deletions = parsed.deletions.filter(
        (d: unknown) =>
          d &&
          typeof d === 'object' &&
          typeof (d as Record<string, unknown>).task_id === 'string'
      ) as DeleteProposalItem[];
      if (deletions.length > 0) {
        proposals.push({ deletions });
      }
    } catch {
      // malformed JSON, skip
    }
  }
  return proposals;
}
