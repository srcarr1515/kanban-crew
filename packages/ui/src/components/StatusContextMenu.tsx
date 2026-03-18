import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { CheckIcon } from '@phosphor-icons/react';

import { cn } from '../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from './Dropdown';
import { StatusIcon } from './StatusIcon';

export interface StatusOption {
  id: string;
  name: string;
}

export interface StatusContextMenuProps {
  /** Available statuses to display in the menu. */
  statuses: StatusOption[];
  /** The currently selected status ID (shown with a checkmark). */
  currentStatusId?: string;
  /** Called when a status is selected. */
  onStatusChange: (statusId: string) => void;
  /** The trigger element that opens the menu. */
  children: React.ReactNode;
  /** Additional class name for the menu content. */
  contentClassName?: string;
  /** Side of the trigger to render the menu on. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Alignment of the menu relative to the trigger. */
  align?: 'start' | 'center' | 'end';
}

export function StatusContextMenu({
  statuses,
  currentStatusId,
  onStatusChange,
  children,
  contentClassName,
  side,
  align,
}: StatusContextMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        className={cn('min-w-[10rem]', contentClassName)}
        side={side}
        align={align}
      >
        {statuses.map((status) => (
          <DropdownMenuPrimitive.Item
            key={status.id}
            className={cn(
              'relative flex cursor-pointer select-none items-center gap-base',
              'px-base py-half mx-half rounded-sm outline-none transition-colors',
              'text-high focus:bg-secondary',
              'data-[disabled]:pointer-events-none data-[disabled]:opacity-50'
            )}
            onSelect={() => onStatusChange(status.id)}
          >
            <StatusIcon statusId={status.id} size="xs" />
            <span className="flex-1 text-sm truncate">{status.name}</span>
            {status.id === currentStatusId && (
              <CheckIcon
                className="size-icon-xs text-brand shrink-0"
                weight="bold"
              />
            )}
          </DropdownMenuPrimitive.Item>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
