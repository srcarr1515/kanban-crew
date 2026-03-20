import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import {
  XIcon,
  LinkIcon,
  DotsThreeIcon,
  TrashIcon,
  PaperclipIcon,
  ImageIcon,
  EyeIcon,
  PencilSimpleIcon,
  CaretDownIcon,
  CaretUpIcon,
  ClockIcon,
} from '@phosphor-icons/react';
import {
  IssueTagsRow,
  type IssueTagBase,
  type IssueTagsRowAddTagControlProps,
  type LinkedPullRequest as IssueTagsLinkedPullRequest,
} from './IssueTagsRow';
import { PrimaryButton } from './PrimaryButton';
import { Toggle } from './Toggle';
import {
  IssuePropertyRow,
  type IssuePropertyRowProps,
} from './IssuePropertyRow';
import { IconButton } from './IconButton';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './RadixTooltip';
import { ErrorAlert } from './ErrorAlert';

export type IssuePanelMode = 'create' | 'edit';
type IssuePriority = IssuePropertyRowProps['priority'];
type IssueStatus = IssuePropertyRowProps['statuses'][number];
type IssueAssignee = NonNullable<
  IssuePropertyRowProps['assigneeUsers']
>[number];
type IssueCreator = Exclude<IssuePropertyRowProps['creatorUser'], undefined>;
export interface KanbanIssueTag extends IssueTagBase {
  project_id: string;
}

export interface IssueFormData {
  title: string;
  description: string | null;
  statusId: string;
  priority: IssuePriority | null;
  assigneeIds: string[];
  tagIds: string[];
  createDraftWorkspace: boolean;
}

export type IntervalUnit = 'minutes' | 'hours' | 'daily' | 'weekly';
export type ScheduleMode = 'simple' | 'cron';

export interface ScheduleConfig {
  saveAsTemplate: boolean;
  scheduleMode: ScheduleMode;
  intervalUnit: IntervalUnit;
  intervalEvery: number;
  intervalHour: number;
  intervalMinute: number;
  intervalDayOfWeek: number;
  cronExpression: string;
  targetColumnId: string;
  enabled: boolean;
}

export interface LinkedPullRequest extends IssueTagsLinkedPullRequest {}

export interface KanbanIssueDescriptionEditorProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onCmdEnter?: () => void;
  onPasteFiles?: (files: File[]) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  showStaticToolbar?: boolean;
  saveStatus?: 'idle' | 'saved';
  staticToolbarActions?: ReactNode;
  onRequestEdit?: () => void;
  hideActions?: boolean;
}

export interface KanbanIssuePanelProps {
  mode: IssuePanelMode;
  displayId: string;

  // Form data
  formData: IssueFormData;
  onFormChange: <K extends keyof IssueFormData>(
    field: K,
    value: IssueFormData[K]
  ) => void;

  // Options for dropdowns
  statuses: IssueStatus[];
  tags: KanbanIssueTag[];

  // Resolved assignee profiles for avatar display
  assigneeUsers?: IssueAssignee[];

  // Edit mode data
  issueId?: string | null;
  creatorUser?: IssueCreator;
  parentIssue?: { id: string; simpleId: string } | null;
  onParentIssueClick?: () => void;
  onRemoveParentIssue?: () => void;
  linkedPrs?: LinkedPullRequest[];

  // Actions
  onClose: () => void;
  onSubmit: () => void;
  onCmdEnterSubmit?: () => void;
  onDeleteDraft?: () => void;

  // Tag create callback - returns the new tag ID
  onCreateTag?: (data: { name: string; color: string }) => string;
  renderAddTagControl?: (
    props: IssueTagsRowAddTagControlProps<KanbanIssueTag>
  ) => ReactNode;
  renderDescriptionEditor: (
    props: KanbanIssueDescriptionEditorProps
  ) => ReactNode;

  // Loading states
  isSubmitting?: boolean;

  // Save status for description field
  descriptionSaveStatus?: 'idle' | 'saved';

  // Ref for title input (created in container)
  titleInputRef: RefObject<HTMLTextAreaElement>;

