import * as React from 'react';
import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { API, MESSAGES, TIMING } from '@/config/constants';
import { Settings } from '../types';
import i18n from '../utils/i18n';
import { useToast } from '../hooks/useToast';
import { ScraperConfigList } from '../components/ScraperConfigList';

const Options: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'general' | 'scrapers'>('general');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const isSavingRef = useRef(false);
  const [testingModel, setTestingModel] = useState(false);
  const isUserChangeRef = useRef(false); // Track if change is from user interaction
  const [showPlaceholders, setShowPlaceholders] = useState(false);

  useEffect(() => {
    // Load settings only once on mount
    const loadSettings = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS });
        Logger.debug('[Options] Settings response', { response });

        if (chrome.runtime.lastError) {
          Logger.error('[Options] Runtime error', { error: chrome.runtime.lastError });
          toast.error('Failed to load settings: ' + chrome.runtime.lastError.message);
          return;
        }

        if (response?.settings) {
          setSettings(response.settings);
          // Set i18n language from settings
          if (response.settings.language) {
            Logger.debug('[Options] Setting language to', { language: response.settings.language });
            i18n.changeLanguage(response.settings.language);
          }
          // Mark initial load as complete after a short delay to ensure language is set
          setTimeout(() => setIsInitialLoad(false), 100);
        } else {
          Logger.error('[Options] No settings in response', { response });
          toast.error('Failed to load settings: Invalid response');
        }
      } catch (error) {
        Logger.error('[Options] Failed to load settings', { error });
        toast.error(
          'Failed to load settings: ' + (error instanceof Error ? error.message : 'Unknown error'),
        );
      }
    };

    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只在组件挂载时加载一次

  // Auto-save settings when they change (but not on initial load)
  useEffect(() => {
    if (!settings || isInitialLoad || isSavingRef.current) return;

    const saveSettings = async () => {
      isSavingRef.current = true;
      setSaving(true);

      try {
        await chrome.runtime.sendMessage({
          type: MESSAGES.SAVE_SETTINGS,
          payload: { settings },
        });

        // Only show success message if it's a user-initiated change
        if (isUserChangeRef.current) {
          toast.success(t('options.savedSuccess'));
          isUserChangeRef.current = false;
        }
      } catch (error) {
        toast.error(t('options.savedError'));
      } finally {
        setSaving(false);
        isSavingRef.current = false;
      }
    };

    // Debounce auto-save by 500ms
    const timeoutId = setTimeout(saveSettings, TIMING.DEBOUNCE_SAVE_MS);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, isInitialLoad]); // Exclude toast/t to avoid infinite loops

  const handleExport = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.EXPORT_DATA,
        payload: { type: 'settings' },
      });

      if (response?.data) {
        const blob = new Blob([response.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comments-insight-settings-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(t('options.exportSettings') + ' ' + t('common.save'));
      }
    } catch (error) {
      toast.error('Failed to export settings');
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target?.result as string;
        const imported = JSON.parse(data);
        setSettings(imported);
        toast.success(t('options.importedSuccess'));
      } catch (error) {
        toast.error('Failed to import settings');
      }
    };
    reader.readAsText(file);
  };

  const handleFetchModels = async () => {
    if (!settings) return;

    const config = settings.aiModel;

    if (!config.apiUrl || !config.apiKey) {
      toast.warning('Please configure API URL and API Key first');
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
        toast.success(`Found ${response.models.length} models`);
      } else {
        toast.info('No models found or API does not support model listing');
      }
    } catch (error) {
      toast.error('Failed to fetch models');
    } finally {
      setLoadingModels(false);
    }
  };

  const handleTestModel = async () => {
    if (!settings) return;

    const config = settings.aiModel;

    if (!config.apiUrl || !config.apiKey || !config.model) {
      toast.warning('Please configure all required fields');
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

  const handleSettingsChange = (newSettings: Settings) => {
    isUserChangeRef.current = true;
    setSettings(newSettings);
  };

  const maskApiKey = (key: string): string => {
    if (!key || key.length < 8) return key;
    const start = key.substring(0, 4);
    const end = key.substring(key.length - 4);
    return `${start}${'*'.repeat(Math.min(20, key.length - 8))}${end}`;
  };

  if (!settings) {
    return <div className="container mx-auto p-8">{t('common.loading')}</div>;
  }

  return (
    <>
      <toast.ToastContainer />
      <div className="container mx-auto p-8 max-w-6xl">
        <h1 className="text-3xl font-bold mb-6">{t('options.title')}</h1>

        {/* Tabs */}
        <div className="mb-6 border-b">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('general')}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'general'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              {t('options.generalSettings')}
            </button>
            <button
              onClick={() => setActiveTab('scrapers')}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'scrapers'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              {t('options.scraperConfigs')}
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'scrapers' ? (
          <ScraperConfigList />
        ) : (
          <div>
            {/* Basic Settings */}
            <section className="mb-8 bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-semibold mb-4">{t('options.basicSettings')}</h2>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">{t('options.maxComments')}</label>
                <input
                  type="number"
                  value={settings.maxComments}
                  onChange={(e) =>
                    handleSettingsChange({ ...settings, maxComments: parseInt(e.target.value) })
                  }
                  className="w-full px-3 py-2 border rounded"
                  min="1"
                  max="10000"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">{t('options.language')}</label>
                <select
                  value={settings.language}
                  onChange={(e) => {
                    const newLang = e.target.value as 'zh-CN' | 'en-US';
                    handleSettingsChange({ ...settings, language: newLang });
                    // Change i18n language immediately
                    i18n.changeLanguage(newLang);
                  }}
                  className="w-full px-3 py-2 border rounded"
                >
                  <option value="zh-CN">中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>

              <div className="mb-4 flex items-center">
                <input
                  type="checkbox"
                  id="developerMode"
                  checked={settings.developerMode || false}
                  onChange={(e) =>
                    handleSettingsChange({ ...settings, developerMode: e.target.checked })
                  }
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="developerMode" className="ml-2 block text-sm text-gray-900">
                  {t('options.developerMode')}
                </label>
              </div>
              <p className="text-xs text-gray-500 ml-6">
                {t('options.developerModeHint')}
              </p>
            </section>

            {/* DOM Analysis Configuration */}
            <section className="mb-8 bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-semibold mb-4">{t('options.domAnalysisConfig')}</h2>
              <p className="text-sm text-gray-600 mb-4">{t('options.domAnalysisHint')}</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    {t('options.initialDepth')}
                    <span className="text-xs text-gray-500 ml-2">
                      {t('options.recommended')}: 3
                    </span>
                  </label>
                  <input
                    type="number"
                    value={settings.domAnalysisConfig?.initialDepth || 3}
                    onChange={(e) =>
                      handleSettingsChange({
                        ...settings,
                        domAnalysisConfig: {
                          ...settings.domAnalysisConfig,
                          initialDepth: parseInt(e.target.value),
                          expandDepth: settings.domAnalysisConfig?.expandDepth || 2,
                          maxDepth: settings.domAnalysisConfig?.maxDepth || 10,
                        },
                      })
                    }
                    className="w-full px-3 py-2 border rounded"
                    min="1"
                    max="5"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('options.initialDepthHint')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    {t('options.expandDepth')}
                    <span className="text-xs text-gray-500 ml-2">
                      {t('options.recommended')}: 2
                    </span>
                  </label>
                  <input
                    type="number"
                    value={settings.domAnalysisConfig?.expandDepth || 2}
                    onChange={(e) =>
                      handleSettingsChange({
                        ...settings,
                        domAnalysisConfig: {
                          ...settings.domAnalysisConfig,
                          initialDepth: settings.domAnalysisConfig?.initialDepth || 3,
                          expandDepth: parseInt(e.target.value),
                          maxDepth: settings.domAnalysisConfig?.maxDepth || 10,
                        },
                      })
                    }
                    className="w-full px-3 py-2 border rounded"
                    min="1"
                    max="3"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('options.expandDepthHint')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    {t('options.maxDepth')}
                    <span className="text-xs text-gray-500 ml-2">
                      {t('options.recommended')}: 10
                    </span>
                  </label>
                  <input
                    type="number"
                    value={settings.domAnalysisConfig?.maxDepth || 10}
                    onChange={(e) =>
                      handleSettingsChange({
                        ...settings,
                        domAnalysisConfig: {
                          ...settings.domAnalysisConfig,
                          initialDepth: settings.domAnalysisConfig?.initialDepth || 3,
                          expandDepth: settings.domAnalysisConfig?.expandDepth || 2,
                          maxDepth: parseInt(e.target.value),
                        },
                      })
                    }
                    className="w-full px-3 py-2 border rounded"
                    min="5"
                    max="15"
                  />
                  <p className="text-xs text-gray-500 mt-1">{t('options.maxDepthHint')}</p>
                </div>
              </div>
            </section>

            {/* AI Model */}
            <section className="mb-8 bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-semibold mb-4">{t('options.aiModel')}</h2>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">{t('options.apiUrl')}</label>
                <input
                  type="text"
                  value={settings.aiModel.apiUrl}
                  onChange={(e) =>
                    handleSettingsChange({
                      ...settings,
                      aiModel: { ...settings.aiModel, apiUrl: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 border rounded"
                  placeholder={API.EXAMPLE_COMPLETIONS_URL}
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">{t('options.apiKey')}</label>
                <div className="flex gap-2">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={showApiKey ? settings.aiModel.apiKey : maskApiKey(settings.aiModel.apiKey)}
                    onChange={(e) =>
                      handleSettingsChange({
                        ...settings,
                        aiModel: { ...settings.aiModel, apiKey: e.target.value },
                      })
                    }
                    className="flex-1 px-3 py-2 border rounded"
                    placeholder={t('options.apiKeyPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="px-3 py-2 border rounded hover:bg-gray-100"
                  >
                    {showApiKey ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">{t('options.model')}</label>
                {availableModels.length > 0 ? (
                  <select
                    value={settings.aiModel.model}
                    onChange={(e) =>
                      handleSettingsChange({
                        ...settings,
                        aiModel: { ...settings.aiModel, model: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 border rounded"
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
                      handleSettingsChange({
                        ...settings,
                        aiModel: { ...settings.aiModel, model: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 border rounded"
                    placeholder={t('options.defaultModelName')}
                  />
                )}
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium mb-2">{t('options.maxTokens')}</label>
                  <input
                    type="number"
                    value={settings.aiModel.maxTokens}
                    onChange={(e) =>
                      handleSettingsChange({
                        ...settings,
                        aiModel: {
                          ...settings.aiModel,
                          maxTokens: parseInt(e.target.value),
                        },
                      })
                    }
                    className="w-full px-3 py-2 border rounded"
                    min="1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    {t('options.temperature')}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={settings.aiModel.temperature}
                    onChange={(e) =>
                      handleSettingsChange({
                        ...settings,
                        aiModel: {
                          ...settings.aiModel,
                          temperature: parseFloat(e.target.value),
                        },
                      })
                    }
                    className="w-full px-3 py-2 border rounded"
                    min="0"
                    max="2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">{t('options.topP')}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={settings.aiModel.topP}
                    onChange={(e) =>
                      handleSettingsChange({
                        ...settings,
                        aiModel: {
                          ...settings.aiModel,
                          topP: parseFloat(e.target.value),
                        },
                      })
                    }
                    className="w-full px-3 py-2 border rounded"
                    min="0"
                    max="1"
                  />
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={handleFetchModels}
                  disabled={loadingModels || testingModel}
                  className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400"
                >
                  {loadingModels ? t('common.loading') : '🔄 ' + t('options.fetchModels')}
                </button>
                <button
                  type="button"
                  onClick={handleTestModel}
                  disabled={testingModel || loadingModels}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
                >
                  {testingModel ? t('options.testing') : '🧪 ' + t('options.testModel')}
                </button>
              </div>
            </section>

            <section className="mb-8 bg-white p-6 rounded-lg shadow">
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  {t('options.promptTemplate')}
                </label>
                <textarea
                  value={settings.analyzerPromptTemplate}
                  onChange={(e) =>
                    handleSettingsChange({ ...settings, analyzerPromptTemplate: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded font-mono text-sm"
                  rows={10}
                />

                {/* Collapsible placeholders help */}
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowPlaceholders(!showPlaceholders)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <span>{showPlaceholders ? '▼' : '▶'}</span>
                    <span>{t('options.availablePlaceholders')}</span>
                  </button>

                  {showPlaceholders && (
                    <div className="mt-3 p-4 bg-gray-50 rounded border border-gray-200">
                      <div className="space-y-3">
                        <div>
                          <code className="text-sm font-mono bg-blue-100 px-2 py-1 rounded text-blue-800">
                            {'{comments_data}'}
                          </code>
                          <span className="text-red-600 text-xs ml-2">
                            *{t('options.required')}
                          </span>
                          <p className="text-sm text-gray-700 mt-1">
                            {t('options.placeholder_comments_data')}
                          </p>
                        </div>

                        <div>
                          <code className="text-sm font-mono bg-green-100 px-2 py-1 rounded text-green-800">
                            {'{datetime}'}
                          </code>
                          <p className="text-sm text-gray-700 mt-1">
                            {t('options.placeholder_datetime')}
                          </p>
                        </div>

                        <div>
                          <code className="text-sm font-mono bg-green-100 px-2 py-1 rounded text-green-800">
                            {'{video_time}'}
                          </code>
                          <p className="text-sm text-gray-700 mt-1">
                            {t('options.placeholder_video_time')}
                          </p>
                        </div>

                        <div>
                          <code className="text-sm font-mono bg-green-100 px-2 py-1 rounded text-green-800">
                            {'{platform}'}
                          </code>
                          <p className="text-sm text-gray-700 mt-1">
                            {t('options.placeholder_platform')}
                          </p>
                        </div>

                        <div>
                          <code className="text-sm font-mono bg-green-100 px-2 py-1 rounded text-green-800">
                            {'{url}'}
                          </code>
                          <p className="text-sm text-gray-700 mt-1">
                            {t('options.placeholder_url')}
                          </p>
                        </div>

                        <div>
                          <code className="text-sm font-mono bg-green-100 px-2 py-1 rounded text-green-800">
                            {'{title}'}
                          </code>
                          <p className="text-sm text-gray-700 mt-1">
                            {t('options.placeholder_title')}
                          </p>
                        </div>

                        <div>
                          <code className="text-sm font-mono bg-green-100 px-2 py-1 rounded text-green-800">
                            {'{total_comments}'}
                          </code>
                          <p className="text-sm text-gray-700 mt-1">
                            {t('options.placeholder_total_comments')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Import/Export */}
            <section className="mb-8 bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-semibold mb-4">{t('options.importExport')}</h2>

              <div className="flex gap-4">
                <button
                  onClick={handleExport}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  {t('options.exportSettings')}
                </button>
                <label className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 cursor-pointer">
                  {t('options.importSettings')}
                  <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                </label>
              </div>
            </section>

            {/* Auto-save indicator */}
            {saving && (
              <div className="fixed bottom-4 right-4 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg">
                {t('options.saving')}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default Options;
import { Logger } from '@/utils/logger';
