import * as React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { API, MESSAGES, LIMITS, UI_LIMITS } from '@/config/constants';
import { DEFAULT_ANALYSIS_PROMPT_TEMPLATE } from '@/utils/prompts';
import { Settings } from '@/types';

interface AIModelSettingsProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
  };
}

export const AIModelSettings: React.FC<AIModelSettingsProps> = ({
  settings,
  onSettingsChange,
  toast,
}) => {
  const { t } = useTranslation();
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingModel, setTestingModel] = useState(false);
  const [showPlaceholders, setShowPlaceholders] = useState(false);

  const maskApiKey = (key: string): string => {
    if (!key || key.length < LIMITS.API_KEY_MASK_MIN_LENGTH) return key;
    const start = key.substring(0, LIMITS.API_KEY_MASK_PREFIX);
    const end = key.substring(key.length - LIMITS.API_KEY_MASK_SUFFIX);
    const starCount = Math.min(
      LIMITS.API_KEY_MASK_MAX_STARS,
      key.length - LIMITS.API_KEY_MASK_PREFIX - LIMITS.API_KEY_MASK_SUFFIX,
    );
    return `${start}${'*'.repeat(starCount)}${end}`;
  };

  const handleFetchModels = async () => {
    const config = settings.aiModel;

    if (!config.apiUrl) {
      toast.warning(t('options.configureApiFirst'));
      return;
    }

    setLoadingModels(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.GET_AVAILABLE_MODELS,
        payload: {
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
        },
      });

      if (response?.models && response.models.length > 0) {
        setAvailableModels(response.models);
        toast.success(t('options.modelsFound', { count: response.models.length }));
      } else {
        toast.info(t('options.noModelsFound'));
      }
    } catch (_error) {
      toast.error(t('options.fetchModelsFailed'));
    } finally {
      setLoadingModels(false);
    }
  };

  const handleTestModel = async () => {
    const config = settings.aiModel;

    if (!config.apiUrl || !config.model) {
      toast.warning(t('options.configureAllFields'));
      return;
    }

    setTestingModel(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.TEST_MODEL,
        payload: { config },
      });

      if (response?.success) {
        toast.success(
          t('options.testSuccess') + (response.response ? `: ${response.response}` : ''),
        );
      } else {
        toast.error(t('options.testFailed') + ': ' + (response?.error || 'Unknown error'));
      }
    } catch (error) {
      toast.error(
        t('options.testFailed') + ': ' + (error instanceof Error ? error.message : 'Unknown error'),
      );
    } finally {
      setTestingModel(false);
    }
  };

  return (
    <>
      <section className="mb-8 theme-card p-6">
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          {t('options.aiModel')}
        </h2>

        <div className="mb-4">
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('options.apiUrl')}
          </label>
          <input
            type="text"
            value={settings.aiModel.apiUrl}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                aiModel: { ...settings.aiModel, apiUrl: e.target.value },
              })
            }
            className="w-full theme-input"
            placeholder={API.EXAMPLE_COMPLETIONS_URL}
          />
        </div>

        <div className="mb-4">
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('options.apiKey')}
          </label>
          <div className="flex gap-2">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={showApiKey ? settings.aiModel.apiKey : maskApiKey(settings.aiModel.apiKey)}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  aiModel: { ...settings.aiModel, apiKey: e.target.value },
                })
              }
              className="flex-1 theme-input"
              placeholder={t('options.apiKeyPlaceholder')}
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="px-3 py-2 rounded-lg theme-button-secondary"
            >
              {showApiKey ? '🙈' : '👁️'}
            </button>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('options.apiKeySecurityNote')}
          </p>
        </div>

        <div className="mb-4">
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('options.model')}
          </label>
          {availableModels.length > 0 ? (
            <select
              value={settings.aiModel.model}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  aiModel: { ...settings.aiModel, model: e.target.value },
                })
              }
              className="w-full theme-input"
            >
              {availableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={settings.aiModel.model}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  aiModel: { ...settings.aiModel, model: e.target.value },
                })
              }
              className="w-full theme-input"
              placeholder={t('options.defaultModelName')}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('options.contextWindowSize')}
            </label>
            <input
              type="number"
              value={settings.aiModel.contextWindowSize}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  aiModel: {
                    ...settings.aiModel,
                    contextWindowSize: parseInt(e.target.value),
                  },
                })
              }
              className="w-full theme-input"
              min="1"
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('options.maxOutputTokens')}
            </label>
            <input
              type="number"
              value={settings.aiModel.maxOutputTokens || 4096}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  aiModel: {
                    ...settings.aiModel,
                    maxOutputTokens: parseInt(e.target.value),
                  },
                })
              }
              className="w-full theme-input"
              min="1"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('options.temperature')}
            </label>
            <input
              type="number"
              step="0.1"
              value={settings.aiModel.temperature}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  aiModel: {
                    ...settings.aiModel,
                    temperature: parseFloat(e.target.value),
                  },
                })
              }
              className="w-full theme-input"
              min={UI_LIMITS.TEMPERATURE_MIN}
              max={UI_LIMITS.TEMPERATURE_MAX}
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('options.topP')}
            </label>
            <input
              type="number"
              step="0.1"
              value={settings.aiModel.topP}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  aiModel: {
                    ...settings.aiModel,
                    topP: parseFloat(e.target.value),
                  },
                })
              }
              className="w-full theme-input"
              min={UI_LIMITS.TOP_P_MIN}
              max={UI_LIMITS.TOP_P_MAX}
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={handleFetchModels}
            disabled={loadingModels || testingModel}
            className="px-4 py-2 rounded-lg text-white font-medium transition-all disabled:opacity-50"
            style={{ backgroundColor: '#8b5cf6' }}
          >
            {loadingModels ? t('common.loading') : '🔄 ' + t('options.fetchModels')}
          </button>
          <button
            type="button"
            onClick={handleTestModel}
            disabled={testingModel || loadingModels}
            className="px-4 py-2 rounded-lg text-white font-medium transition-all disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent-secondary)' }}
          >
            {testingModel ? t('options.testing') : '🧪 ' + t('options.testModel')}
          </button>
        </div>
      </section>

      <section className="mb-8 theme-card p-6">
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {t('options.promptTemplate')}
            </label>
            <button
              type="button"
              onClick={() =>
                onSettingsChange({
                  ...settings,
                  analyzerPromptTemplate: DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
                })
              }
              className="text-xs underline theme-link"
            >
              {t('options.resetTemplate')}
            </button>
          </div>
          <textarea
            value={settings.analyzerPromptTemplate}
            onChange={(e) =>
              onSettingsChange({ ...settings, analyzerPromptTemplate: e.target.value })
            }
            className="w-full theme-input font-mono text-sm"
            rows={UI_LIMITS.PROMPT_TEXTAREA_ROWS}
          />

          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowPlaceholders(!showPlaceholders)}
              className="text-sm theme-link flex items-center gap-1"
            >
              <span>{showPlaceholders ? '▼' : '▶'}</span>
              <span>{t('options.availablePlaceholders')}</span>
            </button>

            {showPlaceholders && (
              <div
                className="mt-3 p-4 rounded-lg"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                <div className="space-y-3">
                  <PlaceholderItem
                    code="{comments_data}"
                    required
                    t={t}
                    descKey="placeholder_comments_data"
                  />
                  <PlaceholderItem code="{date_time}" t={t} descKey="placeholder_date_time" />
                  <PlaceholderItem code="{post_time}" t={t} descKey="placeholder_post_time" />
                  <PlaceholderItem code="{post_content}" t={t} descKey="placeholder_post_content" />
                  <PlaceholderItem code="{platform}" t={t} descKey="placeholder_platform" />
                  <PlaceholderItem code="{url}" t={t} descKey="placeholder_url" />
                  <PlaceholderItem code="{title}" t={t} descKey="placeholder_title" />
                  <PlaceholderItem
                    code="{total_comments}"
                    t={t}
                    descKey="placeholder_total_comments"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
};

interface PlaceholderItemProps {
  code: string;
  required?: boolean;
  t: (key: string) => string;
  descKey: string;
}

const PlaceholderItem: React.FC<PlaceholderItemProps> = ({ code, required, t, descKey }) => (
  <div>
    <code
      className="text-sm font-mono px-2 py-1 rounded"
      style={{
        backgroundColor: required ? 'rgba(59, 130, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)',
        color: required ? 'var(--accent-primary)' : 'var(--accent-secondary)',
      }}
    >
      {code}
    </code>
    {required && (
      <span className="text-xs ml-2" style={{ color: 'var(--accent-danger)' }}>
        *{t('options.required')}
      </span>
    )}
    <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
      {t(`options.${descKey}`)}
    </p>
  </div>
);
