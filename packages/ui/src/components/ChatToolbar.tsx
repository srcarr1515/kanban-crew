import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckIcon,
  GitBranchIcon,
  ImageIcon,
  LockSimpleIcon,
  PaperclipIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { Toolbar } from "./Toolbar";
import { ToolbarDropdown, ToolbarIconButton } from "./Toolbar";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./Dropdown";
import { AutoExpandingTextarea } from "./AutoExpandingTextarea";

export interface ChatToolbarExecutorProps<TExecutor extends string = string> {
  selected: TExecutor | null;
  options: TExecutor[];
  onChange: (executor: TExecutor) => void;
}

export interface ChatToolbarPresetProps {
  selected: string | null;
  options: { id: string; label: string }[];
  onChange: (presetId: string | null) => void;
}

export type SendShortcut = "Enter" | "ModifierEnter";

export interface ChatToolbarEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCmdEnter?: () => void;
  onShiftCmdEnter?: () => void;
  placeholder?: string;
  disabled?: boolean;
  maxRows?: number;
  /** Which key combo sends the message. Default "ModifierEnter". */
  sendShortcut?: SendShortcut;
}

export interface ChatToolbarFileUploadProps {
  /** Called when files are selected via attach button or drag-drop */
  onAttachFiles: (files: File[]) => void;
  /** File type filter for the file input. Default "image/*" */
  accept?: string;
  /** Label for the attach button. Default "Attach file" */
  attachLabel?: string;
  disabled?: boolean;
}

export interface ChatToolbarBranchOption {
  name: string;
  isCurrent?: boolean;
}

export interface ChatToolbarBranchProps {
  selected: string | null;
  options: ChatToolbarBranchOption[];
  onChange: (branch: string) => void;
}

export interface ChatToolbarCrewMemberOption {
  id: string;
  name: string;
  avatar?: string;
  role?: string;
}

export interface ChatToolbarCrewMemberProps {
  selected: string | null;
  options: ChatToolbarCrewMemberOption[];
  onChange: (memberId: string | null) => void;
  /** When true, shows a locked badge instead of the dropdown */
  locked?: boolean;
}

interface ChatToolbarProps<TExecutor extends string = string> {
  executor?: ChatToolbarExecutorProps<TExecutor>;
  formatExecutorLabel?: (executor: TExecutor) => string;
  emptyExecutorLabel?: string;

  modelSelector?: ReactNode;

  preset?: ChatToolbarPresetProps;

  branch?: ChatToolbarBranchProps;

  crewMember?: ChatToolbarCrewMemberProps;

  /** Editor props for the built-in textarea. Ignored when editorNode is provided. */
  editor?: ChatToolbarEditorProps;

  /** Pre-rendered editor node. When provided, replaces the built-in textarea. */
  editorNode?: ReactNode;

  fileUpload?: ChatToolbarFileUploadProps;

  /** Label shown on drag-drop overlay. Default "Drop files here" */
  dropLabel?: string;
  /** Sub-label shown on drag-drop overlay */
  dropSubLabel?: string;

  disabled?: boolean;
  className?: string;
}

export function defaultExecutorLabel(executor: string) {
  return executor
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isImageAvatar(avatar?: string) {
  return avatar?.startsWith("data:") || avatar?.startsWith("http");
}

function CrewMemberAvatar({ avatar, name }: { avatar?: string; name: string }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand/20 text-[10px] font-medium text-brand">
      {isImageAvatar(avatar) ? (
        <img src={avatar} alt={name} className="size-full object-cover" />
      ) : (
        avatar || name.charAt(0).toUpperCase()
      )}
    </span>
  );
}

function LockedCrewMemberBadge({
  member,
}: {
  member: ChatToolbarCrewMemberOption | undefined;
}) {
  return (
    <div className="flex items-center gap-half px-base py-half text-xs text-low">
      {member ? (
        <>
          <CrewMemberAvatar avatar={member.avatar} name={member.name} />
          <span className="font-medium text-normal">{member.name}</span>
        </>
      ) : (
        <>
          <UserCircleIcon className="size-icon-xs" weight="bold" />
          <span>Default AI</span>
        </>
      )}
      <LockSimpleIcon className="size-icon-2xs text-low" weight="bold" />
    </div>
  );
}

