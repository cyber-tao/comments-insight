import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AI, API, UI_LIMITS } from '@/config/constants';
import { AI_PROVIDER_PRESETS } from '@/config/ai-providers';
import {
  DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
  DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE,
  getAnalysisPromptTemplate,
  getDynamicReportPromptTemplate,
} from '@/utils/prompts';
import { AIProtocol, Settings, SettingsPatch } from '@/types';
import { ExtensionAPI } from '@/utils/extension-api';
import { ErrorCode, ExtensionError } from '@/utils/error-types';
import { parseFiniteIntegerInput } from '@/utils/number';
import { normalizeAiApiUrl } from '@/utils/url';
import { EyeIcon, EyeOffIcon, RefreshIcon, SparklesIcon } from '@/components/Icons';
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
  const [customPresetEndpoint, setCustomPresetEndpoint] = useState<string | null>(null);
  const maxOutputTokens =
    typeof settings.aiModel.maxOutputTokens === 'number' &&
    Number.isFinite(settings.aiModel.maxOutputTokens)
      ? settings.aiModel.maxOutputTokens
      : AI.DEFAULT_MAX_OUTPUT_TOKENS;
  const maxAllowedOutputTokens = Math.max(
    AI.MIN_OUTPUT_TOKENS,
    settings.aiModel.contextWindowSize - AI.INPUT_TOKEN_BUFFER - AI.MIN_AVAILABLE_TOKENS,
  );
  const tokensToK = (tokens: number): number => Math.max(1, Math.round(tokens / AI.TOKENS_PER_K));
  const minContextWindowK = tokensToK(AI.MIN_CONTEXT_WINDOW);
  const currentContextWindowK = tokensToK(
    settings.aiModel.contextWindowSize || AI.DEFAULT_CONTEXT_WINDOW,
  );
  const currentMaxOutputK = tokensToK(maxOutputTokens);
  const maxAllowedOutputK = Math.max(1, Math.floor(maxAllowedOutputTokens / AI.TOKENS_PER_K));

  const updateContextWindowK = (valK: number) => {
    const contextWindowSize = Math.max(1, valK) * AI.TOKENS_PER_K;
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
  };

  const updateMaxOutputK = (valK: number) => {
    const requestedTokens = Math.max(AI.MIN_OUTPUT_TOKENS, valK * AI.TOKENS_PER_K);
    onSettingsChange({
      aiModel: {
        maxOutputTokens: Math.min(requestedTokens, maxAllowedOutputTokens),
      },
    });
  };

  const configRef = useRef(settings.aiModel);
  configRef.current = settings.aiModel;
  const modelRequestRef = useRef(0);
  const testRequestRef = useRef(0);
  const endpoint = normalizeAiApiUrl(settings.aiModel.apiUrl) ?? settings.aiModel.apiUrl.trim();
  const selectedPreset =
    customPresetEndpoint === endpoint
      ? 'custom'
      : (AI_PROVIDER_PRESETS.find((preset) => normalizeAiApiUrl(preset.apiUrl) === endpoint)?.id ??
        'custom');

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
  }, [endpoint, settings.aiModel.apiKey, settings.aiModel.protocol]);

  const handlePresetChange = (id: string) => {
    if (id === 'custom') {
      setCustomPresetEndpoint(endpoint);
      return;
    }
    const preset = AI_PROVIDER_PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    setCustomPresetEndpoint(null);
    onSettingsChange({
      aiModel: {
        apiUrl: preset.apiUrl,
        protocol: preset.protocol,
      },
    });
  };

  const handleModelChange = (model: string) => {
    testRequestRef.current += 1;
    setTestingModel(false);
    onSettingsChange({ aiModel: { model } });
  };

  const handleFetchModels = async () => {
    const config = settings.aiModel;

    if (!config.apiUrl) {
      toast.warning(t('options.configureApiFirst'));
      return;
    }

    const requestId = ++modelRequestRef.current;
    const isCurrent = () =>
      requestId === modelRequestRef.current &&
      endpoint ===
        (normalizeAiApiUrl(configRef.current.apiUrl) ?? configRef.current.apiUrl.trim()) &&
      config.apiKey === configRef.current.apiKey &&
      config.protocol === configRef.current.protocol;
    setLoadingModels(true);

    try {
      const models = await ExtensionAPI.getAvailableModels(
        config.apiUrl,
        config.apiKey,
        config.protocol,
      );
      if (!isCurrent()) return;

      if (models.length > 0) {
        setAvailableModels(models);
        toast.success(t('options.modelsFound', { count: models.length }));
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
          : t('options.fetchModelsFailed') +
              (error instanceof Error && error.message ? `: ${error.message}` : ''),
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
      config.protocol === configRef.current.protocol &&
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
        <h2
          className="text-lg font-bold mb-4 font-serif-editorial"
          style={{ color: 'var(--text-primary)' }}
        >
          {t('options.aiModel')}
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label
              htmlFor="ai-provider-preset"
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('options.providerPreset')}
            </label>
            <select
              id="ai-provider-preset"
              value={selectedPreset}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="w-full theme-input text-sm"
            >
              <option value="custom">{t('options.customProvider')}</option>
              {AI_PROVIDER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="ai-protocol"
              className="block text-sm font-medium mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('options.apiProtocol')}
            </label>
            <select
              id="ai-protocol"
              value={settings.aiModel.protocol}
              onChange={(e) =>
                onSettingsChange({ aiModel: { protocol: e.target.value as AIProtocol } })
              }
              className="w-full theme-input text-sm"
            >
              <option value="openai-chat-completions">OpenAI Chat Completions</option>
              <option value="openai-responses">OpenAI Responses</option>
              <option value="anthropic-messages">Anthropic Messages</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <label
            htmlFor="ai-api-url"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('options.apiUrl')}
          </label>
          <input
            id="ai-api-url"
            type="text"
            value={settings.aiModel.apiUrl}
            onChange={(e) =>
              onSettingsChange({
                aiModel: { apiUrl: e.target.value },
              })
            }
            className="w-full theme-input font-mono-code text-sm"
            placeholder={API.EXAMPLE_COMPLETIONS_URL}
          />
        </div>

        <div className="mb-4">
          <label
            htmlFor="ai-api-key"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('options.apiKey')}
          </label>
          <div className="flex gap-2">
            <input
              id="ai-api-key"
              type={showApiKey ? 'text' : 'password'}
              value={settings.aiModel.apiKey}
              onChange={(e) =>
                onSettingsChange({
                  aiModel: { apiKey: e.target.value },
                })
              }
              className="flex-1 theme-input font-mono-code text-sm"
              placeholder={t('options.apiKeyPlaceholder')}
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="px-3 py-2 rounded-lg theme-button-secondary inline-flex items-center justify-center"
              aria-label={showApiKey ? 'Hide API Key' : 'Show API Key'}
              title={showApiKey ? 'Hide API Key' : 'Show API Key'}
            >
              {showApiKey ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('options.apiKeySecurityNote')}
          </p>
        </div>

        <div className="mb-4">
          <label
            htmlFor="ai-model"
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('options.model')}
          </label>
          {availableModels.length > 0 ? (
            <SearchableModelSelect
              id="ai-model"
              models={availableModels}
              value={settings.aiModel.model}
              onChange={handleModelChange}
            />
          ) : (
            <input
              id="ai-model"
              type="text"
              value={settings.aiModel.model}
              onChange={(e) => handleModelChange(e.target.value)}
              className="w-full theme-input font-mono-code text-sm"
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
              value={currentContextWindowK}
              onChange={(e) => {
                const parsedK = parseFiniteIntegerInput(e.target.value);
                if (parsedK === null) {
                  return;
                }
                updateContextWindowK(parsedK);
              }}
              className="w-full theme-input tabular-nums"
              min={minContextWindowK}
              step={1}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {AI.CONTEXT_WINDOW_PRESETS_K.map((presetK) => {
                const isActive = currentContextWindowK === presetK;
                return (
                  <button
                    key={presetK}
                    type="button"
                    onClick={() => updateContextWindowK(presetK)}
                    className={`px-2 py-0.5 text-xs font-medium rounded-md border transition-colors ${
                      isActive
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700'
                        : 'bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {presetK}K
                  </button>
                );
              })}
            </div>
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
              value={currentMaxOutputK}
              onChange={(e) => {
                const parsedK = parseFiniteIntegerInput(e.target.value);
                if (parsedK === null) {
                  return;
                }
                updateMaxOutputK(parsedK);
              }}
              className="w-full theme-input tabular-nums"
              min={AI.MIN_OUTPUT_TOKENS}
              max={maxAllowedOutputK}
              step={1}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {AI.MAX_OUTPUT_TOKENS_PRESETS_K.map((presetK) => {
                const isActive = currentMaxOutputK === presetK;
                const isDisabled = presetK * AI.TOKENS_PER_K > maxAllowedOutputTokens;
                return (
                  <button
                    key={presetK}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => updateMaxOutputK(presetK)}
                    className={`px-2 py-0.5 text-xs font-medium rounded-md border transition-colors ${
                      isActive
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border-teal-300 dark:border-teal-700'
                        : 'bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {presetK}K
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-2.5">
          <button
            id="ai-fetch-models"
            type="button"
            onClick={handleFetchModels}
            disabled={loadingModels || testingModel}
            className="theme-button-secondary px-4 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-50"
          >
            {loadingModels ? (
              t('common.loading')
            ) : (
              <>
                <RefreshIcon size={15} />
                <span>{t('options.fetchModels')}</span>
              </>
            )}
          </button>
          <button
            id="ai-test-model"
            type="button"
            onClick={handleTestModel}
            disabled={testingModel || loadingModels}
            className="theme-button-accent px-4 py-2 text-sm inline-flex items-center gap-2 disabled:opacity-50"
          >
            {testingModel ? (
              t('options.testing')
            ) : (
              <>
                <SparklesIcon size={15} />
                <span>{t('options.testModel')}</span>
              </>
            )}
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
            className="w-full theme-input font-mono-code text-xs leading-relaxed"
            rows={UI_LIMITS.PROMPT_TEXTAREA_ROWS}
          />

          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowPlaceholders(!showPlaceholders)}
              className="text-xs font-medium theme-link flex items-center gap-1"
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
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {t('options.generateDynamicReport', '动态分析网页生成')}
              </h3>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {t(
                  'options.generateDynamicReportDesc',
                  '分析完成后，通过独立的第二次 LLM API 调用生成响应式可视化 HTML 看板；脚本和外部资源会在沙箱渲染前被移除。',
                )}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
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
              <div className="w-11 h-6 bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent-primary)] peer-checked:border-[var(--accent-primary)]"></div>
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
                className="w-full theme-input font-mono-code text-xs leading-relaxed"
                rows={UI_LIMITS.PROMPT_TEXTAREA_ROWS}
              />

              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowDynamicPlaceholders(!showDynamicPlaceholders)}
                  className="text-xs font-medium theme-link flex items-center gap-1"
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
      className="text-xs font-mono-code px-2 py-0.5 rounded"
      style={{
        backgroundColor: required ? 'var(--accent-primary-soft)' : 'var(--accent-secondary-soft)',
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
    <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
      {t(descKey)}
    </p>
  </div>
);
