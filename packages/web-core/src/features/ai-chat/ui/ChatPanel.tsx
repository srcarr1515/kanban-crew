import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  PaperclipIcon,
  PlusIcon,
  StopIcon,
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
  updateChatThreadTitle,
  type ChatAttachment,
  type ChatThread,
  type VisionFallbackInfo,
  type Proposal,
  type ModifyProposal,
  type DeleteProposal,
} from '@/shared/lib/local/chatApi';
import { listCrewMembers, listLocalTasks } from '@/shared/lib/local/localApi';
import {
  ChatToolbar,
  type ChatToolbarCrewMemberProps,
  type ChatToolbarFileUploadProps,
} from '@vibe/ui/components/ChatToolbar';
import { ChatMessageBubble, StreamingMessage } from './ChatMessage';
import { ProposalCard } from './ProposalCard';
import { ModifyProposalCard } from './ModifyProposalCard';
import { DeleteProposalCard } from './DeleteProposalCard';
import { useChatStore } from './useChatStore';

export function ChatPanel() {
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const { activeThreadId, setActiveThread, close, isFullscreen, toggleFullscreen, attachedTickets, attachTicket, detachTicket, clearAttachedTickets, draggingIssueId, setDraggingIssueId, setChatPanelRef } = useChatStore();
  const [input, setInput] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [optimisticText, setOptimisticText] = useState<string | null>(null);
  const [optimisticImages, setOptimisticImages] = useState<Array<{ dataUrl: string; mimeType: string }>>([]);
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ id: string; dataUrl: string; mimeType: string; name: string }>>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visionFallback, setVisionFallback] = useState<VisionFallbackInfo | null>(null);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [streamingProposals, setStreamingProposals] = useState<Proposal[]>([]);
  const [streamingModifyProposals, setStreamingModifyProposals] = useState<ModifyProposal[]>([]);
  const [streamingDeleteProposals, setStreamingDeleteProposals] = useState<DeleteProposal[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleStop = useCallback(() => {
    abortRef.current = true;
    abortControllerRef.current?.abort();
  }, []);

  // ── Crew members ──────────────────────────────────────────────
  const { data: crewMembers = [] } = useQuery({
    queryKey: ['local', 'crew-members'],
    queryFn: listCrewMembers,
    staleTime: 30_000,
  });

  // ── Local tasks (for ticket drag-to-chat lookup) ────────────────
  const { data: localTasks = [] } = useQuery({
    queryKey: ['local', 'tasks', projectId],
    queryFn: () => listLocalTasks(projectId),
    staleTime: 10_000,
  });

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

  // Restore crew member selection from locked thread when switching threads
  useEffect(() => {
    const activeThread = threads.find((t) => t.id === activeThreadId);
    setSelectedCrewId(activeThread?.crew_member_id ?? null);
  }, [activeThreadId, threads]);

  // ── File attachments ─────────────────────────────────────────────
  const processFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        setAttachments((prev) => [
          ...prev,
          { id: crypto.randomUUID(), dataUrl, mimeType: file.type, name: file.name },
        ]);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      processFiles(Array.from(e.dataTransfer.files));
    },
    [processFiles]
  );

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
    createChatThread({ project_id: projectId }).then(async (thread) => {
      setActiveThread(thread.id);
      // Await the invalidation so `threads` updates before we reset the guard,
      // preventing a second auto-create from a stale empty threads list.
      await queryClient.invalidateQueries({ queryKey: ['chat-threads', projectId] });
      autoCreatingRef.current = false;
    }).catch(() => {
      autoCreatingRef.current = false;
    });
  }, [threads, activeThreadId, setActiveThread, isThreadsPending]);

  // ── Delete thread ────────────────────────────────────────────────
  const handleDeleteThread = useCallback(
    async (e: React.MouseEvent, threadId: string) => {
      e.stopPropagation();
      const remaining = threads.filter((t) => t.id !== threadId);
      await deleteChatThread(threadId);

      if (remaining.length === 0) {
        // Last thread deleted — create a replacement directly and guard
        // against the auto-create effect also firing.
        autoCreatingRef.current = true;
        try {
          const newThread = await createChatThread({ project_id: projectId });
          await queryClient.invalidateQueries({ queryKey: ['chat-threads', projectId] });
          setActiveThread(newThread.id);
        } finally {
          autoCreatingRef.current = false;
        }
      } else {
        await queryClient.invalidateQueries({ queryKey: ['chat-threads', projectId] });
        if (activeThreadId === threadId) {
          setActiveThread(remaining[0].id);
        }
      }
    },
    [activeThreadId, threads, projectId, queryClient, setActiveThread]
  );

  // ── Send message ─────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0 && attachedTickets.length === 0) || !activeThreadId || isStreaming) return;

    // Build the effective prompt: prepend ticket context if tickets are attached
    let effectiveText = text;
    if (attachedTickets.length > 0) {
      const ticketContext = attachedTickets
        .map((t) => `[Attached Ticket: ${t.title} (${t.id.slice(0, 8)}) — status: ${t.status}${t.description ? `\nDescription: ${t.description}` : ''}]`)
        .join('\n');
      effectiveText = ticketContext + (text ? `\n\n${text}` : '');
    }

    const chatAttachments: ChatAttachment[] = attachments.map((a) => ({
      base64: a.dataUrl.split(',')[1],
      mime_type: a.mimeType,
    }));

    // Capture image data for optimistic rendering before clearing
    const optimisticImgs = attachments.map((a) => ({ dataUrl: a.dataUrl, mimeType: a.mimeType }));

    setInput('');
    setAttachments([]);
    clearAttachedTickets();
    setOptimisticText(text || '\u200b'); // zero-width space keeps bubble visible
    setOptimisticImages(optimisticImgs);
    setIsStreaming(true);
    setStreamingContent('');
    setErrorMessage(null);
    setVisionFallback(null);
    setToolStatus(null);
    setStreamingProposals([]);
    setStreamingModifyProposals([]);
    setStreamingDeleteProposals([]);
    abortRef.current = false;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Check before streaming so we capture the pre-send state
    const activeThread = threads.find((t) => t.id === activeThreadId);
    const isFirstMessage = activeThread?.title === 'New Chat';

    try {
      let accumulated = '';
      for await (const chunk of streamChatCompletion(activeThreadId, effectiveText || ' ', selectedCrewId, chatAttachments, controller.signal)) {
        if (abortRef.current) break;
        if (chunk.type === 'text') {
          // Clear tool status once text starts arriving
          setToolStatus(null);
          accumulated += chunk.text;
          setStreamingContent(accumulated);
        } else if (chunk.type === 'vision_fallback') {
          setVisionFallback(chunk.info);
        } else if (chunk.type === 'tool_status') {
          setToolStatus(chunk.content);
        } else if (chunk.type === 'proposal') {
          setStreamingProposals((prev) => [...prev, chunk.data]);
        } else if (chunk.type === 'modify_proposal') {
          setStreamingModifyProposals((prev) => [...prev, chunk.data]);
        } else if (chunk.type === 'delete_proposal') {
          setStreamingDeleteProposals((prev) => [...prev, chunk.data]);
        }
      }
    } catch (err) {
      // Ignore abort errors — they're expected when the user clicks stop
      if (err instanceof DOMException && err.name === 'AbortError') {
        // intentionally empty
      } else {
        // Extract a human-readable message from the API error
        const raw = err instanceof Error ? err.message : String(err);
        // The API wraps errors as JSON with {error:{message}}; try to extract it
        const jsonMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
        setErrorMessage(jsonMatch ? jsonMatch[1] : raw);
      }
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamingContent('');
      setToolStatus(null);
      setOptimisticText(null);
      setOptimisticImages([]);
      // Refresh messages to get the persisted user + assistant messages
      await queryClient.invalidateQueries({
        queryKey: ['chat-messages', activeThreadId],
      });
      // Auto-rename thread on first message
      if (isFirstMessage) {
        let newTitle: string;
        if (selectedCrewId) {
          const crew = crewMembers.find((m) => m.id === selectedCrewId);
          newTitle = crew ? `Chat with ${crew.name}` : text.slice(0, 50).trim();
        } else {
          newTitle = text.slice(0, 50).trim();
        }
        try {
          await updateChatThreadTitle(activeThreadId, newTitle);
          await queryClient.invalidateQueries({ queryKey: ['chat-threads', projectId] });
        } catch {
          // Non-critical, ignore rename failure
        }
      }
    }
  }, [input, attachments, attachedTickets, clearAttachedTickets, activeThreadId, isStreaming, selectedCrewId, queryClient, threads, crewMembers, projectId]);

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const isCrewLocked = !!activeThread?.crew_member_id;
  const lockedCrewMember = isCrewLocked
    ? (crewMembers.find((m) => m.id === selectedCrewId) ?? null)
    : null;

  const crewMemberProp = useMemo<ChatToolbarCrewMemberProps | undefined>(() => {
    if (crewMembers.length === 0) return undefined;
    return {
      selected: selectedCrewId,
      options: crewMembers.map((m) => ({
        id: m.id,
        name: m.name,
        avatar: m.avatar,
        role: m.role,
      })),
      onChange: setSelectedCrewId,
      locked: isCrewLocked,
    };
  }, [crewMembers, selectedCrewId, isCrewLocked]);

  const fileUploadProp = useMemo<ChatToolbarFileUploadProps>(() => ({
    onAttachFiles: (files: File[]) => processFiles(files),
    accept: 'image/*',
    attachLabel: 'Attach image',
    disabled: !activeThreadId || isStreaming,
  }), [processFiles, activeThreadId, isStreaming]);

  return (
    <div
      ref={useCallback((el: HTMLDivElement | null) => setChatPanelRef(el), [setChatPanelRef])}
      className="relative flex flex-col h-full bg-primary"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center border-2 border-dashed border-brand bg-primary/90 backdrop-blur-sm pointer-events-none">
          <div className="text-center">
            <PaperclipIcon className="size-8 text-brand mx-auto mb-2" weight="bold" />
            <p className="text-sm font-medium text-high">Drop images here</p>
          </div>
        </div>
      )}
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
          <ChatMessageBubble key={msg.id} message={msg} crewMember={lockedCrewMember} />
        ))}
        {optimisticText && (
          <ChatMessageBubble
            message={{
              id: '__optimistic__',
              thread_id: activeThreadId ?? '',
              role: 'user',
              content: optimisticText,
              metadata: optimisticImages.length > 0
                ? JSON.stringify({ images: optimisticImages.map((img) => ({ dataUrl: img.dataUrl, mime_type: img.mimeType })) })
                : null,
              created_at: new Date().toISOString(),
            }}
          />
        )}
        {isStreaming && toolStatus && !streamingContent && (
          <div className="flex gap-2.5 px-3 py-2">
            <div className="shrink-0 flex items-center justify-center size-7" />
            <div className="text-xs text-muted-foreground animate-pulse">
              {toolStatus}
            </div>
          </div>
        )}
        {isStreaming && <StreamingMessage content={streamingContent} crewMember={lockedCrewMember} />}
        {streamingProposals.map((p, i) => (
          <ProposalCard key={`sp-${i}`} proposal={p} crewMemberId={selectedCrewId ?? undefined} />
        ))}
        {streamingModifyProposals.map((p, i) => (
          <ModifyProposalCard key={`smp-${i}`} proposal={p} crewMemberId={selectedCrewId ?? undefined} />
        ))}
        {streamingDeleteProposals.map((p, i) => (
          <DeleteProposalCard key={`sdp-${i}`} proposal={p} crewMemberId={selectedCrewId ?? undefined} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="shrink-0 border-t border-red-500/30 bg-red-500/10 px-3 py-2 flex items-start gap-2 text-xs">
          <span className="text-red-400 font-medium flex-1">{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="shrink-0 text-red-400/60 hover:text-red-400 transition-colors"
            title="Dismiss"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}

      {/* Streaming status bar — always visible above the input regardless of scroll */}
      {isStreaming && (
        <div className="shrink-0 border-t border-brand/30 bg-brand/5 px-3 py-1.5 flex items-center gap-2 text-xs">
          <span className="inline-flex gap-0.5 shrink-0">
            <span
              className="size-1.5 rounded-full bg-brand animate-bounce"
              style={{ animationDelay: '0ms', animationDuration: '1s' }}
            />
            <span
              className="size-1.5 rounded-full bg-brand animate-bounce"
              style={{ animationDelay: '150ms', animationDuration: '1s' }}
            />
            <span
              className="size-1.5 rounded-full bg-brand animate-bounce"
              style={{ animationDelay: '300ms', animationDuration: '1s' }}
            />
          </span>
          <span className="text-brand/80 font-medium">
            {lockedCrewMember ? `${lockedCrewMember.name} is thinking…` : 'Thinking…'}
          </span>
          {visionFallback && (
            <span className="text-[10px] text-low" title={`Fallback: using ${visionFallback.vision_provider}/${visionFallback.vision_model} for vision`}>
              via {visionFallback.vision_model}
            </span>
          )}
          <button
            type="button"
            onClick={handleStop}
            className="ml-auto shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-brand/80 hover:text-brand hover:bg-brand/10 transition-colors"
            title="Stop generating"
          >
            <StopIcon className="size-3.5" weight="fill" />
            Stop
          </button>
        </div>
      )}

      {/* Attachment thumbnails */}
      {attachments.length > 0 && (
        <div className="shrink-0 border-t px-3 pt-2 flex flex-wrap gap-2">
          {attachments.map((att) => (
            <div key={att.id} className="relative group">
              <img
                src={att.dataUrl}
                alt={att.name}
                className="h-16 w-16 object-cover rounded-md border border-border"
              />
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                className="absolute -top-1 -right-1 size-4 rounded-full bg-panel border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove"
              >
                <XIcon className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Attached ticket pills */}
      {attachedTickets.length > 0 && (
        <div className="shrink-0 border-t px-3 pt-2 flex flex-wrap gap-1.5">
          {attachedTickets.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() => detachTicket(ticket.id)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-brand/15 text-brand border border-brand/30 hover:bg-red-500/15 hover:text-red-500 hover:border-red-500/30 transition-colors"
              title={`${ticket.title} — click to remove`}
            >
              <span className="font-mono">{ticket.id.slice(0, 8)}</span>
              <XIcon className="size-3" />
            </button>
          ))}
        </div>
      )}

      {/* Drop zone overlay when dragging a kanban card */}
      {draggingIssueId && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-brand/10 border-2 border-dashed border-brand rounded-xl cursor-copy"
          onMouseUp={() => {
            // Attachment is handled by KanbanContainer's handleDragEnd via hit-testing
          }}
        >
          <span className="text-brand font-medium text-sm pointer-events-none">
            Drop ticket to attach
          </span>
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t p-2">
        <ChatToolbar
          crewMember={crewMemberProp}
          fileUpload={fileUploadProp}
          editor={{
            value: input,
            onChange: (v) => setInput(v),
            onCmdEnter: handleSend,
            placeholder: activeThreadId ? 'Ask anything...' : 'Create a thread to start',
            disabled: !activeThreadId || isStreaming,
          }}
          disabled={!activeThreadId || isStreaming}
        />
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

