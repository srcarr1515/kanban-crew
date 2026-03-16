import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { repoApi, configApi } from '@/shared/lib/api';
import {
  getProjectRepoDefaults,
  saveProjectRepoDefaults,
} from '@/shared/hooks/useProjectRepoDefaults';
import type { Repo } from 'shared/types';

const EXECUTOR_STORAGE_KEY = 'autoCreateExecutor';

export function getAutoCreateExecutor(projectId: string): string | null {
  try {
    return localStorage.getItem(`${EXECUTOR_STORAGE_KEY}:${projectId}`);
  } catch {
    return null;
  }
}

function setAutoCreateExecutor(
  projectId: string,
  executor: string | null
): void {
  try {
    if (executor) {
      localStorage.setItem(`${EXECUTOR_STORAGE_KEY}:${projectId}`, executor);
    } else {
      localStorage.removeItem(`${EXECUTOR_STORAGE_KEY}:${projectId}`);
    }
  } catch {
    // ignore
  }
}

interface DefaultRepoDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DefaultRepoDialog({
  projectId,
  open,
  onOpenChange,
}: DefaultRepoDialogProps) {
  const { t } = useTranslation('common');
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [selectedExecutor, setSelectedExecutor] = useState<string | null>(null);
  const [hasExistingDefault, setHasExistingDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: repos } = useQuery({
    queryKey: ['repos'],
    queryFn: () => repoApi.list(),
    enabled: open,
  });

  const { data: systemInfo } = useQuery({
    queryKey: ['systemInfo'],
    queryFn: () => configApi.getConfig(),
    enabled: open,
  });

  const executorNames = Object.keys(systemInfo?.executors ?? {});

  // Load existing defaults when dialog opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getProjectRepoDefaults(projectId).then((defaults) => {
      if (cancelled) return;
      const first = defaults?.[0] ?? null;
      setHasExistingDefault(Boolean(first));
      setSelectedRepoId(first?.repo_id ?? null);
    });
    const savedExecutor = getAutoCreateExecutor(projectId);
    setSelectedExecutor(savedExecutor);
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (selectedRepoId) {
        const repo = repos?.find((r: Repo) => r.id === selectedRepoId);
        await saveProjectRepoDefaults(projectId, [
          {
            repo_id: selectedRepoId,
            target_branch: repo?.default_target_branch ?? 'main',
          },
        ]);
      } else {
        await saveProjectRepoDefaults(projectId, []);
      }
      setAutoCreateExecutor(projectId, selectedExecutor);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to save default repo:', err);
    } finally {
      setSaving(false);
    }
  }, [selectedRepoId, selectedExecutor, repos, projectId, onOpenChange]);

  const handleClear = useCallback(async () => {
    setSaving(true);
    try {
      await saveProjectRepoDefaults(projectId, []);
      setAutoCreateExecutor(projectId, null);
      setSelectedRepoId(null);
      setSelectedExecutor(null);
      setHasExistingDefault(false);
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to clear default repo:', err);
    } finally {
      setSaving(false);
    }
  }, [projectId, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative bg-surface border border-border rounded-md shadow-lg w-[400px] max-w-[90vw]">
        <div className="p-double">
          <h3 className="text-lg font-medium mb-base">
            {t('kanban.defaultRepo', 'Default Repository')}
          </h3>
          <p className="text-sm text-low mb-double">
            {t(
              'kanban.defaultRepoDescription',
              'When set, dragging a task to "In Progress" will automatically create a workspace with this repo.'
            )}
          </p>

          <div className="space-y-base">
            <div>
              <label className="block text-xs text-low mb-half">
                {t('kanban.repository', 'Repository')}
              </label>
              <select
                value={selectedRepoId ?? ''}
                onChange={(e) => setSelectedRepoId(e.target.value || null)}
                className="w-full px-base py-half bg-surface border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="">
                  {t('kanban.noDefaultRepo', 'None (disabled)')}
                </option>
                {repos?.map((repo: Repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.display_name || repo.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-low mb-half">
                {t('kanban.executor', 'Agent')}
              </label>
              <select
                value={selectedExecutor ?? ''}
                onChange={(e) => setSelectedExecutor(e.target.value || null)}
                className="w-full px-base py-half bg-surface border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-brand"
              >
                {executorNames.map((name) => (
                  <option key={name} value={name}>
                    {name.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between p-double pt-0">
          <div>
            {hasExistingDefault && (
              <button
                type="button"
                onClick={handleClear}
                disabled={saving}
                className="text-sm text-error hover:underline disabled:opacity-50"
              >
                {t('kanban.clearDefault', 'Clear default')}
              </button>
            )}
          </div>
          <div className="flex gap-half">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-double py-half text-sm border border-border rounded-sm hover:bg-secondary transition-colors"
            >
              {t('common:cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-double py-half text-sm bg-brand text-white rounded-sm hover:opacity-90 transition-colors disabled:opacity-50"
            >
              {t('common:save', 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
