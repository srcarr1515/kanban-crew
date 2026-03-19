import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowsInSimpleIcon,
  ArrowsOutSimpleIcon,
  CaretDownIcon,
  CircleNotchIcon,
  PaperclipIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
  UserCircleIcon,
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
} from '@/shared/lib/local/chatApi';
import {
  listCrewMembers,
  type CrewMember,
} from '@/shared/lib/local/localApi';
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
  const [optimisticImages, setOptimisticImages] = useState<Array<{ dataUrl: string; mimeType: string }>>([]);
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null);
  const [showCrewPicker, setShowCrewPicker] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ id: string; dataUrl: string; mimeType: string; name: string }>>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visionFallback, setVisionFallback] = useState<VisionFallbackInfo | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const crewPickerRef = useRef<HTMLDivElement>(null);

  // ── Crew members ──────────────────────────────────────────────
  const { data: crewMembers = [] } = useQuery({
    queryKey: ['local', 'crew-members'],
    queryFn: listCrewMembers,
    staleTime: 30_000,
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

  // Focus input when thread changes
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeThreadId]);

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
    if ((!text && attachments.length === 0) || !activeThreadId || isStreaming) return;

    const chatAttachments: ChatAttachment[] = attachments.map((a) => ({
      base64: a.dataUrl.split(',')[1],
      mime_type: a.mimeType,
    }));

    // Capture image data for optimistic rendering before clearing
    const optimisticImgs = attachments.map((a) => ({ dataUrl: a.dataUrl, mimeType: a.mimeType }));

    setInput('');
    setAttachments([]);
    setOptimisticText(text || '\u200b'); // zero-width space keeps bubble visible
    setOptimisticImages(optimisticImgs);
    setIsStreaming(true);
    setStreamingContent('');
    setErrorMessage(null);
    setVisionFallback(null);
    abortRef.current = false;

    // Check before streaming so we capture the pre-send state
    const activeThread = threads.find((t) => t.id === activeThreadId);
    const isFirstMessage = activeThread?.title === 'New Chat';

    try {
      let accumulated = '';
      for await (const chunk of streamChatCompletion(activeThreadId, text || ' ', selectedCrewId, chatAttachments)) {
        if (abortRef.current) break;
        if (chunk.type === 'text') {
          accumulated += chunk.text;
          setStreamingContent(accumulated);
        } else if (chunk.type === 'vision_fallback') {
          setVisionFallback(chunk.info);
        }
      }
    } catch (err) {
      // Extract a human-readable message from the API error
      const raw = err instanceof Error ? err.message : String(err);
      // The API wraps errors as JSON with {error:{message}}; try to extract it
      const jsonMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
      setErrorMessage(jsonMatch ? jsonMatch[1] : raw);
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
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
  }, [input, attachments, activeThreadId, isStreaming, selectedCrewId, queryClient, threads, crewMembers, projectId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const isCrewLocked = !!activeThread?.crew_member_id;
  const lockedCrewMember = isCrewLocked
    ? (crewMembers.find((m) => m.id === selectedCrewId) ?? null)
    : null;

  return (
    <div
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
        {isStreaming && <StreamingMessage content={streamingContent} crewMember={lockedCrewMember} />}
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
            <span className="ml-auto text-[10px] text-low" title={`Fallback: using ${visionFallback.vision_provider}/${visionFallback.vision_model} for vision`}>
              via {visionFallback.vision_model}
            </span>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t p-2 space-y-2">
        {/* Crew member picker / locked badge */}
        {isCrewLocked ? (
          <LockedCrewBadge crewMember={lockedCrewMember} />
        ) : (
          <CrewMemberPicker
            crewMembers={crewMembers}
            selectedCrewId={selectedCrewId}
            onSelect={setSelectedCrewId}
            showPicker={showCrewPicker}
            setShowPicker={setShowCrewPicker}
            pickerRef={crewPickerRef}
          />
        )}

        {/* Attachment thumbnails */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1">
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

        <div className="flex items-end gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              processFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!activeThreadId || isStreaming}
            className="shrink-0 p-2 text-low hover:text-normal hover:bg-secondary rounded-lg transition-colors disabled:opacity-40"
            title="Attach image"
          >
            <PaperclipIcon className="size-4" />
          </button>
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
            onClick={isStreaming ? () => { abortRef.current = true; } : handleSend}
            disabled={!isStreaming && ((!input.trim() && attachments.length === 0) || !activeThreadId)}
            className={`shrink-0 rounded-lg p-2 text-white transition-colors ${
              isStreaming
                ? 'bg-brand hover:bg-red-500'
                : 'bg-brand hover:bg-brand/90 disabled:opacity-40'
            }`}
            title={isStreaming ? 'Stop generating' : 'Send'}
          >
            {isStreaming ? (
              <span className="relative flex size-4 items-center justify-center">
                <CircleNotchIcon className="size-4 animate-spin" weight="bold" />
                <StopIcon className="absolute size-2" weight="fill" />
              </span>
            ) : (
              <PaperPlaneRightIcon className="size-4" weight="fill" />
            )}
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

function LockedCrewBadge({ crewMember }: { crewMember: CrewMember | null }) {
  const isImageAvatar = (avatar?: string) =>
    avatar?.startsWith('data:') || avatar?.startsWith('http');

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md text-xs text-low">
      {crewMember ? (
        <>
          <div className="flex items-center justify-center w-5 h-5 rounded-full overflow-hidden bg-brand/20 text-brand text-[10px] font-medium shrink-0">
            {isImageAvatar(crewMember.avatar) ? (
              <img src={crewMember.avatar} alt={crewMember.name} className="w-full h-full object-cover" />
            ) : (
              crewMember.avatar || crewMember.name.charAt(0).toUpperCase()
            )}
          </div>
          <span className="font-medium text-normal">{crewMember.name}</span>
          <span className="text-low">· locked</span>
        </>
      ) : (
        <>
          <UserCircleIcon className="size-4" weight="bold" />
          <span>Default AI · locked</span>
        </>
      )}
    </div>
  );
}

function CrewMemberPicker({
  crewMembers,
  selectedCrewId,
  onSelect,
  showPicker,
  setShowPicker,
  pickerRef,
}: {
  crewMembers: CrewMember[];
  selectedCrewId: string | null;
  onSelect: (id: string | null) => void;
  showPicker: boolean;
  setShowPicker: (show: boolean) => void;
  pickerRef: React.RefObject<HTMLDivElement>;
}) {
  const selected = crewMembers.find((m) => m.id === selectedCrewId);

  const isImageAvatar = (avatar?: string) =>
    avatar?.startsWith('data:') || avatar?.startsWith('http');

  useEffect(() => {
    if (!showPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPicker, pickerRef, setShowPicker]);

  return (
    <div ref={pickerRef} className="relative">
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className="flex items-center gap-2 px-2 py-1 rounded-md text-xs text-low hover:text-normal hover:bg-secondary transition-colors cursor-pointer"
      >
        {selected ? (
          <>
            <div className="flex items-center justify-center w-5 h-5 rounded-full overflow-hidden bg-brand/20 text-brand text-[10px] font-medium shrink-0">
              {isImageAvatar(selected.avatar) ? (
                <img src={selected.avatar} alt={selected.name} className="w-full h-full object-cover" />
              ) : (
                selected.avatar || selected.name.charAt(0).toUpperCase()
              )}
            </div>
            <span className="font-medium text-high">{selected.name}</span>
          </>
        ) : (
          <>
            <UserCircleIcon className="size-4" weight="bold" />
            <span>No crew member</span>
          </>
        )}
        <CaretDownIcon className="size-3" />
      </button>

      {showPicker && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-panel border border-border rounded-md shadow-lg min-w-[200px] py-1">
          {/* Default option */}
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setShowPicker(false);
            }}
            className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors cursor-pointer ${
              !selectedCrewId
                ? 'bg-brand/10 text-brand'
                : 'text-normal hover:bg-primary/10'
            }`}
          >
            <UserCircleIcon className="size-5" weight="bold" />
            <div className="text-left">
              <p className="font-medium">Default AI</p>
              <p className="text-xs text-low">No crew persona</p>
            </div>
          </button>

          {crewMembers.length > 0 && (
            <div className="border-t border-border my-1" />
          )}

          {crewMembers.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => {
                onSelect(member.id);
                setShowPicker(false);
              }}
              className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors cursor-pointer ${
                selectedCrewId === member.id
                  ? 'bg-brand/10 text-brand'
                  : 'text-normal hover:bg-primary/10'
              }`}
            >
              <div className="flex items-center justify-center w-5 h-5 rounded-full overflow-hidden bg-brand/20 text-brand text-[10px] font-medium shrink-0">
                {isImageAvatar(member.avatar) ? (
                  <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
                ) : (
                  member.avatar || member.name.charAt(0).toUpperCase()
                )}
              </div>
              <div className="text-left min-w-0">
                <p className="font-medium truncate">{member.name}</p>
                <p className="text-xs text-low truncate">{member.role}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
