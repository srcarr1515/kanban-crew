import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import {
  listChatThreads,
  createChatThread,
  deleteChatThread,
  listChatMessages,
  streamChatCompletion,
  type ChatThread,
} from '@/shared/lib/local/chatApi';
import { ChatMessageBubble, StreamingMessage } from './ChatMessage';
import { useChatStore } from './useChatStore';

export function ChatPanel() {
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const { activeThreadId, setActiveThread, close, isFullscreen, toggleFullscreen } = useChatStore();
  const [input, setInput] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [optimisticText, setOptimisticText] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef(false);

  // ── Threads ──────────────────────────────────────────────────────
  const { data: threads = [], isPending: isThreadsPending } = useQuery({
    queryKey: ['chat-threads', projectId],
    queryFn: () => listChatThreads(projectId),
    refetchOnWindowFocus: false,
  });

  // ── Messages for active thread ──────────────────────────────────
  const { data: messages = [] } = useQuery({
    queryKey: ['chat-messages', activeThreadId],
    queryFn: () => (activeThreadId ? listChatMessages(activeThreadId) : []),
    enabled: !!activeThreadId,
    refetchOnWindowFocus: false,
  });

  // Auto-scroll when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, optimisticText]);

  // Focus input when thread changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeThreadId]);

  // ── Create thread ────────────────────────────────────────────────
  const handleNewThread = useCallback(async () => {
    const thread = await createChatThread({ project_id: projectId });
    await queryClient.invalidateQueries({ queryKey: ['chat-threads', projectId] });
    setActiveThread(thread.id);
  }, [projectId, queryClient, setActiveThread]);

  // Auto-select or auto-create a thread
  const autoCreatingRef = useRef(false);
  useEffect(() => {
    // Wait for threads to load before deciding to auto-create
    if (isThreadsPending) return;

    if (threads.length > 0) {
      if (!activeThreadId || !threads.find((t) => t.id === activeThreadId)) {
        setActiveThread(threads[0].id);
      }
      return;
    }
    // No threads — create one automatically
    if (autoCreatingRef.current) return;
    autoCreatingRef.current = true;
    createChatThread({ project_id: projectId }).then((thread) => {
      queryClient.invalidateQueries({ queryKey: ['chat-threads', projectId] });
      setActiveThread(thread.id);
      autoCreatingRef.current = false;
    }).catch(() => {
      autoCreatingRef.current = false;
    });
  }, [threads, activeThreadId, setActiveThread, isThreadsPending]);

  // ── Delete thread ────────────────────────────────────────────────
  const handleDeleteThread = useCallback(
    async (e: React.MouseEvent, threadId: string) => {
      e.stopPropagation();
      await deleteChatThread(threadId);
      await queryClient.invalidateQueries({ queryKey: ['chat-threads', projectId] });
      if (activeThreadId === threadId) {
        const remaining = threads.filter((t) => t.id !== threadId);
        setActiveThread(remaining.length > 0 ? remaining[0].id : null);
      }
    },
    [activeThreadId, threads, projectId, queryClient, setActiveThread]
  );

  // ── Send message ─────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !activeThreadId || isStreaming) return;

    setInput('');
    setOptimisticText(text);
    setIsStreaming(true);
    setStreamingContent('');
    abortRef.current = false;

    try {
      let accumulated = '';
      for await (const chunk of streamChatCompletion(activeThreadId, text)) {
        if (abortRef.current) break;
        accumulated += chunk;
        setStreamingContent(accumulated);
      }
    } catch {
      // Stream ended or error
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      setOptimisticText(null);
      // Refresh messages to get the persisted user + assistant messages
      await queryClient.invalidateQueries({
        queryKey: ['chat-messages', activeThreadId],
      });
    }
  }, [input, activeThreadId, isStreaming, queryClient]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex flex-col h-full bg-primary">
      {/* Header with thread tabs */}
      <div className="shrink-0 border-b flex items-center gap-0 overflow-hidden">
        <div className="flex-1 flex items-center gap-0 overflow-x-auto min-w-0 scrollbar-none">
          {threads.map((thread) => (
            <ThreadTab
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              onSelect={() => setActiveThread(thread.id)}
              onDelete={(e) => handleDeleteThread(e, thread.id)}
            />
          ))}
          <button
            type="button"
            onClick={handleNewThread}
            className="shrink-0 p-2 text-low hover:text-normal hover:bg-panel transition-colors"
            title="New thread"
          >
            <PlusIcon className="size-4" weight="bold" />
          </button>
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="shrink-0 p-2 text-low hover:text-normal hover:bg-panel transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? (
            <ArrowsInSimpleIcon className="size-4" weight="bold" />
          ) : (
            <ArrowsOutSimpleIcon className="size-4" weight="bold" />
          )}
        </button>
        <button
          type="button"
          onClick={close}
          className="shrink-0 p-2 text-low hover:text-normal hover:bg-panel transition-colors"
          title="Close chat"
        >
          <XIcon className="size-4" weight="bold" />
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !isStreaming && !optimisticText && (
          <div className="flex items-center justify-center h-full text-low text-sm">
            Start a conversation to brainstorm ideas and create tickets.
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
        {optimisticText && (
          <ChatMessageBubble
            message={{
              id: '__optimistic__',
              thread_id: activeThreadId ?? '',
              role: 'user',
              content: optimisticText,
              metadata: null,
              created_at: new Date().toISOString(),
            }}
          />
        )}
        {isStreaming && <StreamingMessage content={streamingContent} />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t p-2">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activeThreadId ? 'Ask anything...' : 'Create a thread to start'}
            disabled={!activeThreadId || isStreaming}
            rows={4}
            className="flex-1 resize-none rounded-lg border bg-secondary px-3 py-2 text-sm text-high placeholder:text-low focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || !activeThreadId || isStreaming}
            className="shrink-0 rounded-lg bg-brand p-2 text-white hover:bg-brand/90 transition-colors disabled:opacity-40"
            title="Send"
          >
            <PaperPlaneRightIcon className="size-4" weight="fill" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ThreadTab({
  thread,
  isActive,
  onSelect,
  onDelete,
}: {
  thread: ChatThread;
  isActive: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative flex items-center gap-1.5 shrink-0 px-3 py-2 text-xs border-r transition-colors max-w-[160px] ${
        isActive
          ? 'bg-primary text-high border-b-2 border-b-brand'
          : 'bg-secondary text-low hover:text-normal hover:bg-panel border-b-2 border-b-transparent'
      }`}
    >
      <span className="truncate">{thread.title}</span>
      <span
        role="button"
        tabIndex={-1}
        onClick={onDelete}
        className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-all"
        title="Delete thread"
      >
        <TrashIcon className="size-3" />
      </span>
    </button>
  );
}
