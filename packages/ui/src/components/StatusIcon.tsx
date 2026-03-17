import {
  CircleIcon,
  CircleDashedIcon,
  ClockIcon,
  EyeIcon,
  CheckCircleIcon,
  XCircleIcon,
  RocketLaunchIcon,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

export type StatusId =
  | 'todo'
  | 'ready'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'cancelled';

interface StatusConfig {
  icon: Icon;
  className: string;
  label: string;
}

const STATUS_MAP: Record<StatusId, StatusConfig> = {
  todo: {
    icon: CircleDashedIcon,
    className: 'text-[hsl(220,9%,46%)]',
    label: 'To Do',
  },
  ready: {
    icon: RocketLaunchIcon,
    className: 'text-[hsl(263,70%,50%)]',
    label: 'Ready',
  },
  in_progress: {
    icon: ClockIcon,
    className: 'text-[hsl(217,91%,60%)]',
    label: 'In Progress',
  },
  in_review: {
    icon: EyeIcon,
    className: 'text-[hsl(38,92%,50%)]',
    label: 'In Review',
  },
  done: {
    icon: CheckCircleIcon,
    className: 'text-[hsl(160,60%,45%)]',
    label: 'Done',
  },
  cancelled: {
    icon: XCircleIcon,
    className: 'text-[hsl(0,84%,60%)]',
    label: 'Cancelled',
  },
};

const FALLBACK: StatusConfig = {
  icon: CircleIcon,
  className: 'text-low',
  label: 'Unknown',
};

export interface StatusIconProps {
  statusId: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  showLabel?: boolean;
}

export function StatusIcon({
  statusId,
  size = 'xs',
  className,
  showLabel = false,
}: StatusIconProps) {
  const config = STATUS_MAP[statusId as StatusId] ?? FALLBACK;
  const Icon = config.icon;

  const sizeClass =
    size === 'xs'
      ? 'size-icon-xs'
      : size === 'sm'
        ? 'size-icon-sm'
        : 'size-icon-md';

  return (
    <span className={cn('inline-flex items-center gap-1 shrink-0', className)}>
      <Icon className={cn(sizeClass, config.className)} weight="bold" />
      {showLabel && (
        <span className={cn('text-xs', config.className)}>{config.label}</span>
      )}
    </span>
  );
}

/** Get the config for a status ID (useful for custom rendering). */
export function getStatusConfig(statusId: string): StatusConfig {
  return STATUS_MAP[statusId as StatusId] ?? FALLBACK;
}
