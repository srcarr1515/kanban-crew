import { getAuthRuntime } from '@/shared/lib/auth/runtime';
import { makeLocalApiRequest } from '@/shared/lib/localApiTransport';

interface ApiResponse<T> {
  data: T;
}

/**
 * Build request headers with auth token (when available).
 * Matches the makeAuthenticatedRequest pattern from remoteApi.ts.
 */
async function buildAuthHeaders(
  extra: HeadersInit = {}
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extra as Record<string, string>),
  };
  try {
    const token = await getAuthRuntime().getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {
    // Auth runtime may not be configured (e.g. in tests) — proceed without token
  }
  return headers;
}

/**
 * Make an authenticated local API request with 401 retry.
 * On a 401 response, triggers a token refresh and retries once.
 */
async function makeAuthenticatedLocalRequest(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = await buildAuthHeaders(
    init.headers as Record<string, string>
  );
  const response = await makeLocalApiRequest(path, { ...init, headers });

  if (response.status === 401) {
    try {
      const newToken = await getAuthRuntime().triggerRefresh();
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`;
        return makeLocalApiRequest(path, { ...init, headers });
      }
    } catch {
      // Refresh failed — return original 401 response
    }
  }

  return response;
}

async function chatFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await makeAuthenticatedLocalRequest(path, init);
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
  files_affected?: string[];
  acceptance_criteria?: string[];
  subtasks?: ProposalTicket[];
}

export interface Proposal {
  tickets: ProposalTicket[];
}

/** Build a structured description from the enriched proposal fields. */
export function buildTicketDescription(ticket: ProposalTicket): string {
  let desc = ticket.description || '';

  if (ticket.files_affected && ticket.files_affected.length > 0) {
    if (desc) desc += '\n\n';
    desc += '## Files Affected\n';
    desc += ticket.files_affected.map((f) => `- ${f}`).join('\n');
  }

  if (ticket.acceptance_criteria && ticket.acceptance_criteria.length > 0) {
    if (desc) desc += '\n\n';
    desc += '## Acceptance Criteria\n';
    desc += ticket.acceptance_criteria.map((c) => `- [ ] ${c}`).join('\n');
  }

  return desc;
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

export interface ArtifactBlock {
  artifact_type: string;
  title: string;
  content: string;
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
  | { type: 'vision_fallback'; info: VisionFallbackInfo }
  | { type: 'tool_status'; content: string }
  | { type: 'proposal'; data: Proposal }
  | { type: 'modify_proposal'; data: ModifyProposal }
  | { type: 'delete_proposal'; data: DeleteProposal };

/**
 * Send a message and stream the assistant response.
 * Returns an async generator that yields stream chunks (text deltas and metadata).
 * The full user + assistant messages are persisted server-side.
 */
export async function* streamChatCompletion(
  threadId: string,
  content: string,
  crewMemberId?: string | null,
  attachments?: ChatAttachment[],
  signal?: AbortSignal
): AsyncGenerator<StreamChunk, void, unknown> {
  const body: Record<string, unknown> = { thread_id: threadId, content };
  if (crewMemberId) body.crew_member_id = crewMemberId;
  if (attachments && attachments.length > 0) body.images = attachments;

  const res = await makeAuthenticatedLocalRequest(
    '/api/local/chat/completions',
    {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Chat completion error ${res.status}: ${errBody}`);
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
        if (event.type === 'content_block_delta' && event.delta?.text) {
          yield { type: 'text', text: event.delta.text };
        } else if (event.type === 'vision_fallback' && event.metadata) {
          yield {
            type: 'vision_fallback',
            info: event.metadata as VisionFallbackInfo,
          };
        } else if (event.type === 'tool_status' && event.content) {
          yield { type: 'tool_status', content: event.content as string };
        } else if (event.type === 'proposal' && event.data) {
          yield { type: 'proposal', data: event.data as Proposal };
        } else if (event.type === 'modify_proposal' && event.data) {
          yield { type: 'modify_proposal', data: event.data as ModifyProposal };
        } else if (event.type === 'delete_proposal' && event.data) {
          yield { type: 'delete_proposal', data: event.data as DeleteProposal };
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROPOSAL_REGEX = /```proposal\s*\n([\s\S]*?)```/g;

/** Normalize a raw parsed object into a ProposalTicket, returning null if invalid. */
function normalizeTicket(raw: unknown): ProposalTicket | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.title !== 'string' || !t.title.trim()) return null;
  return {
    title: t.title.trim(),
    description: typeof t.description === 'string' ? t.description : '',
    status: typeof t.status === 'string' ? t.status : 'todo',
    files_affected: Array.isArray(t.files_affected)
      ? t.files_affected.filter((f): f is string => typeof f === 'string')
      : undefined,
    acceptance_criteria: Array.isArray(t.acceptance_criteria)
      ? t.acceptance_criteria.filter((c): c is string => typeof c === 'string')
      : undefined,
    subtasks: Array.isArray(t.subtasks)
      ? (t.subtasks.map(normalizeTicket).filter(Boolean) as ProposalTicket[])
      : undefined,
  };
}

/**
 * Attempt to repair common AI JSON mistakes (unbalanced brackets/braces).
 * Tries to fix missing ] and } at the end of the string.
 */
function tryRepairJson(raw: string): unknown | null {
  // First try as-is
  try {
    return JSON.parse(raw);
  } catch {
    // ignore
  }

  // Count unbalanced brackets/braces and try appending closers
  let brackets = 0;
  let braces = 0;
  let inString = false;
  let escape = false;
  for (const ch of raw) {
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
    else if (ch === '{') braces++;
    else if (ch === '}') braces--;
  }

  if (brackets >= 0 && braces >= 0) {
    const repaired = raw + ']'.repeat(brackets) + '}'.repeat(braces);
    try {
      return JSON.parse(repaired);
    } catch {
      // ignore
    }
    // Try the other order (braces then brackets)
    const repaired2 = raw + '}'.repeat(braces) + ']'.repeat(brackets);
    try {
      return JSON.parse(repaired2);
    } catch {
      // ignore
    }
  }

  return null;
}

/** Extract and normalize proposal blocks from an assistant message. */
export function extractProposals(content: string): Proposal[] {
  const proposals: Proposal[] = [];
  let match;
  while ((match = PROPOSAL_REGEX.exec(content)) !== null) {
    const parsed = tryRepairJson(match[1]);
    if (!parsed || typeof parsed !== 'object') continue;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.tickets)) continue;
    const tickets = obj.tickets
      .map(normalizeTicket)
      .filter(Boolean) as ProposalTicket[];
    if (tickets.length > 0) {
      proposals.push({ tickets });
    }
  }
  return proposals;
}

