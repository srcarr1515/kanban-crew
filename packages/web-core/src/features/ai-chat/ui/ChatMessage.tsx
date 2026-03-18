import { useEffect, useMemo, useState } from 'react';
import { RobotIcon, UserIcon } from '@phosphor-icons/react';
import type { ChatMessage as ChatMessageType } from '@/shared/lib/local/chatApi';
import { extractProposals, extractModifyProposals, extractDeleteProposals, extractQueryBlocks } from '@/shared/lib/local/chatApi';
import type { CrewMember } from '@/shared/lib/local/localApi';
import { ProposalCard } from './ProposalCard';
import { ModifyProposalCard } from './ModifyProposalCard';
import { DeleteProposalCard } from './DeleteProposalCard';
import { QueryCard } from './QueryCard';

interface ChatMessageProps {
  message: ChatMessageType;
  crewMember?: CrewMember | null;
}

function AssistantAvatar({ crewMember }: { crewMember?: CrewMember | null }) {
  if (!crewMember) {
    return <RobotIcon className="size-4" weight="fill" />;
  }
  const isImage =
    crewMember.avatar?.startsWith('data:') || crewMember.avatar?.startsWith('http');
  if (isImage) {
    return <img src={crewMember.avatar} alt={crewMember.name} className="w-full h-full object-cover" />;
  }
  return <>{crewMember.avatar || crewMember.name.charAt(0).toUpperCase()}</>;
}

interface MessageImage {
  dataUrl: string;
  mime_type: string;
}

interface VisionFallbackMeta {
  vision_fallback: true;
  vision_provider: string;
  vision_model: string;
}

function parseMessageImages(metadata: string | null): MessageImage[] {
  if (!metadata) return [];
  try {
    const parsed = JSON.parse(metadata);
    if (Array.isArray(parsed.images)) return parsed.images as MessageImage[];
  } catch {
    // invalid metadata, skip
  }
  return [];
}

function parseVisionFallback(metadata: string | null): VisionFallbackMeta | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    if (parsed.vision_fallback === true) return parsed as VisionFallbackMeta;
  } catch {
    // invalid metadata, skip
  }
  return null;
}

export function ChatMessageBubble({ message, crewMember }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const images = useMemo(() => parseMessageImages(message.metadata), [message.metadata]);
  const visionFallback = useMemo(
    () => (isAssistant ? parseVisionFallback(message.metadata) : null),
    [isAssistant, message.metadata]
  );
  const proposals = useMemo(
    () => (isAssistant ? extractProposals(message.content) : []),
    [isAssistant, message.content]
  );
  const modifyProposals = useMemo(
    () => (isAssistant ? extractModifyProposals(message.content) : []),
    [isAssistant, message.content]
  );
  const deleteProposals = useMemo(
    () => (isAssistant ? extractDeleteProposals(message.content) : []),
    [isAssistant, message.content]
  );
  const queryBlocks = useMemo(
    () => (isAssistant ? extractQueryBlocks(message.content) : []),
    [isAssistant, message.content]
  );

  const hasProposals = proposals.length > 0 || modifyProposals.length > 0 || deleteProposals.length > 0 || queryBlocks.length > 0;

  // Strip all proposal/query blocks from display text
  const displayContent = useMemo(() => {
    if (!hasProposals) return message.content;
    return message.content
      .replace(/```(?:proposal|modify_proposal|delete_proposal|query)\n[\s\S]*?\n```/g, '')
      .trim();
  }, [message.content, hasProposals]);

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`shrink-0 flex items-center justify-center size-7 rounded-full overflow-hidden text-[10px] font-medium ${
          isUser
            ? 'bg-brand/15 text-brand'
            : crewMember
              ? 'bg-brand/20 text-brand'
              : 'bg-panel text-low'
        }`}
      >
        {isUser ? (
          <UserIcon className="size-4" weight="fill" />
        ) : (
          <AssistantAvatar crewMember={crewMember} />
        )}
      </div>
      <div className={`min-w-0 max-w-[85%] space-y-1 ${isUser ? 'items-end' : ''}`}>
        {images.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 ${isUser ? 'justify-end' : ''}`}>
            {images.map((img, i) => (
              <img
                key={i}
                src={img.dataUrl}
                alt="attachment"
                className="max-h-48 max-w-full rounded-lg object-contain"
              />
            ))}
          </div>
        )}
        <div
          className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-brand text-white rounded-tr-sm'
              : 'bg-panel text-high rounded-tl-sm'
          }`}
        >
          {displayContent}
        </div>
        {visionFallback && (
          <div
            className="text-[10px] text-low px-1"
            title={`Vision fallback: ${visionFallback.vision_provider}/${visionFallback.vision_model}`}
          >
            via {visionFallback.vision_model}
          </div>
        )}
        {proposals.map((proposal, i) => (
          <ProposalCard key={`create-${i}`} proposal={proposal} />
        ))}
        {modifyProposals.map((proposal, i) => (
          <ModifyProposalCard key={`modify-${i}`} proposal={proposal} />
        ))}
        {deleteProposals.map((proposal, i) => (
          <DeleteProposalCard key={`delete-${i}`} proposal={proposal} />
        ))}
        {queryBlocks.map((query, i) => (
          <QueryCard key={`query-${i}`} query={query} />
        ))}
      </div>
    </div>
  );
}

