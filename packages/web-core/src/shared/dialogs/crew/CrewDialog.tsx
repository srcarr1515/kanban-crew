import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  UsersThreeIcon,
  PlusIcon,
  XIcon,
  CaretLeftIcon,
  CaretDownIcon,
  CaretUpIcon,
  SpinnerIcon,
  UserCircleIcon,
  FloppyDiskIcon,
  TrashIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { create, useModal } from '@ebay/nice-modal-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { defineModal } from '@/shared/lib/modals';
import {
  listCrewMembers,
  createCrewMember,
  updateCrewMember,
  deleteCrewMember,
  type CrewMember,
} from '@/shared/lib/local/localApi';
import { cn } from '@/shared/lib/utils';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { mcpServersApi } from '@/shared/lib/api';
import { BaseCodingAgent } from 'shared/types';

type CrewSectionType = 'members';

const CREW_SECTIONS: { id: CrewSectionType; icon: Icon }[] = [
  { id: 'members', icon: UsersThreeIcon },
];

const SECTION_LABELS: Record<CrewSectionType, string> = {
  members: 'Members',
};

const CREW_MEMBERS_KEY = ['local', 'crew-members'];

function CrewMemberEditForm({
  member,
  onSave,
  isSaving,
  mcpServerNames,
}: {
  member: CrewMember;
  onSave: (
    id: string,
    changes: {
      name?: string;
      role?: string;
      role_prompt?: string;
      tool_access?: unknown[];
      personality?: string;
    }
  ) => void;
  isSaving: boolean;
  mcpServerNames: string[];
}) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [rolePrompt, setRolePrompt] = useState(member.role_prompt);
  const [personality, setPersonality] = useState(member.personality);
  const [selectedTools, setSelectedTools] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(member.tool_access);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const handleToolToggle = (serverName: string) => {
    setSelectedTools((prev) =>
      prev.includes(serverName)
        ? prev.filter((t) => t !== serverName)
        : [...prev, serverName]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(member.id, {
      name: name.trim() || member.name,
      role: role.trim() || member.role,
      role_prompt: rolePrompt,
      tool_access: selectedTools,
      personality,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2 space-y-3">
      {/* Name + Role row */}
      <div className="space-y-2">
        <div>
          <label className="block text-xs font-medium text-low mb-1">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn(
              'w-full px-2.5 py-1.5 rounded-sm text-sm',
              'bg-primary border border-border text-high',
              'placeholder:text-muted',
              'focus:outline-none focus:ring-1 focus:ring-brand'
            )}
            placeholder="Member name"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-low mb-1">
            Role
          </label>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={cn(
              'w-full px-2.5 py-1.5 rounded-sm text-sm',
              'bg-primary border border-border text-high',
              'placeholder:text-muted',
              'focus:outline-none focus:ring-1 focus:ring-brand'
            )}
            placeholder="e.g. Frontend Developer"
          />
        </div>
      </div>

      {/* Role Prompt */}
      <div>
        <label className="block text-xs font-medium text-low mb-1">
          Role Prompt
        </label>
        <textarea
          value={rolePrompt}
          onChange={(e) => setRolePrompt(e.target.value)}
          rows={3}
          className={cn(
            'w-full px-2.5 py-1.5 rounded-sm text-sm resize-none',
            'bg-primary border border-border text-high',
            'placeholder:text-muted',
            'focus:outline-none focus:ring-1 focus:ring-brand'
          )}
          placeholder="System prompt injected when this crew member works on a task..."
        />
      </div>

      {/* Personality */}
      <div>
        <label className="block text-xs font-medium text-low mb-1">
          Personality
        </label>
        <textarea
          value={personality}
          onChange={(e) => setPersonality(e.target.value)}
          rows={2}
          className={cn(
            'w-full px-2.5 py-1.5 rounded-sm text-sm resize-none',
            'bg-primary border border-border text-high',
            'placeholder:text-muted',
            'focus:outline-none focus:ring-1 focus:ring-brand'
          )}
          placeholder="Communication style — e.g. blunt, friendly, sarcastic..."
        />
      </div>

      {/* Tool Access */}
      <div>
        <label className="block text-xs font-medium text-low mb-1">
          Tool Access
        </label>
        {mcpServerNames.length === 0 ? (
          <p className="text-xs text-muted">
            No MCP servers configured. Add servers in Settings &gt; MCP.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {mcpServerNames.map((serverName) => {
              const isSelected = selectedTools.includes(serverName);
              return (
                <button
                  key={serverName}
                  type="button"
                  onClick={() => handleToolToggle(serverName)}
                  className={cn(
                    'px-2 py-1 rounded-sm text-xs font-medium transition-colors cursor-pointer',
                    'border',
                    isSelected
                      ? 'bg-brand/15 text-brand border-brand/30'
                      : 'bg-primary text-low border-border hover:border-brand/30 hover:text-normal'
                  )}
                >
                  {serverName}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={isSaving}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-medium',
            'bg-brand text-white hover:bg-brand/90 transition-colors',
            'cursor-pointer',
            isSaving && 'opacity-50 cursor-not-allowed'
          )}
        >
          <FloppyDiskIcon className="size-3.5" weight="bold" />
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function AvatarModal({
  member,
  onUpload,
  onRemove,
  onClose,
}: {
  member: CrewMember;
  onUpload: (dataUrl: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const isImageAvatar =
    member.avatar?.startsWith('data:') || member.avatar?.startsWith('http');

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onUpload(reader.result as string);
      onClose();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div
      ref={modalRef}
      className={cn(
        'absolute top-full left-0 mt-1 z-50',
        'bg-panel border border-border rounded-sm shadow-lg',
        'min-w-[160px] py-1'
      )}
    >
      {/* Preview */}
      <div className="flex items-center justify-center px-4 py-3">
        <div
          className={cn(
            'flex items-center justify-center w-16 h-16 rounded-full overflow-hidden',
            'bg-brand/20 text-brand text-xl font-semibold'
          )}
        >
          {isImageAvatar ? (
            <img
              src={member.avatar}
              alt={member.name}
              className="w-full h-full object-cover"
            />
          ) : (
            member.avatar || member.name.charAt(0).toUpperCase()
          )}
        </div>
      </div>

      <div className="border-t border-border" />

      {/* Upload */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'flex items-center gap-2 w-full px-3 py-2 text-sm text-normal',
          'hover:bg-primary/10 transition-colors cursor-pointer'
        )}
      >
        <UploadSimpleIcon className="size-4" weight="bold" />
        Upload image
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Remove — only if there's an image */}
      {isImageAvatar && (
        <button
          type="button"
          onClick={() => {
            onRemove();
            onClose();
          }}
          className={cn(
            'flex items-center gap-2 w-full px-3 py-2 text-sm text-destructive',
            'hover:bg-destructive/10 transition-colors cursor-pointer'
          )}
        >
          <TrashIcon className="size-4" weight="bold" />
          Remove image
        </button>
      )}
    </div>
  );
}

function CrewMemberCard({
  member,
  isExpanded,
  onToggleExpand,
  onDismiss,
  isDismissing,
  onSave,
  isSaving,
  mcpServerNames,
}: {
  member: CrewMember;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDismiss: (id: string) => void;
  isDismissing: boolean;
  onSave: (
    id: string,
    changes: {
      name?: string;
      role?: string;
      role_prompt?: string;
      tool_access?: unknown[];
      personality?: string;
      avatar?: string;
    }
  ) => void;
  isSaving: boolean;
  mcpServerNames: string[];
}) {
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  const handleDismiss = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await ConfirmDialog.show({
      title: 'Remove Crew Member',
      message: `Are you sure you want to permanently remove "${member.name}" from the crew? This action cannot be undone.`,
      confirmText: 'Remove',
      cancelText: 'Cancel',
      variant: 'destructive',
    });
    if (result === 'confirmed') {
      onDismiss(member.id);
    }
  };

  const handleAvatarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAvatarModal((prev) => !prev);
  };

  const isImageAvatar =
    member.avatar?.startsWith('data:') || member.avatar?.startsWith('http');

  return (
    <div
      className={cn(
        'rounded-sm border border-border',
        isExpanded ? 'bg-secondary' : 'bg-secondary'
      )}
    >
      {/* Card header */}
      <div
        className={cn(
          'relative flex items-start gap-3 px-4 py-3 w-full',
          'hover:bg-primary/5 transition-colors'
        )}
      >
        {/* Avatar — clickable to open avatar modal */}
        <div className="relative shrink-0">
          <div
            role="button"
            tabIndex={-1}
            onClick={handleAvatarClick}
            className={cn(
              'flex items-center justify-center w-9 h-9 rounded-full overflow-hidden',
              'bg-brand/20 text-brand text-sm font-medium',
              'hover:ring-2 hover:ring-brand/40 transition-all cursor-pointer'
            )}
            title="Change avatar"
          >
            {isImageAvatar ? (
              <img
                src={member.avatar}
                alt={member.name}
                className="w-full h-full object-cover"
              />
            ) : (
              member.avatar || member.name.charAt(0).toUpperCase()
            )}
          </div>
          {showAvatarModal && (
            <AvatarModal
              member={member}
              onUpload={(dataUrl) => onSave(member.id, { avatar: dataUrl })}
              onRemove={() => {
                const initials = member.name.charAt(0).toUpperCase();
                onSave(member.id, { avatar: initials });
              }}
              onClose={() => setShowAvatarModal(false)}
            />
          )}
        </div>

        {/* Name and role — clickable to toggle expand */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex-1 min-w-0 text-left cursor-pointer"
        >
          <p className="text-sm font-medium text-high truncate">
            {member.name}
          </p>
          <p className="text-xs text-low truncate">{member.role}</p>
        </button>

        {/* Expand/collapse indicator — bottom-aligned */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="shrink-0 text-low self-end cursor-pointer"
        >
          {isExpanded ? (
            <CaretUpIcon className="size-3.5" weight="bold" />
          ) : (
            <CaretDownIcon className="size-3.5" weight="bold" />
          )}
        </button>

        {/* Delete button - top-right corner */}
        <div
          role="button"
          tabIndex={-1}
          onClick={handleDismiss}
          className={cn(
            'absolute top-2 right-2',
            'p-1 rounded-sm text-low hover:text-destructive hover:bg-destructive/10',
            'transition-colors cursor-pointer',
            isDismissing && 'opacity-50 cursor-not-allowed'
          )}
          aria-label={`Remove ${member.name}`}
        >
          <TrashIcon className="size-3.5" weight="bold" />
        </div>
      </div>

      {/* Expanded inline edit form */}
      {isExpanded && (
        <div className="border-t border-border">
          <CrewMemberEditForm
            member={member}
            onSave={onSave}
            isSaving={isSaving}
            mcpServerNames={mcpServerNames}
          />
        </div>
      )}
    </div>
  );
}

function MembersSection() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: members = [], isLoading } = useQuery({
    queryKey: CREW_MEMBERS_KEY,
    queryFn: listCrewMembers,
    staleTime: 30_000, // Reuse cached data for 30s to avoid spinner flash on reopen
  });

  // Load MCP server names for tool access multi-select
  const { data: mcpServerNames = [] } = useQuery({
    queryKey: ['mcp-server-names'],
    queryFn: async () => {
      try {
        const result = await mcpServersApi.load({
          executor: BaseCodingAgent.CLAUDE_CODE,
        });
        return Object.keys(result.mcp_config.servers ?? {});
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: createCrewMember,
    onSuccess: (newMember) => {
      queryClient.invalidateQueries({ queryKey: CREW_MEMBERS_KEY });
      setExpandedId(newMember.id);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      changes,
    }: {
      id: string;
      changes: {
        name?: string;
        role?: string;
        role_prompt?: string;
        tool_access?: unknown[];
        personality?: string;
        avatar?: string;
      };
    }) => updateCrewMember(id, changes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CREW_MEMBERS_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCrewMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CREW_MEMBERS_KEY });
    },
  });

  const handleAddMember = () => {
    addMutation.mutate({ name: 'New Member', role: 'Role' });
  };

  const handleDismiss = (id: string) => {
    if (expandedId === id) setExpandedId(null);
    deleteMutation.mutate(id);
  };

  const handleSave = (
    id: string,
    changes: {
      name?: string;
      role?: string;
      role_prompt?: string;
      tool_access?: unknown[];
      personality?: string;
      avatar?: string;
    }
  ) => {
    updateMutation.mutate({ id, changes });
  };

  const handleToggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="p-6">
      {/* Header with title and add button */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-high">Crew Members</h3>
          <p className="text-xs text-low mt-0.5">
            Manage your crew members and their roles.
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddMember}
          disabled={addMutation.isPending}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-medium',
            'bg-brand text-white hover:bg-brand/90 transition-colors',
            'cursor-pointer',
            addMutation.isPending && 'opacity-50 cursor-not-allowed'
          )}
        >
          <PlusIcon className="size-4" weight="bold" />
          Add a Crew Member
        </button>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <SpinnerIcon className="size-5 animate-spin text-low" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && members.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <UserCircleIcon className="size-10 text-low mb-2" />
          <p className="text-sm text-low">No crew members yet.</p>
          <p className="text-xs text-muted mt-1">
            Add crew members to assign roles and configure your team.
          </p>
        </div>
      )}

      {/* Member cards */}
      {!isLoading && members.length > 0 && (
        <div className="space-y-2">
          {members.map((member: CrewMember) => (
            <CrewMemberCard
              key={member.id}
              member={member}
              isExpanded={expandedId === member.id}
              onToggleExpand={() => handleToggleExpand(member.id)}
              onDismiss={handleDismiss}
              isDismissing={deleteMutation.isPending}
              onSave={handleSave}
              isSaving={updateMutation.isPending}
              mcpServerNames={mcpServerNames}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CrewDialogContentProps {
  onClose: () => void;
}

function CrewDialogContent({ onClose }: CrewDialogContentProps) {
  const [activeSection, setActiveSection] =
    useState<CrewSectionType>('members');
  const [mobileShowContent, setMobileShowContent] = useState(true);
  const isConfirmingRef = useRef(false);

  const handleClose = useCallback(async () => {
    if (isConfirmingRef.current) return;
    onClose();
  }, [onClose]);

  const handleSectionSelect = (sectionId: CrewSectionType) => {
    setActiveSection(sectionId);
    setMobileShowContent(true);
  };

  const handleMobileBack = () => {
    setMobileShowContent(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  return (
    <>
      {/* Overlay */}
      <div
        data-tauri-drag-region
        className="fixed inset-0 z-[9998] bg-black/50 animate-in fade-in-0 duration-200"
        onClick={handleClose}
      />
      {/* Dialog wrapper */}
      <div
        className={cn(
          'fixed z-[9999]',
          'inset-0',
          'md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2'
        )}
      >
        {/* Dialog content */}
        <div
          className={cn(
            'h-full w-full flex overflow-hidden',
            'bg-panel/95 backdrop-blur-sm shadow-lg',
            'animate-in fade-in-0 slide-in-from-bottom-4 duration-200',
            'rounded-none border-0',
            'md:w-[900px] md:h-[700px] md:rounded-sm md:border md:border-border/50'
          )}
        >
          {/* Sidebar */}
          <div
            className={cn(
              'bg-secondary/80 border-r border-border flex flex-col',
              'w-full',
              mobileShowContent && 'hidden',
              'md:w-56 md:block'
            )}
          >
            {/* Header */}
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-high">Crew</h2>
              <button
                onClick={handleClose}
                className="p-1 rounded-sm hover:bg-secondary text-low hover:text-normal md:hidden"
              >
                <XIcon className="size-icon-sm" weight="bold" />
              </button>
            </div>
            {/* Navigation */}
            <nav className="flex-1 p-2 flex flex-col gap-1 overflow-y-auto">
              {CREW_SECTIONS.map((section) => {
                const SectionIcon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => handleSectionSelect(section.id)}
                    className={cn(
                      'flex items-center gap-3 text-left px-3 py-2 rounded-sm text-sm transition-colors',
                      isActive
                        ? 'bg-brand/10 text-brand font-medium'
                        : 'text-normal hover:bg-primary/10'
                    )}
                  >
                    <SectionIcon
                      className="size-icon-sm shrink-0"
                      weight="bold"
                    />
                    <span className="truncate">
                      {SECTION_LABELS[section.id]}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
          {/* Content */}
          <div
            className={cn(
              'flex-1 flex flex-col relative overflow-hidden',
              !mobileShowContent && 'hidden',
              'md:flex'
            )}
          >
            {/* Mobile header with back button */}
            <div className="flex items-center gap-2 p-3 border-b border-border md:hidden">
              <button
                onClick={handleMobileBack}
                className="p-1 rounded-sm hover:bg-secondary text-low hover:text-normal"
              >
                <CaretLeftIcon className="size-icon-sm" weight="bold" />
              </button>
              <span className="text-sm font-medium text-high">
                {SECTION_LABELS[activeSection]}
              </span>
              <button
                onClick={handleClose}
                className="ml-auto p-1 rounded-sm hover:bg-secondary text-low hover:text-normal"
              >
                <XIcon className="size-icon-sm" weight="bold" />
              </button>
            </div>
            {/* Section content */}
            <div className="flex-1 overflow-y-auto">
              {activeSection === 'members' && <MembersSection />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const CrewDialogImpl = create(() => {
  const modal = useModal();
  const handleClose = useCallback(() => {
    modal.hide();
    modal.resolve();
    modal.remove();
  }, [modal]);

  return createPortal(
    <CrewDialogContent onClose={handleClose} />,
    document.body
  );
});

export const CrewDialog = defineModal<void, void>(CrewDialogImpl);