  // Copy link callback (edit mode only)
  onCopyLink?: () => void;

  // More actions callback (edit mode only) - opens command bar with issue actions
  onMoreActions?: () => void;

  // Image attachment upload
  onPasteFiles?: (files: File[]) => void;
  dropzoneProps?: {
    getRootProps: () => Record<string, unknown>;
    getInputProps: () => Record<string, unknown>;
    isDragActive: boolean;
  };
  onBrowseAttachment?: () => void;
  isUploading?: boolean;
  attachmentError?: string | null;
  onDismissAttachmentError?: () => void;

  // Schedule template (create mode only)
  scheduleConfig?: ScheduleConfig;
  onScheduleConfigChange?: <K extends keyof ScheduleConfig>(
    field: K,
    value: ScheduleConfig[K]
  ) => void;
  targetColumnStatuses?: { id: string; name: string }[];

  // Edit-mode section renderers
  renderWorkspacesSection?: (issueId: string) => ReactNode;
  renderRelationshipsSection?: (issueId: string) => ReactNode;
  renderSubIssuesSection?: (issueId: string) => ReactNode;
  renderCommentsSection?: (issueId: string) => ReactNode;
  renderArtifactsSection?: (issueId: string) => ReactNode;
  renderHistorySection?: (issueId: string) => ReactNode;
}

