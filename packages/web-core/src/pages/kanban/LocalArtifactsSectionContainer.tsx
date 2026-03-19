import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TrashIcon, CaretDownIcon, CaretUpIcon, ArticleIcon } from '@phosphor-icons/react';
import { CollapsibleSectionHeader } from '@vibe/ui/components/CollapsibleSectionHeader';
import {
  listTaskArtifacts,
  deleteArtifact,
  listCrewMembers,
  type Artifact,
  type CrewMember,
} from '@/shared/lib/local/localApi';

interface LocalArtifactsSectionContainerProps {
  issueId: string;
}

const TYPE_LABELS: Record<string, string> = {
  spec: 'Spec',
  test_plan: 'Test Plan',
  bug_report: 'Bug Report',
  design_notes: 'Design Notes',
  review: 'Review',
  other: 'Document',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function LocalArtifactsSectionContainer({
  issueId,
}: LocalArtifactsSectionContainerProps) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['local', 'task-artifacts', issueId], [issueId]);

  const artifactsQuery = useQuery({
    queryKey,
    queryFn: () => listTaskArtifacts(issueId),
    enabled: Boolean(issueId),
    refetchInterval: 3000,
  });

  const crewQuery = useQuery({
    queryKey: ['local', 'crew-members'],
    queryFn: listCrewMembers,
  });

  const crewMap = useMemo(() => {
    const map = new Map<string, CrewMember>();
    for (const m of crewQuery.data ?? []) map.set(m.id, m);
    return map;
  }, [crewQuery.data]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteArtifact(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const artifacts: Artifact[] = artifactsQuery.data ?? [];

  return (
    <CollapsibleSectionHeader
      title="Artifacts"
      persistKey="kanban-issue-artifacts"
      defaultExpanded={true}
    >
      <div className="px-base pb-base">
        {artifactsQuery.isLoading && (
          <p className="text-xs text-low py-2">Loading artifacts…</p>
        )}
        {!artifactsQuery.isLoading && artifacts.length === 0 && (
          <p className="text-xs text-low py-2">No artifacts yet.</p>
        )}
        {artifacts.map((artifact) => {
          const isExpanded = expandedIds.has(artifact.id);
          const crewMember = artifact.crew_member_id
            ? crewMap.get(artifact.crew_member_id)
            : null;
          const typeLabel = TYPE_LABELS[artifact.artifact_type] ?? artifact.artifact_type;

          return (
            <div
              key={artifact.id}
              className="mt-2 rounded-lg border border-purple-500/30 bg-purple-500/5 p-3"
            >
              {/* Header row: icon + title + type badge + delete */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <ArticleIcon className="size-3.5 shrink-0 text-purple-400" weight="bold" />
                  <span className="text-sm font-medium text-high truncate">
                    {artifact.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-400 uppercase tracking-wide">
                    {typeLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(artifact.id)}
                    className="text-low hover:text-red-400 transition-colors"
                    title="Delete artifact"
                  >
                    <TrashIcon className="size-3.5" weight="bold" />
                  </button>
                </div>
              </div>

              {/* Meta: crew member + date */}
              <div className="flex items-center gap-2 mt-1 text-[11px] text-low">
                {crewMember && <span>{crewMember.name}</span>}
                {crewMember && <span>·</span>}
                <span>{formatDate(artifact.created_at)}</span>
              </div>

              {/* Expand/collapse content */}
              <button
                type="button"
                onClick={() => toggleExpand(artifact.id)}
                className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 transition-colors mt-1.5"
              >
                {isExpanded ? (
                  <CaretUpIcon className="size-3" weight="bold" />
                ) : (
                  <CaretDownIcon className="size-3" weight="bold" />
                )}
                {isExpanded ? 'Hide content' : 'Show content'}
              </button>

              {isExpanded && (
                <pre className="mt-1.5 text-xs bg-black/20 rounded-md px-2.5 py-2 overflow-x-auto text-high font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                  {artifact.content}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </CollapsibleSectionHeader>
  );
}
