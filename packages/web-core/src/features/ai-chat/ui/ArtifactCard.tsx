import { useState } from 'react';
import { ArticleIcon, CaretDownIcon, CaretUpIcon, LinkSimpleIcon } from '@phosphor-icons/react';
import type { ArtifactBlock } from '@/shared/lib/local/chatApi';

interface ArtifactCardProps {
  artifact: ArtifactBlock;
  crewMemberId?: string;
}

const TYPE_LABELS: Record<string, string> = {
  spec: 'Spec',
  test_plan: 'Test Plan',
  bug_report: 'Bug Report',
  design_notes: 'Design Notes',
  review: 'Review',
  other: 'Document',
};

export function ArtifactCard({ artifact }: ArtifactCardProps) {
  const [expanded, setExpanded] = useState(false);

  const typeLabel = TYPE_LABELS[artifact.artifact_type] ?? artifact.artifact_type;

  return (
    <div className="my-2 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <ArticleIcon className="size-3.5 shrink-0 text-purple-400" weight="bold" />
          <span className="text-sm font-medium text-high truncate">{artifact.title}</span>
        </div>
        <span className="shrink-0 rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-400 uppercase tracking-wide">
          {typeLabel}
        </span>
      </div>

      {/* Collapsible content preview */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 transition-colors mt-1 mb-1"
      >
        {expanded ? (
          <CaretUpIcon className="size-3" weight="bold" />
        ) : (
          <CaretDownIcon className="size-3" weight="bold" />
        )}
        {expanded ? 'Hide content' : 'Show content'}
      </button>

      {expanded && (
        <pre className="text-xs bg-black/20 rounded-md px-2.5 py-2 mb-2 overflow-x-auto text-high font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
          {artifact.content}
        </pre>
      )}

      {/* Attach to Task action – wired up by later sub-task */}
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border border-purple-500/40 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-purple-500/10 transition-colors"
      >
        <LinkSimpleIcon className="size-3.5" weight="bold" />
        Attach to Task
      </button>
    </div>
  );
}
