import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TrashIcon,
  PencilSimpleIcon,
  ArrowLeftIcon,
  UploadSimpleIcon,
} from '@phosphor-icons/react';
import { skillsApi } from '@/shared/lib/api';
import type { SkillEntry } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import {
  SettingsCard,
  SettingsField,
  SettingsInput,
  SettingsTextarea,
} from './SettingsComponents';

// ── Types ──────────────────────────────────────────────────────────────────

type View = 'list' | 'preview' | 'create' | 'edit';

// ── Main Component ─────────────────────────────────────────────────────────

export function SkillsSettingsSection() {
  const { t } = useTranslation('settings');
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('list');
  const [selectedSkill, setSelectedSkill] = useState<SkillEntry | null>(null);
  const [filter, setFilter] = useState('');

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await skillsApi.list();
      setSkills(data);
    } catch {
      setError(t('settings.skills.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleSelectSkill = (skill: SkillEntry) => {
    setSelectedSkill(skill);
    setView('preview');
  };

  const handleCreate = () => {
    setSelectedSkill(null);
    setView('create');
  };

  const handleEdit = (skill: SkillEntry) => {
    setSelectedSkill(skill);
    setView('edit');
  };

  const handleDelete = async (skill: SkillEntry) => {
    if (!skill.id) return;

    const result = await ConfirmDialog.show({
      title: t('settings.skills.delete.title'),
      message: t('settings.skills.delete.message', { name: skill.name }),
      confirmText: t('settings.skills.delete.confirm'),
      cancelText: t('settings.skills.delete.cancel'),
      variant: 'destructive',
    });

    if (result === 'confirmed') {
      try {
        await skillsApi.delete(skill.id);
        await loadSkills();
        if (selectedSkill?.id === skill.id) {
          setSelectedSkill(null);
          setView('list');
        }
      } catch {
        setError(t('settings.skills.errors.deleteFailed'));
      }
    }
  };

  const handleSaved = async () => {
    await loadSkills();
    setView('list');
    setSelectedSkill(null);
  };

  const handleBack = () => {
    setView('list');
    setSelectedSkill(null);
  };

  const filteredSkills = filter
    ? skills.filter(
        (s: SkillEntry) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.description.toLowerCase().includes(filter.toLowerCase())
      )
    : skills;

  if (view === 'create' || view === 'edit') {
    return (
      <SkillForm
        skill={view === 'edit' ? selectedSkill : null}
        onSaved={handleSaved}
        onCancel={handleBack}
      />
    );
  }

  if (view === 'preview' && selectedSkill) {
    return (
      <SkillPreview
        skill={selectedSkill}
        onBack={handleBack}
        onEdit={
          selectedSkill.source === 'database'
            ? () => handleEdit(selectedSkill)
            : undefined
        }
        onDelete={
          selectedSkill.source === 'database'
            ? () => handleDelete(selectedSkill)
            : undefined
        }
      />
    );
  }

  return (
    <>
      {error && (
        <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error text-sm">
          {error}
        </div>
      )}

      <SettingsCard
        title={t('settings.skills.list.title')}
        description={t('settings.skills.description')}
        headerAction={
          <PrimaryButton
            value={t('settings.skills.form.createTitle')}
            onClick={handleCreate}
          />
        }
      >
        <SettingsInput
          value={filter}
          onChange={setFilter}
          placeholder={t('settings.skills.list.searchPlaceholder')}
        />

        <div className="border border-border rounded-sm overflow-hidden">
          {loading ? (
            <div className="px-base py-plusfifty text-sm text-low text-center">
              Loading...
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="px-base py-plusfifty text-sm text-low text-center">
              {t('settings.skills.list.empty')}
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-border">
              {filteredSkills.map((skill: SkillEntry) => (
                <SkillRow
                  key={skill.id ?? `disk-${skill.name}`}
                  skill={skill}
                  onSelect={handleSelectSkill}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </SettingsCard>
    </>
  );
}

// ── Skill Row ──────────────────────────────────────────────────────────────

function SkillRow({
  skill,
  onSelect,
  onEdit,
  onDelete,
}: {
  skill: SkillEntry;
  onSelect: (skill: SkillEntry) => void;
  onEdit: (skill: SkillEntry) => void;
  onDelete: (skill: SkillEntry) => void | Promise<void>;
}) {
  const { t } = useTranslation('settings');
  const isCustom = skill.source === 'database';

  return (
    <div
      className="group flex items-center gap-3 px-base py-2 cursor-pointer hover:bg-secondary transition-colors"
      onClick={() => onSelect(skill)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-normal truncate">
            {skill.name}
          </span>
          <span
            className={cn(
              'text-xs px-1.5 py-0.5 rounded font-medium shrink-0',
              isCustom
                ? 'bg-brand/15 text-brand'
                : 'bg-secondary text-low'
            )}
          >
            {isCustom
              ? t('settings.skills.list.sourceDatabase')
              : t('settings.skills.list.sourceDisk')}
          </span>
        </div>
        {skill.description && (
          <p className="text-xs text-low mt-0.5 truncate">
            {skill.description}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {isCustom && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(skill);
              }}
              className="p-1 rounded-sm hover:bg-primary/10 text-low hover:text-normal"
            >
              <PencilSimpleIcon className="size-icon-xs" weight="bold" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(skill);
              }}
              className="p-1 rounded-sm hover:bg-error/10 text-low hover:text-error"
            >
              <TrashIcon className="size-icon-xs" weight="bold" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Skill Preview ──────────────────────────────────────────────────────────

function SkillPreview({
  skill,
  onBack,
  onEdit,
  onDelete,
}: {
  skill: SkillEntry;
  onBack: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation('settings');
  const isCustom = skill.source === 'database';

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onBack}
          className="p-1 rounded-sm hover:bg-secondary text-low hover:text-normal"
        >
          <ArrowLeftIcon className="size-icon-sm" weight="bold" />
        </button>
        <h3 className="text-base font-medium text-high flex-1">{skill.name}</h3>
        <span
          className={cn(
            'text-xs px-1.5 py-0.5 rounded font-medium',
            isCustom
              ? 'bg-brand/15 text-brand'
              : 'bg-secondary text-low'
          )}
        >
          {isCustom
            ? t('settings.skills.list.sourceDatabase')
            : t('settings.skills.list.sourceDisk')}
        </span>
      </div>

      <SettingsCard title={t('settings.skills.preview.title')}>
        {skill.description && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-low">
              {t('settings.skills.form.description')}
            </label>
            <p className="text-sm text-normal">{skill.description}</p>
          </div>
        )}

        {skill.trigger_description && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-low">
              {t('settings.skills.preview.triggerLabel')}
            </label>
            <p className="text-sm text-normal">{skill.trigger_description}</p>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium text-low">
            {t('settings.skills.form.content')}
          </label>
          <pre className="text-sm text-normal bg-secondary border border-border rounded-sm p-3 overflow-auto max-h-80 whitespace-pre-wrap font-mono">
            {skill.content || t('settings.skills.preview.emptyContent')}
          </pre>
        </div>
      </SettingsCard>

      {isCustom && (
        <div className="flex gap-2 mt-4">
          {onEdit && (
            <PrimaryButton
              value={t('settings.skills.form.editTitle')}
              onClick={onEdit}
            />
          )}
          {onDelete && (
            <PrimaryButton
              variant="tertiary"
              value={t('settings.skills.delete.confirm')}
              onClick={onDelete}
            />
          )}
        </div>
      )}
    </>
  );
}

// ── Skill Form (Create / Edit) ─────────────────────────────────────────────

function SkillForm({
  skill,
  onSaved,
  onCancel,
}: {
  skill: SkillEntry | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('settings');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(skill?.name ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [triggerDescription, setTriggerDescription] = useState(
    skill?.trigger_description ?? ''
  );
  const [content, setContent] = useState(skill?.content ?? '');

  const isEdit = skill !== null && skill.id !== null;

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('settings.skills.errors.nameRequired'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isEdit && skill?.id) {
        await skillsApi.update(skill.id, {
          name,
          description,
          trigger_description: triggerDescription,
          content,
        });
      } else {
        await skillsApi.create({
          name,
          description,
          trigger_description: triggerDescription,
          content,
        });
      }
      onSaved();
    } catch {
      setError(t('settings.skills.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.md')) {
        readFile(file);
      }
    },
    []
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        readFile(file);
      }
    },
    []
  );

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;

      // Try to parse frontmatter
      const frontmatterMatch = text.match(
        /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
      );
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const body = frontmatterMatch[2];

        const descMatch = frontmatter.match(/description:\s*(.+)/);
        const triggerMatch = frontmatter.match(/trigger_description:\s*(.+)/);

        if (descMatch && !description) setDescription(descMatch[1].trim());
        if (triggerMatch && !triggerDescription)
          setTriggerDescription(triggerMatch[1].trim());
        setContent(body.trim());
      } else {
        setContent(text);
      }

      // Use filename as name if empty
      if (!name) {
        setName(file.name.replace(/\.md$/, ''));
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onCancel}
          className="p-1 rounded-sm hover:bg-secondary text-low hover:text-normal"
        >
          <ArrowLeftIcon className="size-icon-sm" weight="bold" />
        </button>
        <h3 className="text-base font-medium text-high">
          {isEdit
            ? t('settings.skills.form.editTitle')
            : t('settings.skills.form.createTitle')}
        </h3>
      </div>

      {error && (
        <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error text-sm mb-4">
          {error}
        </div>
      )}

      <SettingsCard
        title={
          isEdit
            ? t('settings.skills.form.editTitle')
            : t('settings.skills.form.createTitle')
        }
      >
        <SettingsField label={t('settings.skills.form.name')}>
          <SettingsInput
            value={name}
            onChange={setName}
            placeholder={t('settings.skills.form.namePlaceholder')}
          />
        </SettingsField>

        <SettingsField label={t('settings.skills.form.description')}>
          <SettingsInput
            value={description}
            onChange={setDescription}
            placeholder={t('settings.skills.form.descriptionPlaceholder')}
          />
        </SettingsField>

        <SettingsField label={t('settings.skills.form.triggerDescription')}>
          <SettingsInput
            value={triggerDescription}
            onChange={setTriggerDescription}
            placeholder={t(
              'settings.skills.form.triggerDescriptionPlaceholder'
            )}
          />
        </SettingsField>

        <SettingsField label={t('settings.skills.form.content')}>
          <SettingsTextarea
            value={content}
            onChange={setContent}
            placeholder={t('settings.skills.form.contentPlaceholder')}
            rows={12}
            monospace
          />
        </SettingsField>

        {/* File drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'border-2 border-dashed border-border rounded-sm p-4',
            'flex items-center justify-center gap-2 cursor-pointer',
            'text-sm text-low hover:border-brand/50 hover:text-normal transition-colors'
          )}
        >
          <UploadSimpleIcon className="size-icon-sm" weight="bold" />
          <span>{t('settings.skills.form.dropZone')}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <PrimaryButton
            value={t('settings.skills.form.save')}
            onClick={handleSave}
            disabled={saving}
            actionIcon={saving ? 'spinner' : undefined}
          />
          <PrimaryButton
            variant="tertiary"
            value={t('settings.skills.form.cancel')}
            onClick={onCancel}
            disabled={saving}
          />
        </div>
      </SettingsCard>
    </>
  );
}

export { SkillsSettingsSection as SkillsSettingsSectionContent };
