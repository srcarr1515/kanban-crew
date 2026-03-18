import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cloneDeep, isEqual } from 'lodash';
import {
  PlusIcon,
  TrashIcon,
  EyeIcon,
  EyeSlashIcon,
  SpinnerIcon,
} from '@phosphor-icons/react';
import type { AiProviderConfig, AiProviderEntry } from 'shared/types';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import { IconButton } from '@vibe/ui/components/IconButton';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@vibe/ui/components/Dropdown';
import {
  SettingsCard,
  SettingsField,
  SettingsInput,
  SettingsSaveBar,
  SettingsSelect,
} from './SettingsComponents';
import { useSettingsDirty } from './SettingsDirtyContext';

const PRESET_PROVIDERS: Omit<AiProviderEntry, 'api_key' | 'base_url'>[] = [
  { id: 'anthropic', name: 'Anthropic', enabled: true },
  { id: 'openai', name: 'OpenAI', enabled: true },
  { id: 'google', name: 'Google AI', enabled: true },
  { id: 'openrouter', name: 'OpenRouter', enabled: true },
];

function getDefaultAiProviderConfig(): AiProviderConfig {
  return {
    default_provider: null,
    default_model: null,
    providers: [],
  };
}

export function AiProvidersSettingsSection() {
  const { t } = useTranslation(['settings', 'common']);
  const { setDirty: setContextDirty } = useSettingsDirty();
  const { config, loading, updateAndSaveConfig } = useUserSystem();

  const [draft, setDraft] = useState<AiProviderConfig>(() =>
    config?.ai_providers
      ? cloneDeep(config.ai_providers)
      : getDefaultAiProviderConfig()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const serverState = config?.ai_providers ?? getDefaultAiProviderConfig();

  useEffect(() => {
    if (!config) return;
    const serverAi = config.ai_providers ?? getDefaultAiProviderConfig();
    if (!hasUnsavedChanges) {
      setDraft(cloneDeep(serverAi));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const hasUnsavedChanges = useMemo(
    () => !isEqual(draft, serverState),
    [draft, serverState]
  );

  useEffect(() => {
    setContextDirty('ai-providers', hasUnsavedChanges);
    return () => setContextDirty('ai-providers', false);
  }, [hasUnsavedChanges, setContextDirty]);

  const updateDraft = useCallback(
    (updater: (prev: AiProviderConfig) => AiProviderConfig) => {
      setDraft((prev) => updater(cloneDeep(prev)));
    },
    []
  );

  const handleAddProvider = useCallback(
    (presetId?: string) => {
      const existingIds = new Set(draft.providers.map((p) => p.id));
      let newProvider: AiProviderEntry;
      if (presetId) {
        const preset = PRESET_PROVIDERS.find((p) => p.id === presetId);
        newProvider = preset
          ? { ...preset, api_key: null, base_url: null }
          : { id: presetId, name: presetId, api_key: null, base_url: null, enabled: true };
      } else {
        newProvider = {
          id: `custom-${Date.now()}`,
          name: 'Custom Provider',
          api_key: null,
          base_url: null,
          enabled: true,
        };
      }
      if (existingIds.has(newProvider.id)) return;
      updateDraft((prev) => ({
        ...prev,
        providers: [...prev.providers, newProvider],
      }));
    },
    [draft.providers, updateDraft]
  );

  const availablePresets = useMemo(() => {
    const existingIds = new Set(draft.providers.map((p) => p.id));
    return PRESET_PROVIDERS.filter((p) => !existingIds.has(p.id));
  }, [draft.providers]);

  const handleRemoveProvider = useCallback(
    (id: string) => {
      updateDraft((prev) => {
        const providers = prev.providers.filter((p) => p.id !== id);
        return {
          ...prev,
          providers,
          default_provider:
            prev.default_provider === id ? null : prev.default_provider,
        };
      });
      setVisibleKeys((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [updateDraft]
  );

  const handleUpdateProvider = useCallback(
    (id: string, patch: Partial<AiProviderEntry>) => {
      updateDraft((prev) => ({
        ...prev,
        providers: prev.providers.map((p) =>
          p.id === id ? { ...p, ...patch } : p
        ),
      }));
    },
    [updateDraft]
  );

  const toggleKeyVisibility = useCallback((providerId: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await updateAndSaveConfig({ ai_providers: draft });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(t('settings.aiProviders.save.error'));
      console.error('Error saving AI provider config:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft(cloneDeep(serverState));
    setVisibleKeys(new Set());
  };

  // Provider options for the default provider dropdown
  const providerOptions = useMemo(
    () =>
      draft.providers
        .filter((p) => p.enabled)
        .map((p) => ({ value: p.id, label: p.name })),
    [draft.providers]
  );

  // Provider preset options for the type selector
  const providerTypeOptions = useMemo(() => {
    const existingIds = new Set(draft.providers.map((p) => p.id));
    return [
      ...PRESET_PROVIDERS.filter((p) => !existingIds.has(p.id)).map((p) => ({
        value: p.id,
        label: p.name,
      })),
      { value: '__custom__', label: 'Custom' },
    ];
  }, [draft.providers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2">
        <SpinnerIcon
          className="size-icon-lg animate-spin text-brand"
          weight="bold"
        />
        <span className="text-normal">{t('settings.aiProviders.loading')}</span>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="bg-error/10 border border-error/50 rounded-sm p-4 text-error">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-success/10 border border-success/50 rounded-sm p-4 text-success font-medium">
          {t('settings.aiProviders.save.success')}
        </div>
      )}

      {/* Default Provider & Model */}
      <SettingsCard
        title={t('settings.aiProviders.defaults.title')}
        description={t('settings.aiProviders.defaults.description')}
      >
        <SettingsField
          label={t('settings.aiProviders.defaults.provider.label')}
          description={t('settings.aiProviders.defaults.provider.helper')}
        >
          <SettingsSelect
            value={draft.default_provider ?? undefined}
            options={[
              {
                value: '__cli__' as string,
                label: t('settings.aiProviders.defaults.provider.cliAgent'),
              },
              ...providerOptions,
            ]}
            onChange={(value) =>
              updateDraft((prev) => ({
                ...prev,
                default_provider: value === '__cli__' ? null : value,
              }))
            }
            placeholder={t(
              'settings.aiProviders.defaults.provider.placeholder'
            )}
          />
        </SettingsField>

        {draft.default_provider && (
          <SettingsField
            label={t('settings.aiProviders.defaults.model.label')}
            description={t('settings.aiProviders.defaults.model.helper')}
          >
            <SettingsInput
              value={draft.default_model ?? ''}
              onChange={(value) =>
                updateDraft((prev) => ({
                  ...prev,
                  default_model: value || null,
                }))
              }
              placeholder={t('settings.aiProviders.defaults.model.placeholder')}
            />
          </SettingsField>
        )}
      </SettingsCard>

      {/* Configured Providers */}
      <SettingsCard
        title={t('settings.aiProviders.providers.title')}
        description={t('settings.aiProviders.providers.description')}
        headerAction={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1.5 text-sm text-brand hover:text-brand/80 transition-colors disabled:opacity-50"
                disabled={availablePresets.length === 0}
              >
                <PlusIcon className="size-icon-sm" weight="bold" />
                {t('settings.aiProviders.providers.add')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {availablePresets.map((preset) => (
                <DropdownMenuItem
                  key={preset.id}
                  onClick={() => handleAddProvider(preset.id)}
                >
                  {preset.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => handleAddProvider()}>
                Custom Provider
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {draft.providers.length === 0 ? (
          <p className="text-sm text-low py-2">
            {t('settings.aiProviders.providers.empty')}
          </p>
        ) : (
          <div className="space-y-4">
            {draft.providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                showApiKey={visibleKeys.has(provider.id)}
                onToggleKeyVisibility={() => toggleKeyVisibility(provider.id)}
                onUpdate={(patch) => handleUpdateProvider(provider.id, patch)}
                onRemove={() => handleRemoveProvider(provider.id)}
                providerTypeOptions={providerTypeOptions}
              />
            ))}
          </div>
        )}
      </SettingsCard>

      <SettingsSaveBar
        show={hasUnsavedChanges}
        saving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </>
  );
}

function ProviderCard({
  provider,
  showApiKey,
  onToggleKeyVisibility,
  onUpdate,
  onRemove,
  providerTypeOptions: _providerTypeOptions,
}: {
  provider: AiProviderEntry;
  showApiKey: boolean;
  onToggleKeyVisibility: () => void;
  onUpdate: (patch: Partial<AiProviderEntry>) => void;
  onRemove: () => void;
  providerTypeOptions: { value: string; label: string }[];
}) {
  const { t } = useTranslation(['settings']);
  const isPreset = PRESET_PROVIDERS.some((p) => p.id === provider.id);

  return (
    <div className="border border-border rounded-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-high">{provider.name}</span>
          <span className="text-xs text-low bg-secondary px-1.5 py-0.5 rounded">
            {provider.id}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-low cursor-pointer">
            <input
              type="checkbox"
              checked={provider.enabled}
              onChange={(e) => onUpdate({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-border bg-secondary text-brand focus:ring-brand focus:ring-offset-0"
            />
            {t('settings.aiProviders.providers.enabled')}
          </label>
          <IconButton
            icon={TrashIcon}
            onClick={onRemove}
            aria-label={t('settings.aiProviders.providers.remove')}
            title={t('settings.aiProviders.providers.remove')}
          />
        </div>
      </div>

      {!isPreset && (
        <SettingsField label={t('settings.aiProviders.providers.name.label')}>
          <SettingsInput
            value={provider.name}
            onChange={(value) => onUpdate({ name: value })}
            placeholder={t('settings.aiProviders.providers.name.placeholder')}
          />
        </SettingsField>
      )}

      <SettingsField
        label={t('settings.aiProviders.providers.apiKey.label')}
        description={t('settings.aiProviders.providers.apiKey.helper')}
      >
        <div className="flex gap-2">
          <div className="flex-1">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={provider.api_key ?? ''}
              onChange={(e) =>
                onUpdate({
                  api_key: e.target.value || null,
                })
              }
              placeholder={t(
                'settings.aiProviders.providers.apiKey.placeholder'
              )}
              className="w-full bg-secondary border border-border rounded-sm px-base py-half text-sm text-high placeholder:text-low placeholder:opacity-80 focus:outline-none focus:ring-1 focus:ring-brand font-mono"
              autoComplete="off"
            />
          </div>
          <IconButton
            icon={showApiKey ? EyeSlashIcon : EyeIcon}
            onClick={onToggleKeyVisibility}
            aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            title={showApiKey ? 'Hide API key' : 'Show API key'}
          />
        </div>
      </SettingsField>

      <SettingsField
        label={t('settings.aiProviders.providers.baseUrl.label')}
        description={t('settings.aiProviders.providers.baseUrl.helper')}
      >
        <SettingsInput
          value={provider.base_url ?? ''}
          onChange={(value) => onUpdate({ base_url: value || null })}
          placeholder={t('settings.aiProviders.providers.baseUrl.placeholder')}
        />
      </SettingsField>
    </div>
  );
}

export { AiProvidersSettingsSection as AiProvidersSettingsSectionContent };
