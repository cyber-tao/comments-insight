import * as React from 'react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { API, MESSAGES, TIMING, LANGUAGES, LIMITS, TIMEOUT, AI } from '@/config/constants';
import { DEFAULT_ANALYSIS_PROMPT_TEMPLATE } from '@/utils/prompts';
import { Settings } from '../types';
import i18n from '../utils/i18n';
import { useToast } from '../hooks/useToast';
import { Logger } from '@/utils/logger';

const Options: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
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
  const [grantedOrigins, setGrantedOrigins] = useState<string[]>([]);
  const [loadingOrigins, setLoadingOrigins] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    // Load settings only once on mount
    const loadSettings = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS });
        Logger.debug('[Options] Settings response', { response });

        if (chrome.runtime.lastError) {
          Logger.error('[Options] Runtime error', { error: chrome.runtime.lastError });
          toast.error(
            t('options.loadSettingsError', { message: chrome.runtime.lastError.message }),
          );
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
          toast.error(t('options.loadSettingsInvalid'));
        }
      } catch (error) {
        Logger.error('[Options] Failed to load settings', { error });
        toast.error(
          t('options.loadSettingsError', {
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
        );
      }
    };

    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getRequiredOrigins = (): string[] => {
    const manifest = chrome.runtime.getManifest();
    return manifest.content_scripts?.flatMap((x) => x.matches || []) || [];
  };

  const loadGrantedOrigins = useCallback(async () => {
    try {
      setLoadingOrigins(true);
      const perms = await chrome.permissions.getAll();
      const required = new Set(getRequiredOrigins());
      setGrantedOrigins((perms.origins || []).filter((x) => !required.has(x)));
    } catch (e) {
      Logger.error('[Options] Failed to load granted origins', { error: e });
      setGrantedOrigins([]);
    } finally {
      setLoadingOrigins(false);
    }
  }, []);

  const revokeOrigin = async (origin: string) => {
    try {
      const required = new Set(getRequiredOrigins());
      if (required.has(origin)) {
        toast.warning(t('options.siteAccessRequired'));
        return;
      }

      const removed = await chrome.permissions.remove({ origins: [origin] });
      if (!removed) {
        toast.warning(t('options.siteAccessRequired'));
        return;
      }
      await loadGrantedOrigins();
      toast.success(t('options.siteAccessRevoked'));
    } catch (e) {
      Logger.error('[Options] Failed to revoke origin', { error: e, origin });
      toast.error(t('options.siteAccessRevokeFailed'));
    }
  };

  useEffect(() => {
    loadGrantedOrigins();
  }, [loadGrantedOrigins]);

  // Auto-save settings when they change (but not on initial load)
  useEffect(() => {
    if (!settings || isInitialLoad || isSavingRef.current) return;

    const saveSettings = async () => {
      isSavingRef.current = true;
      setSaving(true);

      try {
        const { selectorCache: _selectorCache, ...settingsToSave } = settings as Settings & {
          selectorCache?: Settings['selectorCache'];
        };
        await chrome.runtime.sendMessage({
          type: MESSAGES.SAVE_SETTINGS,
          payload: { settings: settingsToSave },
        });

        if (isUserChangeRef.current) {
          toast.success(t('options.savedSuccess'));
          isUserChangeRef.current = false;
        }
      } catch {
        toast.error(t('options.savedError'));
      } finally {
        setSaving(false);
        isSavingRef.current = false;
      }
    };

    const timeoutId = setTimeout(saveSettings, TIMING.DEBOUNCE_SAVE_MS);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t and toast are stable, only trigger on settings/isInitialLoad changes
  }, [settings, isInitialLoad]);

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
    } catch (_error) {
      toast.error(t('options.exportError'));
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
      } catch (_error) {
        toast.error(t('options.importError'));
      }
    };
    reader.readAsText(file);
  };

  const handleFetchModels = async () => {
    if (!settings) return;

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
    if (!settings) return;

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

  const handleSettingsChange = (newSettings: Settings) => {
    isUserChangeRef.current = true;
    setSettings(newSettings);
  };

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

  if (!settings) {
    return <div className="container mx-auto p-8">{t('common.loading')}</div>;
  }

  return (
    <>
      <toast.ToastContainer />
      <div className="container mx-auto p-8 max-w-6xl">
        <h1 className="text-3xl font-bold mb-6">{t('options.title')}</h1>

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
                  const newLang = e.target.value;
                  handleSettingsChange({ ...settings, language: newLang });
                  i18n.changeLanguage(newLang);
                }}
                className="w-full px-3 py-2 border rounded"
              >
                {LANGUAGES.SUPPORTED.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
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
              <p className="text-xs text-gray-500 mt-1">{t('options.apiKeySecurityNote')}</p>
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

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('options.contextWindowSize')}
                </label>
                <input
                  type="number"
                  value={settings.aiModel.contextWindowSize}
                  onChange={(e) =>
                    handleSettingsChange({
                      ...settings,
                      aiModel: {
                        ...settings.aiModel,
                        contextWindowSize: parseInt(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-2 border rounded"
                  min="1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">
                  {t('options.maxOutputTokens')}
                </label>
                <input
                  type="number"
                  value={settings.aiModel.maxOutputTokens || 4096}
                  onChange={(e) =>
                    handleSettingsChange({
                      ...settings,
                      aiModel: {
                        ...settings.aiModel,
                        maxOutputTokens: parseInt(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-2 border rounded"
                  min="1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('options.temperature')}</label>
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
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium">{t('options.promptTemplate')}</label>
                <button
                  type="button"
                  onClick={() =>
                    handleSettingsChange({
                      ...settings,
                      analyzerPromptTemplate: DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
                    })
                  }
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  {t('options.resetTemplate')}
                </button>
              </div>
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
                        <span className="text-red-600 text-xs ml-2">*{t('options.required')}</span>
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
                        <p className="text-sm text-gray-700 mt-1">{t('options.placeholder_url')}</p>
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

          {/* Collapsible Advanced Settings */}
          <section className="mb-8 bg-white p-6 rounded-lg shadow">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center w-full text-lg font-semibold text-gray-800 focus:outline-none"
            >
              <span className="mr-2 transform transition-transform duration-200">
                {showAdvanced ? '▼' : '▶'}
              </span>
              {t('options.advancedSettings')}
            </button>

            {showAdvanced && (
              <div className="mt-6 space-y-8 pl-4 border-l-2 border-gray-100 animate-fade-in">
                {/* AI Timeout */}
                <div>
                  <label className="block text-sm font-medium mb-2">{t('options.aiTimeout')}</label>
                  <input
                    type="number"
                    value={(settings.aiTimeout || AI.DEFAULT_TIMEOUT) / TIMEOUT.MS_PER_SEC}
                    onChange={(e) =>
                      handleSettingsChange({
                        ...settings,
                        aiTimeout: parseInt(e.target.value) * TIMEOUT.MS_PER_SEC,
                      })
                    }
                    className="w-full px-3 py-2 border rounded"
                    min={TIMEOUT.MIN_AI_SECONDS}
                    max={TIMEOUT.MAX_AI_SECONDS}
                  />
                </div>

                {/* DOM Analysis Configuration */}
                <div>
                  <h3 className="text-md font-semibold mb-2">{t('options.domAnalysisConfig')}</h3>
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
                        max="50"
                      />
                      <p className="text-xs text-gray-500 mt-1">{t('options.maxDepthHint')}</p>
                    </div>
                  </div>
                </div>

                {/* Site Access */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-md font-semibold">{t('options.siteAccess')}</h3>
                    <button
                      type="button"
                      onClick={loadGrantedOrigins}
                      disabled={loadingOrigins}
                      className="px-3 py-2 border rounded hover:bg-gray-100 disabled:bg-gray-100 text-sm"
                    >
                      {loadingOrigins ? t('common.loading') : t('options.refresh')}
                    </button>
                  </div>

                  {grantedOrigins.length === 0 ? (
                    <p className="text-sm text-gray-600">{t('options.noGrantedSites')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {grantedOrigins.map((origin) => (
                        <li key={origin} className="flex items-center justify-between text-sm">
                          <span className="font-mono break-all mr-3">{origin}</span>
                          <button
                            type="button"
                            onClick={() => revokeOrigin(origin)}
                            className="px-2 py-1 border rounded hover:bg-gray-100"
                          >
                            {t('options.revoke')}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Developer Mode */}
                <div>
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
                  <p className="text-xs text-gray-500 ml-6">{t('options.developerModeHint')}</p>
                </div>
              </div>
            )}
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
      </div>
    </>
  );
};

export default Options;
