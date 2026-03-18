import { useEffect, useMemo, useState } from 'react';
import { RobotIcon, UserIcon } from '@phosphor-icons/react';
import type { ChatMessage as ChatMessageType } from '@/shared/lib/local/chatApi';
import { extractProposals } from '@/shared/lib/local/chatApi';
import type { CrewMember } from '@/shared/lib/local/localApi';
import { ProposalCard } from './ProposalCard';

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

export function ChatMessageBubble({ message, crewMember }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const proposals = useMemo(
    () => (message.role === 'assistant' ? extractProposals(message.content) : []),
    [message.role, message.content]
  );

  // Strip proposal blocks from display text
  const displayContent = useMemo(() => {
    if (proposals.length === 0) return message.content;
    return message.content
      .replace(/```proposal\n[\s\S]*?\n```/g, '')
      .trim();
  }, [message.content, proposals]);

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
        <div
          className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-brand text-white rounded-tr-sm'
              : 'bg-panel text-high rounded-tl-sm'
          }`}
        >
          {displayContent}
        </div>
        {proposals.map((proposal, i) => (
          <ProposalCard key={i} proposal={proposal} />
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
  const displayContent = useMemo(() => {
    if (proposals.length === 0) return content;
    return content.replace(/```proposal\n[\s\S]*?\n```/g, '').trim();
  }, [content, proposals]);

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
          <ProposalCard key={i} proposal={proposal} />
        ))}
      </div>
    </div>
  );
}
