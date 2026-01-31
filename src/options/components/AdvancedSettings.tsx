import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { AI, TIMEOUT, UI_LIMITS, DOM_ANALYSIS_DEFAULTS } from '@/config/constants';
import { Settings } from '@/types';

interface AdvancedSettingsProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  settings,
  onSettingsChange,
}) => {
  const { t } = useTranslation();

  return (
    <section className="mb-8 theme-card p-6">
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
        {t('options.advancedSettings')}
      </h2>
      <div className="space-y-8 animate-fade-in">
        <div>
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('options.aiTimeout')}
          </label>
          <input
            type="number"
            value={(settings.aiTimeout || AI.DEFAULT_TIMEOUT) / TIMEOUT.MS_PER_SEC}
            onChange={(e) =>
              onSettingsChange({
                ...settings,
                aiTimeout: parseInt(e.target.value) * TIMEOUT.MS_PER_SEC,
              })
            }
            className="w-full theme-input"
            min={TIMEOUT.MIN_AI_SECONDS}
            max={TIMEOUT.MAX_AI_SECONDS}
          />
        </div>

        <div>
          <h3 className="text-md font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            {t('options.domAnalysisConfig')}
          </h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            {t('options.domAnalysisHint')}
          </p>

          <div className="space-y-4">
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                {t('options.initialDepth')}
                <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
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
                className="w-full theme-input"
                min={UI_LIMITS.INITIAL_DEPTH_MIN}
                max={UI_LIMITS.INITIAL_DEPTH_MAX}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {t('options.initialDepthHint')}
              </p>
            </div>

            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                {t('options.expandDepth')}
                <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
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
                className="w-full theme-input"
                min={UI_LIMITS.EXPAND_DEPTH_MIN}
                max={UI_LIMITS.EXPAND_DEPTH_MAX}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {t('options.expandDepthHint')}
              </p>
            </div>

            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                {t('options.maxDepth')}
                <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
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
                className="w-full theme-input"
                min={UI_LIMITS.MAX_DEPTH_MIN}
                max={UI_LIMITS.MAX_DEPTH_MAX}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {t('options.maxDepthHint')}
              </p>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-4 flex items-center">
            <input
              type="checkbox"
              id="developerMode"
              checked={settings.developerMode || false}
              onChange={(e) => onSettingsChange({ ...settings, developerMode: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 rounded"
              style={{ borderColor: 'var(--border-primary)' }}
            />
            <label
              htmlFor="developerMode"
              className="ml-2 block text-sm"
              style={{ color: 'var(--text-primary)' }}
            >
              {t('options.developerMode')}
            </label>
          </div>
          <p className="text-xs ml-6" style={{ color: 'var(--text-muted)' }}>
            {t('options.developerModeHint')}
          </p>
        </div>
      </div>
    </section>
  );
};