const RESEARCH_PHASES = ['thinking', 'researching', 'analyzing'] as const;

function ResearchingIndicator({ crewMember }: { crewMember?: CrewMember | null }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase((p) => (p + 1) % RESEARCH_PHASES.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const label = crewMember
    ? `${crewMember.name} is ${RESEARCH_PHASES[phase]}…`
    : `${RESEARCH_PHASES[phase].charAt(0).toUpperCase()}${RESEARCH_PHASES[phase].slice(1)}`;

  return (
    <span className="inline-flex items-center gap-2 text-brand/70">
      <span className="inline-flex gap-0.5 items-center">
        <span
          className="size-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: '0ms', animationDuration: '1s' }}
        />
        <span
          className="size-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: '150ms', animationDuration: '1s' }}
        />
        <span
          className="size-1.5 rounded-full bg-current animate-bounce"
          style={{ animationDelay: '300ms', animationDuration: '1s' }}
        />
      </span>
      <span className="transition-opacity duration-300 font-medium">{label}</span>
    </span>
  );
}

interface StreamingMessageProps {
  content: string;
  crewMember?: CrewMember | null;
}

export function StreamingMessage({ content, crewMember }: StreamingMessageProps) {
  const proposals = useMemo(() => extractProposals(content), [content]);
  const modifyProposals = useMemo(() => extractModifyProposals(content), [content]);
  const deleteProposals = useMemo(() => extractDeleteProposals(content), [content]);
  const queryBlocks = useMemo(() => extractQueryBlocks(content), [content]);
  const hasProposals = proposals.length > 0 || modifyProposals.length > 0 || deleteProposals.length > 0 || queryBlocks.length > 0;
  const displayContent = useMemo(() => {
    if (!hasProposals) return content;
    return content.replace(/```(?:proposal|modify_proposal|delete_proposal|query)\n[\s\S]*?\n```/g, '').trim();
  }, [content, hasProposals]);

  return (
    <div className="flex gap-2.5">
      <div
        className={`shrink-0 flex items-center justify-center size-7 rounded-full overflow-hidden text-[10px] font-medium ${
          crewMember ? 'bg-brand/20 text-brand' : 'bg-panel text-low'
        }`}
      >
        <AssistantAvatar crewMember={crewMember} />
      </div>
      <div className="min-w-0 max-w-[85%] space-y-1">
        <div className="rounded-xl rounded-tl-sm px-3 py-2 text-sm whitespace-pre-wrap break-words bg-panel text-high">
          {displayContent || <ResearchingIndicator crewMember={crewMember} />}
        </div>
        {proposals.map((proposal, i) => (
          <ProposalCard key={`create-${i}`} proposal={proposal} />
        ))}
        {modifyProposals.map((proposal, i) => (
          <ModifyProposalCard key={`modify-${i}`} proposal={proposal} />
        ))}
        {deleteProposals.map((proposal, i) => (
          <DeleteProposalCard key={`delete-${i}`} proposal={proposal} />
        ))}
        {queryBlocks.map((query, i) => (
          <QueryCard key={`query-${i}`} query={query} />
        ))}
      </div>
    </div>
  );
}
