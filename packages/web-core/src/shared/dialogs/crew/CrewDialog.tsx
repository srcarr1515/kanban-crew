import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@vibe/ui/components/KeyboardDialog';
import { Button } from '@vibe/ui/components/Button';
import { SpinnerIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { create, useModal } from '@ebay/nice-modal-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { defineModal } from '@/shared/lib/modals';
import {
  listCrewMembers,
  createCrewMember,
  deleteCrewMember,
  type CrewMember,
} from '@/shared/lib/local/localApi';
import { cn } from '@/shared/lib/utils';

const CREW_MEMBERS_KEY = ['local', 'crew-members'];

const CrewDialogImpl = create(() => {
  const modal = useModal();
  const queryClient = useQueryClient();

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');

  const { data: members = [], isLoading } = useQuery({
    queryKey: CREW_MEMBERS_KEY,
    queryFn: listCrewMembers,
  });

  const addMutation = useMutation({
    mutationFn: createCrewMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CREW_MEMBERS_KEY });
      setNewName('');
      setNewRole('');
      setShowAddForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCrewMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CREW_MEMBERS_KEY });
    },
  });

  const handleAdd = () => {
    if (!newName.trim() || !newRole.trim()) return;
    addMutation.mutate({ name: newName.trim(), role: newRole.trim() });
  };

  const handleClose = () => {
    modal.hide();
  };

  return (
    <Dialog open={modal.visible} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Crew</DialogTitle>
          <DialogDescription>
            Manage your crew members and their roles.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <SpinnerIcon className="size-5 animate-spin text-muted" />
            </div>
          )}

          {!isLoading && members.length === 0 && !showAddForm && (
            <div className="text-center py-8">
              <p className="text-sm text-low">No crew members yet.</p>
              <p className="text-xs text-muted mt-1">
                Add crew members to assign roles and configure your team.
              </p>
            </div>
          )}

          {!isLoading &&
            members.map((member: CrewMember) => (
              <div
                key={member.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg',
                  'bg-secondary border border-border'
                )}
              >
                <div
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full shrink-0',
                    'bg-brand/20 text-brand text-sm font-medium'
                  )}
                >
                  {member.avatar || member.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-high truncate">
                    {member.name}
                  </p>
                  <p className="text-xs text-low truncate">{member.role}</p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(member.id)}
                  disabled={deleteMutation.isPending}
                  className="p-1.5 rounded-md text-low hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                  aria-label={`Remove ${member.name}`}
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
            ))}

          {showAddForm && (
            <div className="space-y-2 p-3 rounded-lg border border-border bg-secondary">
              <input
                type="text"
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className={cn(
                  'w-full px-3 py-1.5 rounded-md text-sm',
                  'bg-primary border border-border text-normal',
                  'placeholder:text-muted',
                  'focus:outline-none focus:ring-2 focus:ring-brand'
                )}
                autoFocus
              />
              <input
                type="text"
                placeholder="Role (e.g. Frontend Developer)"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
                className={cn(
                  'w-full px-3 py-1.5 rounded-md text-sm',
                  'bg-primary border border-border text-normal',
                  'placeholder:text-muted',
                  'focus:outline-none focus:ring-2 focus:ring-brand'
                )}
              />
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={handleAdd}
                  disabled={
                    !newName.trim() ||
                    !newRole.trim() ||
                    addMutation.isPending
                  }
                >
                  {addMutation.isPending ? 'Adding...' : 'Add'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewName('');
                    setNewRole('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {!showAddForm && (
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(true)}
              className="gap-1.5"
            >
              <PlusIcon className="size-4" />
              Add Member
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});

export const CrewDialog = defineModal<void, void>(CrewDialogImpl);