export function KanbanIssuePanel({
  mode,
  displayId,
  formData,
  onFormChange,
  statuses,
  tags,
  assigneeUsers,
  issueId,
  creatorUser,
  parentIssue,
  onParentIssueClick,
  onRemoveParentIssue,
  linkedPrs = [],
  onClose,
  onSubmit,
  onCmdEnterSubmit,
  onDeleteDraft,
  onCreateTag,
  renderAddTagControl,
  renderDescriptionEditor,
  isSubmitting,
  descriptionSaveStatus,
  titleInputRef,
  onCopyLink,
  onMoreActions,
  onPasteFiles,
  dropzoneProps,
  onBrowseAttachment,
  isUploading,
  attachmentError,
  onDismissAttachmentError,
  scheduleConfig,
  onScheduleConfigChange,
  targetColumnStatuses,
  renderWorkspacesSection,
  renderRelationshipsSection,
  renderSubIssuesSection,
  renderCommentsSection,
  renderArtifactsSection,
  renderHistorySection,
}: KanbanIssuePanelProps) {
  const { t } = useTranslation('common');
  const isCreateMode = mode === 'create';
  const breadcrumbTextClass =
    'min-w-0 text-sm text-normal truncate rounded-sm px-1 py-0.5 hover:bg-panel hover:text-high transition-colors';
  const [scheduleAccordionOpen, setScheduleAccordionOpen] = useState(false);
  const creatorName =
    creatorUser?.first_name?.trim() || creatorUser?.username?.trim() || null;
  const showCreator = !isCreateMode && Boolean(creatorName);

  // Description edit state: in edit mode, show preview by default; in create mode, always editable
  const [isDescriptionEditing, setIsDescriptionEditing] =
    useState(isCreateMode);
  const descriptionContainerRef = useRef<HTMLDivElement>(null);

  // Reset description editing state when switching between create/edit mode or when issue changes
  useEffect(() => {
    setIsDescriptionEditing(isCreateMode);
  }, [isCreateMode, issueId]);

  // Click outside the description area to exit editing
  const handleDescriptionBlur = useCallback(() => {
    if (!isCreateMode) {
      setIsDescriptionEditing(false);
    }
  }, [isCreateMode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
      if (isEditable) {
        // If editing description, exit edit mode first
        if (
          isDescriptionEditing &&
          !isCreateMode &&
          descriptionContainerRef.current?.contains(target)
        ) {
          setIsDescriptionEditing(false);
        }
        target.blur();
        (e.currentTarget as HTMLElement).focus();
        e.stopPropagation();
      } else {
        onClose();
      }
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onCmdEnterSubmit?.();
    }
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden outline-none"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-base py-half border-b shrink-0">
        <div className="flex items-center gap-half min-w-0 font-ibm-plex-mono">
          <span className={`${breadcrumbTextClass} shrink-0`}>{displayId}</span>
          {!isCreateMode && onCopyLink && (
            <button
              type="button"
              onClick={onCopyLink}
              className="p-half rounded-sm text-low hover:text-normal hover:bg-panel transition-colors"
              aria-label={t('kanban.copyLink')}
            >
              <LinkIcon className="size-icon-sm" weight="bold" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-half">
          {!isCreateMode && onMoreActions && (
            <button
              type="button"
              onClick={onMoreActions}
              className="p-half rounded-sm text-low hover:text-normal hover:bg-panel transition-colors"
              aria-label={t('kanban.moreActions')}
            >
              <DotsThreeIcon className="size-icon-sm" weight="bold" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-half rounded-sm text-low hover:text-normal hover:bg-panel transition-colors"
            aria-label={t('kanban.closePanel')}
          >
            <XIcon className="size-icon-sm" weight="bold" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Property Row */}
        <div className="px-base py-base border-b">
          <IssuePropertyRow
            statusId={formData.statusId}
            priority={formData.priority}
            assigneeIds={formData.assigneeIds}
            assigneeUsers={assigneeUsers}
            statuses={statuses}
            creatorUser={showCreator ? creatorUser : undefined}
            parentIssue={parentIssue}
            onParentIssueClick={onParentIssueClick}
            onRemoveParentIssue={onRemoveParentIssue}
            onStatusClick={() => onFormChange('statusId', formData.statusId)}
            onPriorityClick={() => onFormChange('priority', formData.priority)}
            onAssigneeClick={() =>
              onFormChange('assigneeIds', formData.assigneeIds)
            }
            disabled={isSubmitting}
          />
        </div>

        {/* Tags Row */}
        <div className="px-base py-base border-b">
          <IssueTagsRow
            selectedTagIds={formData.tagIds}
            availableTags={tags}
            linkedPrs={isCreateMode ? [] : linkedPrs}
            onTagsChange={(tagIds) => onFormChange('tagIds', tagIds)}
            onCreateTag={onCreateTag}
            renderAddTagControl={renderAddTagControl}
            disabled={isSubmitting}
          />
        </div>

        {/* Title and Description */}
        <div className="rounded-sm">
          {/* Title Input */}
          <div className="w-full mt-base">
            <AutoResizeTextarea
              ref={titleInputRef}
              value={formData.title}
              onChange={(value) => onFormChange('title', value)}
              onKeyDown={handleTitleKeyDown}
              placeholder="Issue Title..."
              autoFocus={isCreateMode}
              aria-label="Issue title"
              disabled={isSubmitting}
              className={cn(
                'px-base text-lg font-medium text-high',
                'placeholder:text-high/50',
                isSubmitting && 'opacity-50 pointer-events-none'
              )}
            />

            <div
              className={cn(
                'pointer-events-none absolute inset-0 px-base',
                'text-high/50 font-medium text-lg',
                'hidden',
                "[[data-empty='true']_+_&]:block" // show placeholder when previous sibling data-empty=true
              )}
            >
              {t('kanban.issueTitlePlaceholder')}
            </div>
          </div>

          {/* Description WYSIWYG Editor with image dropzone */}
          <div
            ref={descriptionContainerRef}
            {...(isDescriptionEditing ? dropzoneProps?.getRootProps() : {})}
            className={cn(
              'relative mt-base',
              !isDescriptionEditing && !isCreateMode && 'cursor-text'
            )}
            onClick={() => {
              if (!isDescriptionEditing && !isCreateMode && !isSubmitting) {
                // Don't enter edit mode if the user was selecting text
                const selection = window.getSelection();
                if (selection && selection.toString().length > 0) return;
                setIsDescriptionEditing(true);
              }
            }}
            onBlur={(e) => {
              // Exit edit mode when focus leaves the description container
              if (
                descriptionContainerRef.current &&
                !descriptionContainerRef.current.contains(
                  e.relatedTarget as Node
                )
              ) {
                handleDescriptionBlur();
              }
            }}
          >
            {isDescriptionEditing && (
              <input
                {...(dropzoneProps?.getInputProps() as React.InputHTMLAttributes<HTMLInputElement>)}
                data-dropzone-input
              />
            )}
            {renderDescriptionEditor({
              placeholder: isDescriptionEditing
                ? t('kanban.issueDescriptionPlaceholder')
                : formData.description
                  ? ''
                  : t('kanban.issueDescriptionPlaceholder'),
              value: formData.description ?? '',
              onChange: (value) => onFormChange('description', value || null),
              onCmdEnter: onCmdEnterSubmit,
              onPasteFiles: isDescriptionEditing ? onPasteFiles : undefined,
              disabled: !isDescriptionEditing || isSubmitting,
              autoFocus: false,
              className: cn(
                'px-base',
                isDescriptionEditing ? 'min-h-[100px]' : 'min-h-[2rem]',
                !isDescriptionEditing && !formData.description && 'text-low'
              ),
              showStaticToolbar: !isCreateMode || isDescriptionEditing,
              hideActions: true,
              saveStatus: descriptionSaveStatus,
              onRequestEdit: !isCreateMode
                ? () => setIsDescriptionEditing(true)
                : undefined,
              staticToolbarActions: (
                <>
                  {isDescriptionEditing && onBrowseAttachment && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              if (!isSubmitting && !isUploading) {
                                onBrowseAttachment();
                              }
                            }}
                            disabled={isSubmitting || isUploading}
                            className={cn(
                              'p-half rounded-sm transition-colors',
                              'text-low hover:text-normal hover:bg-panel/50',
                              'disabled:opacity-50 disabled:cursor-not-allowed'
                            )}
                            title={t('kanban.attachFile')}
                            aria-label={t('kanban.attachFile')}
                          >
                            <PaperclipIcon className="size-icon-sm" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('kanban.attachFileHint')}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {!isCreateMode && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setIsDescriptionEditing(!isDescriptionEditing);
                            }}
                            className={cn(
                              'p-half rounded-sm transition-colors',
                              'text-low hover:text-normal hover:bg-panel/50'
                            )}
                            title={
                              isDescriptionEditing
                                ? t('kanban.previewDescription', 'Preview')
                                : t('kanban.editDescription', 'Edit')
                            }
                            aria-label={
                              isDescriptionEditing
                                ? t('kanban.previewDescription', 'Preview')
                                : t('kanban.editDescription', 'Edit')
                            }
                          >
                            {isDescriptionEditing ? (
                              <EyeIcon className="size-icon-sm" />
                            ) : (
                              <PencilSimpleIcon className="size-icon-sm" />
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isDescriptionEditing
                            ? t('kanban.previewDescription', 'Preview')
                            : t('kanban.editDescription', 'Edit')}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </>
              ),
            })}
            {attachmentError && (
              <div className="px-base">
                <ErrorAlert
                  message={attachmentError}
                  className="mt-half mb-half"
                  onDismiss={onDismissAttachmentError}
                  dismissLabel={t('buttons.close')}
                />
              </div>
            )}
            {dropzoneProps?.isDragActive && (
              <div className="absolute inset-0 z-50 bg-primary/80 backdrop-blur-sm border-2 border-dashed border-brand rounded flex items-center justify-center pointer-events-none animate-in fade-in-0 duration-150">
                <div className="text-center">
                  <div className="mx-auto mb-2 w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center">
                    <ImageIcon className="h-5 w-5 text-brand" />
                  </div>
                  <p className="text-sm font-medium text-high">
                    {t('kanban.dropFilesHere')}
                  </p>
                  <p className="text-xs text-low mt-0.5">
                    {t('kanban.fileDropHint')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Create Draft Workspace Toggle (Create mode only) */}
        {isCreateMode && (
          <div className="p-base border-t">
            <Toggle
              checked={formData.createDraftWorkspace}
              onCheckedChange={(checked) =>
                onFormChange('createDraftWorkspace', checked)
              }
              label={t('kanban.createDraftWorkspaceImmediately')}
              description={t('kanban.createDraftWorkspaceDescription')}
              disabled={isSubmitting}
            />
          </div>
        )}

        {/* Save as Template checkbox (Create mode only) */}
        {isCreateMode && scheduleConfig && onScheduleConfigChange && (
          <div className="px-base py-base border-t">
            <Toggle
              checked={scheduleConfig.saveAsTemplate}
              onCheckedChange={(checked) => {
                onScheduleConfigChange('saveAsTemplate', checked);
                if (checked) setScheduleAccordionOpen(true);
              }}
              label="Save as scheduled template"
              description="Create a scheduled job that spawns copies of this task on a recurring schedule"
              disabled={isSubmitting}
            />

            {/* Schedule settings accordion */}
            {scheduleConfig.saveAsTemplate && (
              <div className="mt-base">
                <button
                  type="button"
                  className="flex items-center gap-half text-sm text-normal hover:text-high transition-colors w-full"
                  onClick={() => setScheduleAccordionOpen((v) => !v)}
                >
                  <ClockIcon className="size-icon-sm" />
                  <span className="font-medium">Schedule Settings</span>
                  {scheduleAccordionOpen ? (
                    <CaretUpIcon className="size-icon-sm ml-auto" />
                  ) : (
                    <CaretDownIcon className="size-icon-sm ml-auto" />
                  )}
                </button>

                {scheduleAccordionOpen && (
                  <div className="mt-base space-y-3 pl-half">
                    {/* Schedule mode toggle */}
                    <div className="space-y-1">
                      <span className="text-xs text-low font-medium">Schedule</span>
                      <div className="flex gap-1 p-0.5 bg-secondary rounded w-fit">
                        <button
                          type="button"
                          className={cn(
                            'px-3 py-1 text-xs rounded transition-colors',
                            scheduleConfig.scheduleMode === 'simple'
                              ? 'bg-primary text-high shadow-sm'
                              : 'text-low hover:text-normal'
                          )}
                          onClick={() => onScheduleConfigChange('scheduleMode', 'simple')}
                        >
                          Simple interval
                        </button>
                        <button
                          type="button"
                          className={cn(
                            'px-3 py-1 text-xs rounded transition-colors',
                            scheduleConfig.scheduleMode === 'cron'
                              ? 'bg-primary text-high shadow-sm'
                              : 'text-low hover:text-normal'
                          )}
                          onClick={() => onScheduleConfigChange('scheduleMode', 'cron')}
                        >
                          Cron expression
                        </button>
                      </div>
                    </div>

                    {/* Simple interval builder */}
                    {scheduleConfig.scheduleMode === 'simple' ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-normal">Every</span>
                        {(scheduleConfig.intervalUnit === 'minutes' || scheduleConfig.intervalUnit === 'hours') && (
                          <input
                            type="number"
                            className="w-14 h-7 px-2 text-sm text-center bg-primary border rounded"
                            min={1}
                            max={scheduleConfig.intervalUnit === 'minutes' ? 59 : 23}
                            value={scheduleConfig.intervalEvery}
                            onChange={(e) => onScheduleConfigChange('intervalEvery', Math.max(1, parseInt(e.target.value, 10) || 1))}
                          />
                        )}
                        <select
                          className="h-7 px-2 text-sm bg-primary border rounded"
                          value={scheduleConfig.intervalUnit}
                          onChange={(e) => onScheduleConfigChange('intervalUnit', e.target.value as IntervalUnit)}
                        >
                          <option value="minutes">minute(s)</option>
                          <option value="hours">hour(s)</option>
                          <option value="daily">day</option>
                          <option value="weekly">week</option>
                        </select>
                        {scheduleConfig.intervalUnit === 'weekly' && (
                          <>
                            <span className="text-normal">on</span>
                            <select
                              className="h-7 px-2 text-sm bg-primary border rounded"
                              value={scheduleConfig.intervalDayOfWeek}
                              onChange={(e) => onScheduleConfigChange('intervalDayOfWeek', parseInt(e.target.value, 10))}
                            >
                              <option value={1}>Monday</option>
                              <option value={2}>Tuesday</option>
                              <option value={3}>Wednesday</option>
                              <option value={4}>Thursday</option>
                              <option value={5}>Friday</option>
                              <option value={6}>Saturday</option>
                              <option value={0}>Sunday</option>
                            </select>
                          </>
                        )}
                        {(scheduleConfig.intervalUnit === 'daily' || scheduleConfig.intervalUnit === 'weekly') && (
                          <>
                            <span className="text-normal">at</span>
                            <select
                              className="h-7 px-2 text-sm bg-primary border rounded"
                              value={scheduleConfig.intervalHour}
                              onChange={(e) => onScheduleConfigChange('intervalHour', parseInt(e.target.value, 10))}
                            >
                              {Array.from({ length: 24 }, (_, i) => (
                                <option key={i} value={i}>
                                  {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                                </option>
                              ))}
                            </select>
                            <span className="text-normal">:</span>
                            <select
                              className="h-7 px-2 text-sm bg-primary border rounded"
                              value={scheduleConfig.intervalMinute}
                              onChange={(e) => onScheduleConfigChange('intervalMinute', parseInt(e.target.value, 10))}
                            >
                              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <input
                          type="text"
                          className="w-full h-7 px-2 text-sm font-mono bg-primary border rounded"
                          placeholder="0 9 * * *"
                          value={scheduleConfig.cronExpression}
                          onChange={(e) => onScheduleConfigChange('cronExpression', e.target.value)}
                        />
                        <p className="text-xs text-low">
                          Format: minute hour day-of-month month day-of-week
                        </p>
                      </div>
                    )}

                    {/* Target column */}
                    {targetColumnStatuses && targetColumnStatuses.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-xs text-low font-medium">Target Column</span>
                        <select
                          className="h-7 px-2 text-sm bg-primary border rounded w-full"
                          value={scheduleConfig.targetColumnId}
                          onChange={(e) => onScheduleConfigChange('targetColumnId', e.target.value)}
                        >
                          {targetColumnStatuses.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                        <p className="text-xs text-low">Column where spawned tasks will be placed</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Create Issue Button (Create mode only) */}
        {isCreateMode && (
          <div className="px-base pb-base flex items-center gap-half">
            <PrimaryButton
              value={
                scheduleConfig?.saveAsTemplate
                  ? t('kanban.createIssue') + ' & Schedule'
                  : t('kanban.createIssue')
              }
              onClick={onSubmit}
              disabled={isSubmitting || !formData.title.trim()}
              actionIcon={isSubmitting ? 'spinner' : undefined}
              variant="default"
            />
            {onDeleteDraft && (
              <IconButton
                icon={TrashIcon}
                onClick={onDeleteDraft}
                disabled={isSubmitting}
                aria-label="Delete draft"
                title="Delete draft"
                className="hover:text-error hover:bg-error/10"
              />
            )}
          </div>
        )}

        {/* Workspaces Section (Edit mode only) */}
        {!isCreateMode && issueId && renderWorkspacesSection && (
          <div className="border-t">{renderWorkspacesSection(issueId)}</div>
        )}

        {/* Relationships Section (Edit mode only) */}
        {!isCreateMode && issueId && renderRelationshipsSection && (
          <div className="border-t">{renderRelationshipsSection(issueId)}</div>
        )}

        {/* Sub-Issues Section (Edit mode only) */}
        {!isCreateMode && issueId && renderSubIssuesSection && (
          <div className="border-t">{renderSubIssuesSection(issueId)}</div>
        )}

        {/* Comments Section (Edit mode only) */}
        {!isCreateMode && issueId && renderCommentsSection && (
          <div className="border-t">{renderCommentsSection(issueId)}</div>
        )}

        {/* Artifacts Section (Edit mode only) */}
        {!isCreateMode && issueId && renderArtifactsSection && (
          <div className="border-t">{renderArtifactsSection(issueId)}</div>
        )}

        {/* History Section (Edit mode only, shown for template tasks) */}
        {!isCreateMode && issueId && renderHistorySection && (
          <div className="border-t">{renderHistorySection(issueId)}</div>
        )}
      </div>
    </div>
  );
}
