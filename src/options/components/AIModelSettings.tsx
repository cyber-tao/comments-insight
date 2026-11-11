import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AI, API, UI_LIMITS } from '@/config/constants';
import {
  DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
  DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE,
  getAnalysisPromptTemplate,
  getDynamicReportPromptTemplate,
} from '@/utils/prompts';
import { Settings, SettingsPatch } from '@/types';
import { ExtensionAPI } from '@/utils/extension-api';
import { ErrorCode, ExtensionError } from '@/utils/error-types';
import { parseFiniteIntegerInput, parseFiniteNumberInput } from '@/utils/number';
import { normalizeAiApiUrl } from '@/utils/url';
import { SearchableModelSelect } from './SearchableModelSelect';

interface AIModelSettingsProps {
  settings: Settings;
  onSettingsChange: (settings: SettingsPatch) => void;
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
  const [showDynamicPlaceholders, setShowDynamicPlaceholders] = useState(false);
  const maxOutputTokens =
    typeof settings.aiModel.maxOutputTokens === 'number' &&
    Number.isFinite(settings.aiModel.maxOutputTokens)
      ? settings.aiModel.maxOutputTokens
      : AI.DEFAULT_MAX_OUTPUT_TOKENS;
  const maxAllowedOutputTokens = Math.max(
    AI.MIN_OUTPUT_TOKENS,
    settings.aiModel.contextWindowSize - AI.INPUT_TOKEN_BUFFER - AI.MIN_AVAILABLE_TOKENS,
  );

  const configRef = useRef(settings.aiModel);
  configRef.current = settings.aiModel;
  const modelRequestRef = useRef(0);
  const modelEditRevisionRef = useRef(0);
  const testRequestRef = useRef(0);
  const endpoint = normalizeAiApiUrl(settings.aiModel.apiUrl) ?? settings.aiModel.apiUrl.trim();

  useEffect(() => {
    modelRequestRef.current += 1;
    testRequestRef.current += 1;
    setAvailableModels([]);
    setLoadingModels(false);
    setTestingModel(false);
    return () => {
      modelRequestRef.current += 1;
      testRequestRef.current += 1;
    };
  }, [endpoint, settings.aiModel.apiKey]);

  const handleModelChange = (model: string) => {
    modelEditRevisionRef.current += 1;
    onSettingsChange({ aiModel: { model } });
  };

  const handleFetchModels = async () => {
    const config = settings.aiModel;

    if (!config.apiUrl) {
      toast.warning(t('options.configureApiFirst'));
      return;
    }

    const requestId = ++modelRequestRef.current;
    const editRevision = modelEditRevisionRef.current;
    const isCurrent = () =>
      requestId === modelRequestRef.current &&
      endpoint ===
        (normalizeAiApiUrl(configRef.current.apiUrl) ?? configRef.current.apiUrl.trim()) &&
      config.apiKey === configRef.current.apiKey;
    setLoadingModels(true);

    try {
      const models = await ExtensionAPI.getAvailableModels(config.apiUrl, config.apiKey);
      if (!isCurrent()) return;

      if (models.length > 0) {
        setAvailableModels(models);
        toast.success(t('options.modelsFound', { count: models.length }));

        if (
          modelEditRevisionRef.current === editRevision &&
          configRef.current.model === config.model &&
          (!models.includes(config.model) || models.length === 1)
        ) {
          onSettingsChange({
            aiModel: { model: models[0] },
          });
        }
      } else {
        setAvailableModels([]);
        toast.info(t('options.noModelsFound'));
      }
    } catch (error) {
      if (!isCurrent()) return;
      setAvailableModels([]);
      toast.error(
        error instanceof ExtensionError && error.code === ErrorCode.AI_ENDPOINT_REDIRECT
          ? t('errors.aiEndpointRedirect')
          : t('options.fetchModelsFailed'),
      );
    } finally {
      if (isCurrent()) setLoadingModels(false);
    }
  };

