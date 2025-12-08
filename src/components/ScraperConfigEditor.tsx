import * as React from 'react';
import { SCROLL, TIMING } from '@/config/constants';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScraperConfig, ScraperSelectors, ScrollConfig } from '../types/scraper';
import { ScraperConfigManager } from '../utils/ScraperConfigManager';

interface ScraperConfigEditorProps {
  config?: ScraperConfig;
  onSave: (config: ScraperConfig) => void;
  onCancel: () => void;
}

export const ScraperConfigEditor: React.FC<ScraperConfigEditorProps> = ({
  config,
  onSave,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(config?.name || '');
  const [domains, setDomains] = useState<string[]>(config?.domains || ['']);
  const [urlPatterns, setUrlPatterns] = useState<string[]>(config?.urlPatterns || ['']);
  const [selectors, setSelectors] = useState<ScraperSelectors>(
    config?.selectors || {
      commentContainer: '',
      commentItem: '',
      username: '',
      content: '',
      timestamp: '',
      likes: '',
    },
  );
  const [scrollConfig, setScrollConfig] = useState<ScrollConfig>(
    config?.scrollConfig || {
      enabled: false,
      maxScrolls: SCROLL.DEFAULT_MAX_SCROLLS,
      scrollDelay: TIMING.AI_RETRY_DELAY_MS,
    },
  );
  const [errors, setErrors] = useState<string[]>([]);

  const handleSave = async () => {
    const configData = {
      name,
      domains: domains.filter((d) => d.trim() !== ''),
      urlPatterns: urlPatterns.filter((p) => p.trim() !== ''),
      selectors,
      scrollConfig: scrollConfig.enabled ? scrollConfig : undefined,
    };

    const validation = ScraperConfigManager.validateConfig(configData);

    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    try {
      let savedConfig: ScraperConfig;

      if (config?.id) {
        // Update existing
        savedConfig = (await ScraperConfigManager.update(config.id, configData)) as ScraperConfig;
      } else {
        // Create new
        savedConfig = await ScraperConfigManager.create(configData);
      }

      onSave(savedConfig);
    } catch (_error) {
      setErrors([t('scraper.saveConfigFailed')]);
    }
  };

  const addDomain = () => {
    setDomains([...domains, '']);
  };

  const removeDomain = (index: number) => {
    setDomains(domains.filter((_, i) => i !== index));
  };

  const updateDomain = (index: number, value: string) => {
    const newDomains = [...domains];
    newDomains[index] = value;
    setDomains(newDomains);
  };

  const addUrlPattern = () => {
    setUrlPatterns([...urlPatterns, '']);
  };

  const removeUrlPattern = (index: number) => {
    setUrlPatterns(urlPatterns.filter((_, i) => i !== index));
  };

  const updateUrlPattern = (index: number, value: string) => {
    const newPatterns = [...urlPatterns];
    newPatterns[index] = value;
    setUrlPatterns(newPatterns);
  };

  const updateSelector = (key: keyof ScraperSelectors, value: string) => {
    setSelectors({ ...selectors, [key]: value || undefined });
  };

  // Get validation status for a selector
  const getValidationStatus = (key: string): 'success' | 'failed' | 'untested' => {
    return config?.selectorValidation?.[key] || 'untested';
  };

  // Render validation indicator
  const renderValidationIndicator = (key: string) => {
    const status = getValidationStatus(key);

    if (status === 'success') {
      return (
        <span className="text-green-600 text-lg" title={t('scraper.selectorValidated')}>
          ✓
        </span>
      );
    } else if (status === 'failed') {
      return (
        <span className="text-red-600 text-lg" title={t('scraper.selectorFailed')}>
          ✗
        </span>
      );
    }
    return null;
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">
        {config ? t('scraper.editConfig') : t('scraper.newConfig')}
      </h2>

      {errors.length > 0 && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded">
          <h3 className="font-semibold text-red-800 mb-2">{t('scraper.validationErrors')}</h3>
          <ul className="list-disc list-inside text-red-700 text-sm">
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Basic Info */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">{t('scraper.configName')} *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border rounded"
          placeholder={t('scraper.configNamePlaceholder')}
        />
      </div>

      {/* Domains */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">{t('scraper.domains')} *</label>
        <p className="text-xs text-gray-500 mb-2">{t('scraper.domainsHint')}</p>
        {domains.map((domain, index) => (
          <div key={index} className="flex gap-2 mb-2">
            <input
              type="text"
              value={domain}
              onChange={(e) => updateDomain(index, e.target.value)}
              className="flex-1 px-3 py-2 border rounded"
              placeholder={t('scraper.domainPlaceholder')}
            />
            <button
              onClick={() => removeDomain(index)}
              className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              {t('scraper.removeDomain')}
            </button>
          </div>
        ))}
        <button
          onClick={addDomain}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
        >
          + {t('scraper.addDomain')}
        </button>
      </div>

      {/* URL Patterns */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">{t('scraper.urlPatterns')}</label>
        <p className="text-xs text-gray-500 mb-2">{t('scraper.urlPatternsHint')}</p>
        {urlPatterns.map((pattern, index) => (
          <div key={index} className="flex gap-2 mb-2">
            <input
              type="text"
              value={pattern}
              onChange={(e) => updateUrlPattern(index, e.target.value)}
              className="flex-1 px-3 py-2 border rounded font-mono text-sm"
              placeholder={t('scraper.urlPatternPlaceholder')}
            />
            <button
              onClick={() => removeUrlPattern(index)}
              className="px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              {t('scraper.removePattern')}
            </button>
          </div>
        ))}
        <button
          onClick={addUrlPattern}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
        >
          + {t('scraper.addPattern')}
        </button>
      </div>

      {/* Selectors */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">{t('scraper.selectors')}</h3>
        <p className="text-xs text-gray-500 mb-4">{t('scraper.selectorHierarchyHint')}</p>

        <div className="space-y-3">
          {/* Required selectors */}
          {[
            { key: 'commentContainer', label: t('scraper.commentContainer'), required: true },
            { key: 'commentItem', label: t('scraper.commentItem'), required: true },
            { key: 'username', label: t('scraper.username'), required: true },
            { key: 'content', label: t('scraper.content'), required: true },
            { key: 'timestamp', label: t('scraper.timestamp'), required: true },
            { key: 'likes', label: t('scraper.likes'), required: true },
          ].map(({ key, label, required }) => (
            <div key={key}>
              <label className="block text-sm font-medium mb-1 flex items-center gap-2">
                <span>
                  {label} {required && '*'}
                </span>
                {renderValidationIndicator(key)}
              </label>
              <input
                type="text"
                value={selectors[key as keyof ScraperSelectors] || ''}
                onChange={(e) => updateSelector(key as keyof ScraperSelectors, e.target.value)}
                className="w-full px-3 py-2 border rounded font-mono text-sm"
                placeholder={t('scraper.selectorPlaceholder')}
              />
            </div>
          ))}

          {/* Optional selectors */}
          {[
            { key: 'postTitle', label: t('scraper.postTitle') },
            { key: 'videoTime', label: t('scraper.videoTime') },
            { key: 'replyToggle', label: t('scraper.replyToggle') },
            { key: 'replyContainer', label: t('scraper.replyContainer') },
            { key: 'replyItem', label: t('scraper.replyItem') },
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="block text-sm font-medium mb-1 flex items-center gap-2">
                <span>{label}</span>
                {renderValidationIndicator(key)}
              </label>
              <input
                type="text"
                value={selectors[key as keyof ScraperSelectors] || ''}
                onChange={(e) => updateSelector(key as keyof ScraperSelectors, e.target.value)}
                className="w-full px-3 py-2 border rounded font-mono text-sm"
                placeholder={t('scraper.selectorPlaceholder')}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Scroll Configuration */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-3">{t('scraper.scrollConfig')}</h3>

        <div className="mb-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={scrollConfig.enabled}
              onChange={(e) => setScrollConfig({ ...scrollConfig, enabled: e.target.checked })}
              className="w-4 h-4"
            />
            <span className="text-sm font-medium">{t('scraper.enableScroll')}</span>
          </label>
          <p className="text-xs text-gray-500 ml-6">{t('scraper.enableScrollHint')}</p>
        </div>

        {scrollConfig.enabled && (
          <div className="ml-6 space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t('scraper.maxScrolls')}</label>
              <input
                type="number"
                value={scrollConfig.maxScrolls}
                onChange={(e) =>
                  setScrollConfig({ ...scrollConfig, maxScrolls: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 border rounded"
                min="1"
                max="100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t('scraper.scrollDelay')}</label>
              <input
                type="number"
                value={scrollConfig.scrollDelay}
                onChange={(e) =>
                  setScrollConfig({ ...scrollConfig, scrollDelay: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 border rounded"
                min="100"
                step="100"
              />
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <button
          onClick={onCancel}
          className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-50"
        >
          {t('scraper.cancelEdit')}
        </button>
        <button
          onClick={handleSave}
          className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          {t('scraper.saveConfig')}
        </button>
      </div>
    </div>
  );
};
