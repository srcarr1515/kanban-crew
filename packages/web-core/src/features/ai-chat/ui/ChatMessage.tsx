import { useMemo } from 'react';
import { RobotIcon, UserIcon } from '@phosphor-icons/react';
import type { ChatMessage as ChatMessageType } from '@/shared/lib/local/chatApi';
import { extractProposals } from '@/shared/lib/local/chatApi';
import { ProposalCard } from './ProposalCard';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessageBubble({ message }: ChatMessageProps) {
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
        className={`shrink-0 flex items-center justify-center size-7 rounded-full ${
          isUser ? 'bg-brand/15 text-brand' : 'bg-panel text-low'
        }`}
      >
        {isUser ? (
          <UserIcon className="size-4" weight="fill" />
        ) : (
          <RobotIcon className="size-4" weight="fill" />
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

interface StreamingMessageProps {
  content: string;
}

export function StreamingMessage({ content }: StreamingMessageProps) {
  const proposals = useMemo(() => extractProposals(content), [content]);
  const displayContent = useMemo(() => {
    if (proposals.length === 0) return content;
    return content.replace(/```proposal\n[\s\S]*?\n```/g, '').trim();
  }, [content, proposals]);

  return (
    <div className="flex gap-2.5">
      <div className="shrink-0 flex items-center justify-center size-7 rounded-full bg-panel text-low">
        <RobotIcon className="size-4" weight="fill" />
      </div>
      <div className="min-w-0 max-w-[85%] space-y-1">
        <div className="rounded-xl rounded-tl-sm px-3 py-2 text-sm whitespace-pre-wrap break-words bg-panel text-high">
          {displayContent || (
            <span className="inline-flex gap-1 text-low">
              <span className="animate-pulse">Thinking</span>
              <span className="animate-bounce">...</span>
            </span>
          )}
        </div>
        {proposals.map((proposal, i) => (
          <ProposalCard key={i} proposal={proposal} />
        ))}
      </div>
    </div>
  );
}