  const handleTestModel = async () => {
    const config = settings.aiModel;

    if (!config.apiUrl || !config.model) {
      toast.warning(t('options.configureAllFields'));
      return;
    }

    const requestId = ++testRequestRef.current;
    const isCurrent = () =>
      requestId === testRequestRef.current &&
      endpoint ===
        (normalizeAiApiUrl(configRef.current.apiUrl) ?? configRef.current.apiUrl.trim()) &&
      config.apiKey === configRef.current.apiKey &&
      config.model === configRef.current.model;
    setTestingModel(true);

    try {
      const response = await ExtensionAPI.testModel(config);
      if (!isCurrent()) return;

      if (response?.success) {
        toast.success(
          t('options.testSuccess') + (response.response ? `: ${response.response}` : ''),
        );
      } else {
        toast.error(t('options.testFailed') + ': ' + (response?.error || 'Unknown error'));
      }
    } catch (error) {
      if (!isCurrent()) return;
      toast.error(
        error instanceof ExtensionError && error.code === ErrorCode.AI_ENDPOINT_REDIRECT
          ? t('errors.aiEndpointRedirect')
          : t('options.testFailed') +
              ': ' +
              (error instanceof Error ? error.message : 'Unknown error'),
      );
    } finally {
      if (requestId === testRequestRef.current) setTestingModel(false);
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
                aiModel: { apiUrl: e.target.value },
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
              value={settings.aiModel.apiKey}
              onChange={(e) =>
                onSettingsChange({
                  aiModel: { apiKey: e.target.value },
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
            <SearchableModelSelect
              models={availableModels}
              value={settings.aiModel.model}
              onChange={handleModelChange}
            />
          ) : (
            <input
              type="text"
              value={settings.aiModel.model}
              onChange={(e) => handleModelChange(e.target.value)}
              className="w-full theme-input"
              placeholder={t('options.modelPlaceholder')}
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
              onChange={(e) => {
                const contextWindowSize = parseFiniteIntegerInput(e.target.value);
                if (contextWindowSize === null) {
                  return;
                }
                const maxAllowed = Math.max(
                  AI.MIN_OUTPUT_TOKENS,
                  contextWindowSize - AI.INPUT_TOKEN_BUFFER - AI.MIN_AVAILABLE_TOKENS,
                );
                onSettingsChange({
                  aiModel: {
                    contextWindowSize,
                    maxOutputTokens: Math.min(maxOutputTokens, maxAllowed),
                  },
                });
              }}
              className="w-full theme-input"
              min={AI.MIN_CONTEXT_WINDOW}
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
              value={maxOutputTokens}
              onChange={(e) => {
                const parsedMaxOutputTokens = parseFiniteIntegerInput(e.target.value);
                if (parsedMaxOutputTokens === null) {
                  return;
                }
                onSettingsChange({
                  aiModel: {
                    maxOutputTokens: Math.min(parsedMaxOutputTokens, maxAllowedOutputTokens),
                  },
                });
              }}
              className="w-full theme-input"
              min={AI.MIN_OUTPUT_TOKENS}
              max={maxAllowedOutputTokens}
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
              onChange={(e) => {
                const temperature = parseFiniteNumberInput(e.target.value);
                if (temperature === null) {
                  return;
                }
                onSettingsChange({
                  aiModel: {
                    temperature,
                  },
                });
              }}
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
              onChange={(e) => {
                const topP = parseFiniteNumberInput(e.target.value);
                if (topP === null) {
                  return;
                }
                onSettingsChange({
                  aiModel: {
                    topP,
                  },
                });
              }}
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
                  analyzerPromptTemplate: DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
                })
              }
              className="text-xs underline theme-link"
            >
              {t('options.resetTemplate')}
            </button>
          </div>
          <textarea
            value={getAnalysisPromptTemplate(settings.analyzerPromptTemplate, settings.language)}
            onChange={(e) => onSettingsChange({ analyzerPromptTemplate: e.target.value })}
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
                    descKey="options.placeholder_comments_data"
                  />
                  <PlaceholderItem
                    code="{date_time}"
                    t={t}
                    descKey="options.placeholder_date_time"
                  />
                  <PlaceholderItem
                    code="{post_time}"
                    t={t}
                    descKey="options.placeholder_post_time"
                  />
                  <PlaceholderItem
                    code="{post_content}"
                    t={t}
                    descKey="options.placeholder_post_content"
                  />
                  <PlaceholderItem code="{platform}" t={t} descKey="options.placeholder_platform" />
                  <PlaceholderItem code="{url}" t={t} descKey="options.placeholder_url" />
                  <PlaceholderItem code="{title}" t={t} descKey="options.placeholder_title" />
                  <PlaceholderItem
                    code="{total_comments}"
                    t={t}
                    descKey="options.placeholder_total_comments"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-[var(--border-primary)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {t('options.generateDynamicReport', '动态分析网页生成')}
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                {t(
                  'options.generateDynamicReportDesc',
                  '分析完成后，通过独立的第二次 LLM API 调用生成响应式可视化 HTML 看板；脚本和外部资源会在沙箱渲染前被移除。',
                )}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.generateDynamicReport !== false}
                onChange={(e) =>
                  onSettingsChange({
                    generateDynamicReport: e.target.checked,
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.generateDynamicReport !== false && (
            <div className="mt-4">
              <div className="flex justify-between items-center mb-2">
                <label
                  className="block text-sm font-medium"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {t('options.dynamicReportPromptTemplate', '动态分析网页提示词模板')}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    onSettingsChange({
                      dynamicReportPromptTemplate: DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE,
                    })
                  }
                  className="text-xs underline theme-link"
                >
                  {t('options.resetTemplate')}
                </button>
              </div>
              <textarea
                value={getDynamicReportPromptTemplate(
                  settings.dynamicReportPromptTemplate,
                  settings.language,
                )}
                onChange={(e) =>
                  onSettingsChange({
                    dynamicReportPromptTemplate: e.target.value,
                  })
                }
                className="w-full theme-input font-mono text-sm"
                rows={UI_LIMITS.PROMPT_TEXTAREA_ROWS}
              />

              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowDynamicPlaceholders(!showDynamicPlaceholders)}
                  className="text-sm theme-link flex items-center gap-1"
                >
                  <span>{showDynamicPlaceholders ? '▼' : '▶'}</span>
                  <span>{t('options.availablePlaceholders')}</span>
                </button>

                {showDynamicPlaceholders && (
                  <div
                    className="mt-3 p-4 rounded-lg"
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-primary)',
                    }}
                  >
                    <div className="space-y-3">
                      <PlaceholderItem
                        code="{analysis_markdown}"
                        required
                        t={t}
                        descKey="options.placeholder_analysis_markdown"
                      />
                      <PlaceholderItem
                        code="{date_time}"
                        t={t}
                        descKey="options.placeholder_date_time"
                      />
                      <PlaceholderItem
                        code="{post_time}"
                        t={t}
                        descKey="options.placeholder_post_time"
                      />
                      <PlaceholderItem
                        code="{post_content}"
                        t={t}
                        descKey="options.placeholder_post_content"
                      />
                      <PlaceholderItem
                        code="{platform}"
                        t={t}
                        descKey="options.placeholder_platform"
                      />
                      <PlaceholderItem code="{url}" t={t} descKey="options.placeholder_url" />
                      <PlaceholderItem code="{title}" t={t} descKey="options.placeholder_title" />
                      <PlaceholderItem
                        code="{total_comments}"
                        t={t}
                        descKey="options.placeholder_total_comments"
                      />
                      <PlaceholderItem
                        code="{language_name}"
                        t={t}
                        descKey="options.placeholder_language_name"
                      />
                      <PlaceholderItem
                        code="{top_comments_data}"
                        t={t}
                        descKey="options.placeholder_top_comments_data"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
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
      {t(descKey)}
    </p>
  </div>
);