export function ChatToolbar<TExecutor extends string = string>({
  executor,
  formatExecutorLabel = defaultExecutorLabel,
  emptyExecutorLabel = "Select Executor",
  modelSelector,
  preset,
  branch,
  crewMember,
  editor,
  editorNode,
  fileUpload,
  dropLabel = "Drop files here",
  dropSubLabel,
  disabled = false,
  className,
}: ChatToolbarProps<TExecutor>) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const sendShortcut = editor?.sendShortcut ?? "ModifierEnter";

  const executorLabel = executor?.selected
    ? formatExecutorLabel(executor.selected)
    : emptyExecutorLabel;

  const hasToolbarContent = useMemo(
    () =>
      executor ||
      modelSelector ||
      (branch && branch.options.length > 0) ||
      crewMember ||
      (preset && preset.options.length > 0),
    [executor, modelSelector, branch, crewMember, preset],
  );

  const acceptFilter = fileUpload?.accept ?? "image/*";

  const filterFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (acceptFilter === "*" || acceptFilter === "*/*") return files;
      // Parse accept string into type prefixes (e.g. "image/*" → "image/")
      const prefixes = acceptFilter
        .split(",")
        .map((s) => s.trim().replace("/*", "/"));
      return files.filter((f) =>
        prefixes.some((p) =>
          p.endsWith("/") ? f.type.startsWith(p) : f.type === p,
        ),
      );
    },
    [acceptFilter],
  );

  // File input change handler
  const handleFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (!fileUpload) return;
      const files = filterFiles(e.target.files || []);
      if (files.length > 0) {
        fileUpload.onAttachFiles(files);
      }
      e.target.value = "";
    },
    [fileUpload, filterFiles],
  );

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Drag-drop handlers
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!fileUpload) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) {
        setIsDragOver(true);
      }
    },
    [fileUpload],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!fileUpload) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current === 0) {
        setIsDragOver(false);
      }
    },
    [fileUpload],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!fileUpload) return;
      e.preventDefault();
      e.stopPropagation();
    },
    [fileUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!fileUpload) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      const files = filterFiles(e.dataTransfer.files);
      if (files.length > 0) {
        fileUpload.onAttachFiles(files);
      }
    },
    [fileUpload, filterFiles],
  );

  // Keyboard handler: Enter / Shift+Enter / Cmd+Enter (only for built-in textarea)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!editor) return;
    const isModifier = e.metaKey || e.ctrlKey;

    // Shift+Cmd/Ctrl+Enter
    if (isModifier && e.shiftKey && e.key === "Enter") {
      e.preventDefault();
      editor.onShiftCmdEnter?.();
      return;
    }

    // Cmd/Ctrl+Enter
    if (isModifier && e.key === "Enter") {
      e.preventDefault();
      if (sendShortcut === "ModifierEnter") {
        editor.onCmdEnter?.();
      }
      return;
    }

    // Plain Enter (no modifier)
    if (e.key === "Enter" && !isModifier) {
      if (sendShortcut === "Enter" && !e.shiftKey) {
        // Enter sends; Shift+Enter inserts newline (default browser behavior)
        e.preventDefault();
        editor.onCmdEnter?.();
      }
      // When sendShortcut is "ModifierEnter", plain Enter inserts newline (default)
    }
  };

  const selectedCrewMember = crewMember?.options.find(
    (m) => m.id === crewMember.selected,
  );

  const crewMemberLabel = selectedCrewMember
    ? selectedCrewMember.name
    : "Crew Member";

  const isFileUploadDisabled = disabled || fileUpload?.disabled;

  return (
    <div
      className={cn(
        "relative flex flex-col gap-base rounded-sm border border-border bg-secondary",
        className,
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag-drop overlay */}
      {isDragOver && fileUpload && (
        <div className="absolute inset-0 z-50 flex items-center justify-center rounded-sm border-2 border-dashed border-brand bg-primary/80 backdrop-blur-sm pointer-events-none animate-in fade-in-0 duration-150">
          <div className="text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand/10">
              <ImageIcon className="h-5 w-5 text-brand" />
            </div>
            <p className="text-sm font-medium text-high">{dropLabel}</p>
            {dropSubLabel && (
              <p className="mt-0.5 text-xs text-low">{dropSubLabel}</p>
            )}
          </div>
        </div>
      )}

      {/* Toolbar row: executor, model selector, branch, crew member, preset */}
      {hasToolbarContent && (
        <Toolbar className="flex-wrap border-b px-base py-base">
          {executor && (
            <ToolbarDropdown label={executorLabel} disabled={disabled}>
              <DropdownMenuLabel>Executors</DropdownMenuLabel>
              {executor.options.map((exec) => (
                <DropdownMenuItem
                  key={exec}
                  icon={executor.selected === exec ? CheckIcon : undefined}
                  onClick={() => executor.onChange(exec)}
                >
                  {formatExecutorLabel(exec)}
                </DropdownMenuItem>
              ))}
            </ToolbarDropdown>
          )}

          {modelSelector}

          {branch && branch.options.length > 0 && (
            <ToolbarDropdown
              label={branch.selected ?? "Branch"}
              icon={GitBranchIcon}
              disabled={disabled}
            >
              <DropdownMenuLabel>Branches</DropdownMenuLabel>
              {branch.options.map((b) => (
                <DropdownMenuItem
                  key={b.name}
                  icon={branch.selected === b.name ? CheckIcon : undefined}
                  onClick={() => branch.onChange(b.name)}
                >
                  {b.name}
                  {b.isCurrent && (
                    <span className="ml-auto text-xs text-low">current</span>
                  )}
                </DropdownMenuItem>
              ))}
            </ToolbarDropdown>
          )}

          {crewMember &&
            (crewMember.locked ? (
              <LockedCrewMemberBadge member={selectedCrewMember} />
            ) : (
              <ToolbarDropdown
                label={crewMemberLabel}
                icon={UserCircleIcon}
                disabled={disabled}
              >
                <DropdownMenuLabel>Crew Member</DropdownMenuLabel>
                <DropdownMenuItem
                  icon={crewMember.selected === null ? CheckIcon : undefined}
                  onClick={() => crewMember.onChange(null)}
                >
                  Default AI
                </DropdownMenuItem>
                {crewMember.options.length > 0 && <DropdownMenuSeparator />}
                {crewMember.options.map((member) => (
                  <DropdownMenuItem
                    key={member.id}
                    icon={
                      crewMember.selected === member.id ? CheckIcon : undefined
                    }
                    onClick={() => crewMember.onChange(member.id)}
                  >
                    <span className="flex items-center gap-half">
                      <CrewMemberAvatar
                        avatar={member.avatar}
                        name={member.name}
                      />
                      <span className="flex flex-col min-w-0">
                        <span className="truncate">{member.name}</span>
                        {member.role && (
                          <span className="truncate text-xs text-low">
                            {member.role}
                          </span>
                        )}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </ToolbarDropdown>
            ))}

          {preset && preset.options.length > 0 && (
            <ToolbarDropdown
              label={
                preset.options.find((p) => p.id === preset.selected)?.label ??
                "Preset"
              }
              disabled={disabled}
            >
              <DropdownMenuLabel>Presets</DropdownMenuLabel>
              <DropdownMenuItem
                icon={preset.selected === null ? CheckIcon : undefined}
                onClick={() => preset.onChange(null)}
              >
                None
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {preset.options.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  icon={preset.selected === p.id ? CheckIcon : undefined}
                  onClick={() => preset.onChange(p.id)}
                >
                  {p.label}
                </DropdownMenuItem>
              ))}
            </ToolbarDropdown>
          )}
        </Toolbar>
      )}

      {/* Input area: custom editor node or built-in textarea with optional attach button */}
      {editorNode ? (
        <div className="px-base">{editorNode}</div>
      ) : editor ? (
        <div className="flex items-end gap-half px-base pb-base">
          {fileUpload && (
            <>
              <ToolbarIconButton
                icon={PaperclipIcon}
                aria-label={fileUpload.attachLabel ?? "Attach file"}
                title={fileUpload.attachLabel ?? "Attach file"}
                onClick={handleAttachClick}
                disabled={isFileUploadDisabled}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptFilter}
                multiple
                className="hidden"
                onChange={handleFileInputChange}
              />
            </>
          )}
          <AutoExpandingTextarea
            value={editor.value}
            onChange={(e) => editor.onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={editor.placeholder ?? "Type a message..."}
            disabled={disabled || editor.disabled}
            maxRows={editor.maxRows ?? 8}
            className="flex-1 bg-secondary"
          />
        </div>
      ) : null}
    </div>
  );
}