const MODIFY_PROPOSAL_REGEX = /```modify_proposal\s*\n([\s\S]*?)```/g;

/** Extract modify-proposal blocks from an assistant message. */
export function extractModifyProposals(content: string): ModifyProposal[] {
  const proposals: ModifyProposal[] = [];
  let match;
  while ((match = MODIFY_PROPOSAL_REGEX.exec(content)) !== null) {
    const parsed = tryRepairJson(match[1]);
    if (!parsed || typeof parsed !== 'object') continue;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.modifications)) continue;
    const modifications = obj.modifications.filter(
      (m: unknown) =>
        m &&
        typeof m === 'object' &&
        typeof (m as Record<string, unknown>).task_id === 'string'
    ) as ModifyProposalItem[];
    if (modifications.length > 0) {
      proposals.push({ modifications });
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
export function executeQuery(
  sql: string,
  crewMemberId?: string
): Promise<QueryResult> {
  return chatFetch<QueryResult>('/api/local/chat/query', {
    method: 'POST',
    body: JSON.stringify({ sql, crew_member_id: crewMemberId ?? null }),
  });
}

const ARTIFACT_BLOCK_REGEX = /```artifact\n([\s\S]*?)\n```/g;

const VALID_ARTIFACT_TYPES = [
  'spec',
  'test_plan',
  'bug_report',
  'design_notes',
  'review',
  'other',
];

/** Normalize a raw parsed object into an ArtifactBlock, returning null if invalid. */
function normalizeArtifact(raw: unknown): ArtifactBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.title !== 'string' || !a.title.trim()) return null;
  if (
    typeof a.artifact_type !== 'string' ||
    !VALID_ARTIFACT_TYPES.includes(a.artifact_type)
  )
    return null;
  return {
    artifact_type: a.artifact_type,
    title: a.title.trim(),
    content: typeof a.content === 'string' ? a.content : '',
  };
}

/** Extract artifact blocks from an assistant message. */
export function extractArtifacts(content: string): ArtifactBlock[] {
  const artifacts: ArtifactBlock[] = [];
  let match;
  while ((match = ARTIFACT_BLOCK_REGEX.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const normalized = normalizeArtifact(parsed);
      if (normalized) {
        artifacts.push(normalized);
      }
    } catch {
      // malformed JSON, skip
    }
  }
  return artifacts;
}

const DELETE_PROPOSAL_REGEX = /```delete_proposal\s*\n([\s\S]*?)```/g;

/** Extract delete-proposal blocks from an assistant message. */
export function extractDeleteProposals(content: string): DeleteProposal[] {
  const proposals: DeleteProposal[] = [];
  let match;
  while ((match = DELETE_PROPOSAL_REGEX.exec(content)) !== null) {
    const parsed = tryRepairJson(match[1]);
    if (!parsed || typeof parsed !== 'object') continue;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.deletions)) continue;
    const deletions = obj.deletions.filter(
      (d: unknown) =>
        d &&
        typeof d === 'object' &&
        typeof (d as Record<string, unknown>).task_id === 'string'
    ) as DeleteProposalItem[];
    if (deletions.length > 0) {
      proposals.push({ deletions });
    }
  }
  return proposals;
}
