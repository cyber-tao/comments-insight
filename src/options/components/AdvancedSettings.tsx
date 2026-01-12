import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AI, TIMEOUT, UI_LIMITS, DOM_ANALYSIS_DEFAULTS } from '@/config/constants';
import { Settings } from '@/types';
import { useToast } from '@/hooks/useToast';
import { Logger } from '@/utils/logger';

interface AdvancedSettingsProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  settings,
  onSettingsChange,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [grantedOrigins, setGrantedOrigins] = useState<string[]>([]);
  const [loadingOrigins, setLoadingOrigins] = useState(false);

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
      Logger.error('[AdvancedSettings] Failed to load granted origins', { error: e });
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
      Logger.error('[AdvancedSettings] Failed to revoke origin', { error: e, origin });
      toast.error(t('options.siteAccessRevokeFailed'));
    }
  };

  useEffect(() => {
    loadGrantedOrigins();
  }, [loadGrantedOrigins]);

  return (
    <section className="mb-8 bg-white p-6 rounded-lg shadow">
      <div className="space-y-8 animate-fade-in">
        {/* AI Timeout */}
        <div>
          <label className="block text-sm font-medium mb-2">{t('options.aiTimeout')}</label>
          <input
            type="number"
            value={(settings.aiTimeout || AI.DEFAULT_TIMEOUT) / TIMEOUT.MS_PER_SEC}
            onChange={(e) =>
              onSettingsChange({
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
                  {t('options.recommended')}: {DOM_ANALYSIS_DEFAULTS.initialDepth}
                </span>
              </label>
              <input
                type="number"
                value={
                  settings.domAnalysisConfig?.initialDepth || DOM_ANALYSIS_DEFAULTS.initialDepth
                }
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    domAnalysisConfig: {
                      ...settings.domAnalysisConfig,
                      initialDepth: parseInt(e.target.value),
                      expandDepth:
                        settings.domAnalysisConfig?.expandDepth ||
                        DOM_ANALYSIS_DEFAULTS.expandDepth,
                      maxDepth:
                        settings.domAnalysisConfig?.maxDepth || DOM_ANALYSIS_DEFAULTS.maxDepth,
                    },
                  })
                }
                className="w-full px-3 py-2 border rounded"
                min={UI_LIMITS.INITIAL_DEPTH_MIN}
                max={UI_LIMITS.INITIAL_DEPTH_MAX}
              />
              <p className="text-xs text-gray-500 mt-1">{t('options.initialDepthHint')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {t('options.expandDepth')}
                <span className="text-xs text-gray-500 ml-2">
                  {t('options.recommended')}: {DOM_ANALYSIS_DEFAULTS.expandDepth}
                </span>
              </label>
              <input
                type="number"
                value={settings.domAnalysisConfig?.expandDepth || DOM_ANALYSIS_DEFAULTS.expandDepth}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    domAnalysisConfig: {
                      ...settings.domAnalysisConfig,
                      initialDepth:
                        settings.domAnalysisConfig?.initialDepth ||
                        DOM_ANALYSIS_DEFAULTS.initialDepth,
                      expandDepth: parseInt(e.target.value),
                      maxDepth:
                        settings.domAnalysisConfig?.maxDepth || DOM_ANALYSIS_DEFAULTS.maxDepth,
                    },
                  })
                }
                className="w-full px-3 py-2 border rounded"
                min={UI_LIMITS.EXPAND_DEPTH_MIN}
                max={UI_LIMITS.EXPAND_DEPTH_MAX}
              />
              <p className="text-xs text-gray-500 mt-1">{t('options.expandDepthHint')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {t('options.maxDepth')}
                <span className="text-xs text-gray-500 ml-2">
                  {t('options.recommended')}: {DOM_ANALYSIS_DEFAULTS.maxDepth}
                </span>
              </label>
              <input
                type="number"
                value={settings.domAnalysisConfig?.maxDepth || DOM_ANALYSIS_DEFAULTS.maxDepth}
                onChange={(e) =>
                  onSettingsChange({
                    ...settings,
                    domAnalysisConfig: {
                      ...settings.domAnalysisConfig,
                      initialDepth:
                        settings.domAnalysisConfig?.initialDepth ||
                        DOM_ANALYSIS_DEFAULTS.initialDepth,
                      expandDepth:
                        settings.domAnalysisConfig?.expandDepth ||
                        DOM_ANALYSIS_DEFAULTS.expandDepth,
                      maxDepth: parseInt(e.target.value),
                    },
                  })
                }
                className="w-full px-3 py-2 border rounded"
                min={UI_LIMITS.MAX_DEPTH_MIN}
                max={UI_LIMITS.MAX_DEPTH_MAX}
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
              onChange={(e) => onSettingsChange({ ...settings, developerMode: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="developerMode" className="ml-2 block text-sm text-gray-900">
              {t('options.developerMode')}
            </label>
          </div>
          <p className="text-xs text-gray-500 ml-6">{t('options.developerModeHint')}</p>
        </div>
      </div>
    </section>
  );
};
