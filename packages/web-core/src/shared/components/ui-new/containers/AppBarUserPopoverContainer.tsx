import { useCallback } from 'react';
import type { OrganizationWithRole } from 'shared/types';
import { UserIcon } from '@phosphor-icons/react';
import { Tooltip } from '@vibe/ui/components/Tooltip';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { cn } from '@/shared/lib/utils';

interface AppBarUserPopoverContainerProps {
  organizations: OrganizationWithRole[];
  selectedOrgId: string;
  onOrgSelect: (orgId: string) => void;
  onCreateOrg: () => void;
}

export function AppBarUserPopoverContainer({}: AppBarUserPopoverContainerProps) {
  const handleClick = useCallback(() => {
    void SettingsDialog.show();
  }, []);

  return (
    <Tooltip content="Settings" side="right">
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'flex items-center justify-center w-7 h-7 sm:w-10 sm:h-10 rounded-md sm:rounded-lg',
          'bg-panel text-normal font-medium text-sm',
          'transition-colors cursor-pointer',
          'hover:bg-panel/70',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand'
        )}
        aria-label="Settings"
      >
        <UserIcon className="size-icon-sm" weight="bold" />
      </button>
    </Tooltip>
  );
}
