import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClockIcon,
  PencilSimpleIcon,
  TrashIcon,
  PlusIcon,
  CalendarBlankIcon,
  MagnifyingGlassIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Switch } from '@vibe/ui/components/Switch';
import { Button } from '@vibe/ui/components/Button';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { Label } from '@vibe/ui/components/Label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vibe/ui/components/Select';
import { jobsApi } from '@/shared/lib/api';
import type { Job, CreateJobRequest } from '@/shared/lib/api';
import {
  listLocalProjects,
  listLocalTasks,
} from '@/shared/lib/local/localApi';
import type { LocalTask } from '@/shared/lib/local/taskAdapter';
import { LOCAL_STATUSES } from '@/shared/lib/local/localStatuses';
import { cn } from '@/shared/lib/utils';
import { CronBuilder, describeCron } from '@/shared/components/CronBuilder';

// ── Query keys ───────────────────────────────────────────────────────────────

const jobKeys = {
  all: ['jobs'] as const,
  list: () => ['jobs', 'list'] as const,
};

// ── Hook: useAllTasks ────────────────────────────────────────────────────────

function useAllTasks() {
  const projectsQuery = useQuery({
    queryKey: ['local', 'projects'],
    queryFn: listLocalProjects,
  });

  const projectIds = useMemo(
    () => (projectsQuery.data ?? []).map((p) => p.id),
    [projectsQuery.data],
  );

  const tasksQuery = useQuery({
    queryKey: ['local', 'all-tasks', ...projectIds],
    queryFn: async () => {
      const results = await Promise.all(
        projectIds.map((pid) => listLocalTasks(pid)),
      );
      return results.flat();
    },
    enabled: projectIds.length > 0,
  });

  const tasks = tasksQuery.data ?? [];

  const taskMap = useMemo(() => {
    const map = new Map<string, LocalTask>();
    for (const task of tasks) {
      map.set(task.id, task);
    }
    return map;
  }, [tasks]);

  return { tasks, taskMap };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ScheduledJobsPage() {
  const queryClient = useQueryClient();
  const { tasks, taskMap } = useAllTasks();
  const [updatingJobIds, setUpdatingJobIds] = useState<Set<string>>(
    new Set(),
  );
  const [showForm, setShowForm] = useState(false);

  const {
    data: jobs = [],
    isLoading,
  } = useQuery({
    queryKey: jobKeys.list(),
    queryFn: jobsApi.list,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ jobId, enabled }: { jobId: string; enabled: boolean }) =>
      jobsApi.update(jobId, { enabled }),
    onMutate: ({ jobId }) => {
      setUpdatingJobIds((prev) => new Set(prev).add(jobId));
    },
    onSettled: (_data, _err, { jobId }) => {
      setUpdatingJobIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => jobsApi.delete(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: jobKeys.all });
    },
  });

  const handleToggle = useCallback(
    (job: Job) => {
      toggleMutation.mutate({ jobId: job.id, enabled: !job.enabled });
    },
    [toggleMutation],
  );

  const handleDelete = useCallback(
    async (job: Job) => {
      const taskTitle =
        taskMap.get(job.template_task_id)?.title ?? 'this job';
      const result = await ConfirmDialog.show({
        title: 'Delete Scheduled Job',
        message: `Are you sure you want to delete the scheduled job for "${taskTitle}"? This action cannot be undone.`,
        confirmText: 'Delete',
        variant: 'destructive',
      });
      if (result === 'confirmed') {
        deleteMutation.mutate(job.id);
      }
    },
    [deleteMutation, taskMap],
  );

  const handleFormSaved = useCallback(() => {
    setShowForm(false);
    queryClient.invalidateQueries({ queryKey: jobKeys.all });
  }, [queryClient]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-low">
        Loading scheduled jobs...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-double py-base border-b border-border">
        <h1 className="text-xl font-medium text-high">Scheduled Jobs</h1>
        <Button
          variant="default"
          size="sm"
          onClick={() => setShowForm((v) => !v)}
        >
          <PlusIcon size={16} className="mr-1" />
          Schedule Job
        </Button>
      </div>

      {/* Create form accordion */}
      {showForm && (
        <CreateJobForm
          tasks={tasks}
          onSave={handleFormSaved}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {jobs.length === 0 && !showForm ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-low">
            <CalendarBlankIcon size={32} weight="light" />
            <p className="text-base">No scheduled jobs yet</p>
            <p className="text-sm">
              Create a scheduled job to automatically spawn tasks on a cron
              schedule.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {jobs.map((job) => {
              const task = taskMap.get(job.template_task_id);
              return (
                <JobRow
                  key={job.id}
                  job={job}
                  taskTitle={task?.title}
                  isUpdating={updatingJobIds.has(job.id)}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create Job Form ──────────────────────────────────────────────────────────

interface CreateJobFormProps {
  tasks: LocalTask[];
  onSave: () => void;
  onCancel: () => void;
}

function CreateJobForm({ tasks, onSave, onCancel }: CreateJobFormProps) {
  // Task selection
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [taskDropdownOpen, setTaskDropdownOpen] = useState(false);
  const taskDropdownRef = useRef<HTMLDivElement>(null);
  const taskInputRef = useRef<HTMLInputElement>(null);

  // Schedule
  const [cronExpression, setCronExpression] = useState('0 9 * * *');

  // Target column
  const [targetColumn, setTargetColumn] = useState(
    LOCAL_STATUSES[0]?.id ?? 'todo',
  );

  // Enabled
  const [enabled, setEnabled] = useState(true);

  // Error
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: CreateJobRequest) => jobsApi.create(data),
    onSuccess: () => {
      onSave();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId),
    [tasks, selectedTaskId],
  );

  const filteredTasks = useMemo(() => {
    const query = taskSearch.toLowerCase().trim();
    if (!query) return tasks;
    return tasks.filter((t) => t.title.toLowerCase().includes(query));
  }, [tasks, taskSearch]);

  // Close task dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        taskDropdownRef.current &&
        !taskDropdownRef.current.contains(e.target as Node)
      ) {
        setTaskDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSave = () => {
    setError('');
    if (!selectedTaskId) {
      setError('Please select a template task.');
      return;
    }
    if (!cronExpression.trim()) {
      setError('Please specify a schedule.');
      return;
    }
    createMutation.mutate({
      template_task_id: selectedTaskId,
      schedule_cron: cronExpression.trim(),
      enabled,
    });
  };

  return (
    <div className="border-b border-border bg-secondary/50 px-double py-base">
      <div className="max-w-lg space-y-4">
        {/* Template Task (searchable dropdown) */}
        <div className="space-y-1">
          <Label className="text-sm text-normal">
            Template Task <span className="text-error">*</span>
          </Label>
          <div ref={taskDropdownRef} className="relative">
            <div
              className={cn(
                'flex items-center border bg-primary cursor-pointer',
                'focus-within:ring-1 focus-within:ring-brand',
              )}
              onClick={() => {
                setTaskDropdownOpen(true);
                taskInputRef.current?.focus();
              }}
            >
              <MagnifyingGlassIcon
                size={14}
                className="ml-2 shrink-0 text-low"
              />
              <input
                ref={taskInputRef}
                type="text"
                className="flex-1 bg-transparent px-2 py-1.5 text-sm text-high outline-none placeholder:text-low"
                placeholder={
                  selectedTask
                    ? selectedTask.title
                    : 'Search tasks...'
                }
                value={taskSearch}
                onChange={(e) => {
                  setTaskSearch(e.target.value);
                  setTaskDropdownOpen(true);
                }}
                onFocus={() => setTaskDropdownOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setTaskDropdownOpen(false);
                    e.currentTarget.blur();
                  }
                }}
              />
              {selectedTask && !taskSearch && (
                <button
                  type="button"
                  className="mr-1 p-0.5 text-low hover:text-normal"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTaskId('');
                    setTaskSearch('');
                    taskInputRef.current?.focus();
                  }}
                  aria-label="Clear selection"
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>
            {taskDropdownOpen && (
              <div className="absolute z-50 mt-0.5 max-h-48 w-full overflow-y-auto border bg-primary shadow-md">
                {filteredTasks.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-low">
                    No tasks found
                  </div>
                ) : (
                  filteredTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-sm cursor-pointer',
                        'hover:bg-secondary transition-colors',
                        task.id === selectedTaskId &&
                          'bg-brand/10 text-brand',
                      )}
                      onClick={() => {
                        setSelectedTaskId(task.id);
                        setTaskSearch('');
                        setTaskDropdownOpen(false);
                      }}
                    >
                      <span className="text-high">{task.title}</span>
                      <span className="ml-2 text-low text-xs">
                        {task.status}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {selectedTask && (
            <p className="text-xs text-low">
              Selected: {selectedTask.title}
            </p>
          )}
        </div>

        {/* Schedule */}
        <div className="space-y-1">
          <Label className="text-sm text-normal">Schedule</Label>
          <CronBuilder
            value={cronExpression}
            onChange={setCronExpression}
          />
        </div>

        {/* Target Column */}
        <div className="space-y-1">
          <Label className="text-sm text-normal">Target Column</Label>
          <Select value={targetColumn} onValueChange={setTargetColumn}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCAL_STATUSES.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-low">
            Column where spawned tasks will be placed
          </p>
        </div>

        {/* Enabled */}
        <div className="flex items-center gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Enable job"
          />
          <Label className="text-sm text-normal">
            {enabled ? 'Enabled' : 'Disabled'}
          </Label>
        </div>

        {/* Error message */}
        {error && (
          <p className="text-sm text-error">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Job Row ──────────────────────────────────────────────────────────────────

interface JobRowProps {
  job: Job;
  taskTitle: string | undefined;
  isUpdating: boolean;
  onToggle: (job: Job) => void;
  onDelete: (job: Job) => void;
}

function JobRow({
  job,
  taskTitle,
  isUpdating,
  onToggle,
  onDelete,
}: JobRowProps) {
  const schedule = describeCron(job.schedule_cron);
  const displayTitle = taskTitle ?? job.template_task_id.slice(0, 8);

  return (
    <div
      className={cn(
        'flex items-center gap-base px-double py-base transition-colors',
        'hover:bg-secondary',
        !job.enabled && 'opacity-60',
      )}
    >
      {/* Icon */}
      <ClockIcon size={20} className="shrink-0 text-low" />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <p className="text-base text-high truncate">{displayTitle}</p>
        <p className="text-sm text-low mt-0.5">{schedule}</p>
      </div>

      {/* Enabled toggle */}
      <Switch
        checked={job.enabled}
        onCheckedChange={() => onToggle(job)}
        disabled={isUpdating}
        aria-label={job.enabled ? 'Disable job' : 'Enable job'}
      />

      {/* Edit button */}
      <button
        type="button"
        className={cn(
          'shrink-0 inline-flex items-center justify-center rounded-sm p-1 text-low transition-colors cursor-pointer',
          'hover:bg-secondary hover:text-normal',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
        )}
        aria-label="Edit job"
        title="Edit"
      >
        <PencilSimpleIcon size={16} />
      </button>

      {/* Delete button */}
      <button
        type="button"
        onClick={() => onDelete(job)}
        className={cn(
          'shrink-0 inline-flex items-center justify-center rounded-sm p-1 text-low transition-colors cursor-pointer',
          'hover:bg-destructive/10 hover:text-destructive',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
        )}
        aria-label="Delete job"
        title="Delete"
      >
        <TrashIcon size={16} />
      </button>
    </div>
  );
}
