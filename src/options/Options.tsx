import * as React from 'react';
import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from '../types';
import i18n from '../utils/i18n';
import { useToast } from '../hooks/useToast';

const Options: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showExtractorKey, setShowExtractorKey] = useState(false);
  const [showAnalyzerKey, setShowAnalyzerKey] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const isSavingRef = useRef(false);
  const [testingModel, setTestingModel] = useState<'extractor' | 'analyzer' | null>(null);
  const isUserChangeRef = useRef(false); // Track if change is from user interaction

  useEffect(() => {
    // Load settings only once on mount
    const loadSettings = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        console.log('[Options] Settings response:', response);
        
        if (chrome.runtime.lastError) {
          console.error('[Options] Runtime error:', chrome.runtime.lastError);
          toast.error('Failed to load settings: ' + chrome.runtime.lastError.message);
          return;
        }
        
        if (response?.settings) {
          setSettings(response.settings);
          // Set i18n language from settings
          if (response.settings.language) {
            console.log('[Options] Setting language to:', response.settings.language);
            i18n.changeLanguage(response.settings.language);
          }
          // Mark initial load as complete after a short delay to ensure language is set
          setTimeout(() => setIsInitialLoad(false), 100);
        } else {
          console.error('[Options] No settings in response:', response);
          toast.error('Failed to load settings: Invalid response');
        }
      } catch (error) {
        console.error('[Options] Failed to load settings:', error);
        toast.error('Failed to load settings: ' + (error instanceof Error ? error.message : 'Unknown error'));
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
          type: 'SAVE_SETTINGS',
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
    const timeoutId = setTimeout(saveSettings, 500);
    return () => clearTimeout(timeoutId);
  }, [settings, isInitialLoad, t]); // 保留 t 依赖用于消息显示



  const handleExport = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXPORT_DATA',
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

  const handleFetchModels = async (modelType: 'extractor' | 'analyzer') => {
    if (!settings) return;

    const config = modelType === 'extractor' ? settings.extractorModel : settings.analyzerModel;
    
    if (!config.apiUrl || !config.apiKey) {
      toast.warning('Please configure API URL and API Key first');
      return;
    }

    setLoadingModels(true);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_AVAILABLE_MODELS',
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

  const handleTestModel = async (modelType: 'extractor' | 'analyzer') => {
    if (!settings) return;

    const config = modelType === 'extractor' ? settings.extractorModel : settings.analyzerModel;
    
    if (!config.apiUrl || !config.apiKey || !config.model) {
      toast.warning('Please configure all required fields');
      return;
    }

    setTestingModel(modelType);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_MODEL',
        payload: { config },
      });

      if (response?.success) {
        toast.success(t('options.testSuccess') + (response.response ? `: ${response.response}` : ''));
      } else {
        toast.error(t('options.testFailed') + ': ' + (response?.error || 'Unknown error'));
      }
    } catch (error) {
      toast.error(t('options.testFailed') + ': ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setTestingModel(null);
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
      <div className="container mx-auto p-8 max-w-4xl">
        <h1 className="text-3xl font-bold mb-6">{t('options.title')}</h1>

      {/* Basic Settings */}
      <section className="mb-8 bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">{t('options.basicSettings')}</h2>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('options.maxComments')}</label>
          <input
            type="number"
            value={settings.maxComments}
            onChange={(e) => handleSettingsChange({ ...settings, maxComments: parseInt(e.target.value) })}
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
      </section>

      {/* Extractor Model */}
      <section className="mb-8 bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">{t('options.extractorModel')}</h2>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('options.apiUrl')}</label>
          <input
            type="text"
            value={settings.extractorModel.apiUrl}
            onChange={(e) => handleSettingsChange({
              ...settings,
              extractorModel: { ...settings.extractorModel, apiUrl: e.target.value }
            })}
            className="w-full px-3 py-2 border rounded"
            placeholder="https://api.openai.com/v1/chat/completions"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('options.apiKey')}</label>
          <div className="flex gap-2">
            <input
              type={showExtractorKey ? "text" : "password"}
              value={showExtractorKey ? settings.extractorModel.apiKey : maskApiKey(settings.extractorModel.apiKey)}
              onChange={(e) => handleSettingsChange({
                ...settings,
                extractorModel: { ...settings.extractorModel, apiKey: e.target.value }
              })}
              className="flex-1 px-3 py-2 border rounded"
              placeholder="sk-..."
            />
            <button
              type="button"
              onClick={() => setShowExtractorKey(!showExtractorKey)}
              className="px-3 py-2 border rounded hover:bg-gray-100"
            >
              {showExtractorKey ? '🙈' : '👁️'}
            </button>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('options.model')}</label>
          {availableModels.length > 0 ? (
            <select
              value={settings.extractorModel.model}
              onChange={(e) => handleSettingsChange({
                ...settings,
                extractorModel: { ...settings.extractorModel, model: e.target.value }
              })}
              className="w-full px-3 py-2 border rounded"
            >
              {availableModels.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={settings.extractorModel.model}
              onChange={(e) => handleSettingsChange({
                ...settings,
                extractorModel: { ...settings.extractorModel, model: e.target.value }
              })}
              className="w-full px-3 py-2 border rounded"
              placeholder="gpt-4"
            />
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">{t('options.maxTokens')}</label>
            <input
              type="number"
              value={settings.extractorModel.maxTokens}
              onChange={(e) => handleSettingsChange({
                ...settings,
                extractorModel: { ...settings.extractorModel, maxTokens: parseInt(e.target.value) }
              })}
              className="w-full px-3 py-2 border rounded"
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">{t('options.temperature')}</label>
            <input
              type="number"
              step="0.1"
              value={settings.extractorModel.temperature}
              onChange={(e) => handleSettingsChange({
                ...settings,
                extractorModel: { ...settings.extractorModel, temperature: parseFloat(e.target.value) }
              })}
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
              value={settings.extractorModel.topP}
              onChange={(e) => handleSettingsChange({
                ...settings,
                extractorModel: { ...settings.extractorModel, topP: parseFloat(e.target.value) }
              })}
              className="w-full px-3 py-2 border rounded"
              min="0"
              max="1"
            />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => handleFetchModels('extractor')}
            disabled={loadingModels || testingModel !== null}
            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400"
          >
            {loadingModels ? t('common.loading') : '🔄 ' + t('options.fetchModels')}
          </button>
          <button
            type="button"
            onClick={() => handleTestModel('extractor')}
            disabled={testingModel !== null || loadingModels}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
          >
            {testingModel === 'extractor' ? t('options.testing') : '🧪 ' + t('options.testModel')}
          </button>
        </div>
      </section>

      {/* Analyzer Model */}
      <section className="mb-8 bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">{t('options.analyzerModel')}</h2>
        
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('options.apiUrl')}</label>
          <input
            type="text"
            value={settings.analyzerModel.apiUrl}
            onChange={(e) => handleSettingsChange({
              ...settings,
              analyzerModel: { ...settings.analyzerModel, apiUrl: e.target.value }
            })}
            className="w-full px-3 py-2 border rounded"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('options.apiKey')}</label>
          <div className="flex gap-2">
            <input
              type={showAnalyzerKey ? "text" : "password"}
              value={showAnalyzerKey ? settings.analyzerModel.apiKey : maskApiKey(settings.analyzerModel.apiKey)}
              onChange={(e) => handleSettingsChange({
                ...settings,
                analyzerModel: { ...settings.analyzerModel, apiKey: e.target.value }
              })}
              className="flex-1 px-3 py-2 border rounded"
              placeholder="sk-..."
            />
            <button
              type="button"
              onClick={() => setShowAnalyzerKey(!showAnalyzerKey)}
              className="px-3 py-2 border rounded hover:bg-gray-100"
            >
              {showAnalyzerKey ? '🙈' : '👁️'}
            </button>
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('options.model')}</label>
          {availableModels.length > 0 ? (
            <select
              value={settings.analyzerModel.model}
              onChange={(e) => handleSettingsChange({
                ...settings,
                analyzerModel: { ...settings.analyzerModel, model: e.target.value }
              })}
              className="w-full px-3 py-2 border rounded"
            >
              {availableModels.map(model => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={settings.analyzerModel.model}
              onChange={(e) => handleSettingsChange({
                ...settings,
                analyzerModel: { ...settings.analyzerModel, model: e.target.value }
              })}
              className="w-full px-3 py-2 border rounded"
              placeholder="gpt-4"
            />
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">{t('options.maxTokens')}</label>
            <input
              type="number"
              value={settings.analyzerModel.maxTokens}
              onChange={(e) => handleSettingsChange({
                ...settings,
                analyzerModel: { ...settings.analyzerModel, maxTokens: parseInt(e.target.value) }
              })}
              className="w-full px-3 py-2 border rounded"
              min="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">{t('options.temperature')}</label>
            <input
              type="number"
              step="0.1"
              value={settings.analyzerModel.temperature}
              onChange={(e) => handleSettingsChange({
                ...settings,
                analyzerModel: { ...settings.analyzerModel, temperature: parseFloat(e.target.value) }
              })}
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
              value={settings.analyzerModel.topP}
              onChange={(e) => handleSettingsChange({
                ...settings,
                analyzerModel: { ...settings.analyzerModel, topP: parseFloat(e.target.value) }
              })}
              className="w-full px-3 py-2 border rounded"
              min="0"
              max="1"
            />
          </div>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => handleFetchModels('analyzer')}
            disabled={loadingModels || testingModel !== null}
            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400"
          >
            {loadingModels ? t('common.loading') : '🔄 ' + t('options.fetchModels')}
          </button>
          <button
            type="button"
            onClick={() => handleTestModel('analyzer')}
            disabled={testingModel !== null || loadingModels}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400"
          >
            {testingModel === 'analyzer' ? t('options.testing') : '🧪 ' + t('options.testModel')}
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">{t('options.promptTemplate')}</label>
          <textarea
            value={settings.analyzerPromptTemplate}
            onChange={(e) => handleSettingsChange({ ...settings, analyzerPromptTemplate: e.target.value })}
            className="w-full px-3 py-2 border rounded font-mono text-sm"
            rows={10}
          />
          <p className="text-xs text-gray-500 mt-1">
            {t('options.placeholdersHint')}
          </p>
        </div>
      </section>

      {/* Selector Cache Editor */}
      <section className="mb-8 bg-white p-6 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-4">{t('options.selectorCache')}</h2>
        <p className="text-sm text-gray-600 mb-4">{t('options.selectorCacheDescription')}</p>
        
        {settings.selectorCache && settings.selectorCache.length > 0 ? (
          <div className="space-y-4">
            {settings.selectorCache.map((cache, index) => (
              <div key={index} className="border rounded-lg p-4 bg-gray-50">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-semibold text-lg">{cache.domain}</h3>
                    <p className="text-sm text-gray-600">
                      {t('options.platform')}: <span className="capitalize">{cache.platform}</span> | 
                      {t('options.successCount')}: {cache.successCount} | 
                      {t('options.lastUsed')}: {new Date(cache.lastUsed).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const newCache = [...settings.selectorCache];
                      newCache.splice(index, 1);
                      handleSettingsChange({ ...settings, selectorCache: newCache });
                    }}
                    className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                  >
                    {t('common.delete')}
                  </button>
                </div>
                
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-800">
                    {t('options.viewEditSelectors')}
                  </summary>
                  <div className="mt-3 space-y-2 pl-4">
                    {Object.entries(cache.selectors).map(([key, value]) => (
                      value && (
                        <div key={key} className="flex items-center gap-2">
                          <label className="text-sm font-medium w-32">{key}:</label>
                          <input
                            type="text"
                            value={value as string}
                            onChange={(e) => {
                              const newCache = [...settings.selectorCache];
                              newCache[index] = {
                                ...newCache[index],
                                selectors: {
                                  ...newCache[index].selectors,
                                  [key]: e.target.value,
                                },
                              };
                              handleSettingsChange({ ...settings, selectorCache: newCache });
                            }}
                            className="flex-1 px-2 py-1 border rounded text-sm font-mono"
                          />
                        </div>
                      )
                    ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-4">{t('options.noSelectorCache')}</p>
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
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
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
    </>
  );
};

export default Options;

