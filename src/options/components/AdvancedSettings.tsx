import * as React from 'react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AI,
  TIMEOUT,
  UI_LIMITS,
  DOM_ANALYSIS_DEFAULTS,
  STORAGE,
  LOG_LEVELS,
  LOG_LEVEL_LABELS,
} from '@/config/constants';
import { Settings, SettingsPatch } from '@/types';
import { parseFiniteIntegerInput } from '@/utils/number';
import { Logger, LogLevel } from '@/utils/logger';

interface AdvancedSettingsProps {
  settings: Settings;
  onSettingsChange: (settings: SettingsPatch) => void;
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  settings,
  onSettingsChange,
}) => {
  const { t } = useTranslation();
  const [logLevel, setLogLevel] = useState<LogLevel>(LogLevel.INFO);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(STORAGE.LOG_LEVEL_KEY).then((stored) => {
        const val = stored[STORAGE.LOG_LEVEL_KEY] as string | undefined;
        if (val && (LOG_LEVELS as readonly string[]).includes(val)) {
          setLogLevel(val as LogLevel);
        }
      });
    }
  }, []);

  const handleLogLevelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as LogLevel;
    setLogLevel(val);
    await Logger.setMinLevel(val);
  };

  return (
    <section className="mb-8 theme-card p-6">
      <h2
        className="text-lg font-bold mb-4 font-serif-editorial"
        style={{ color: 'var(--text-primary)' }}
      >
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
            onChange={(e) => {
              const aiTimeoutSeconds = parseFiniteIntegerInput(e.target.value);
              if (aiTimeoutSeconds === null) {
                return;
              }
              onSettingsChange({
                aiTimeout: aiTimeoutSeconds * TIMEOUT.MS_PER_SEC,
              });
            }}
            className="w-full theme-input tabular-nums"
            min={TIMEOUT.MIN_AI_SECONDS}
            max={TIMEOUT.MAX_AI_SECONDS}
          />
        </div>

        <div>
          <h3 className="text-base font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
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
                <span className="text-xs ml-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {t('options.recommended')}: {DOM_ANALYSIS_DEFAULTS.initialDepth}
                </span>
              </label>
              <input
                type="number"
                value={
                  settings.domAnalysisConfig?.initialDepth || DOM_ANALYSIS_DEFAULTS.initialDepth
                }
                onChange={(e) => {
                  const initialDepth = parseFiniteIntegerInput(e.target.value);
                  if (initialDepth === null) {
                    return;
                  }
                  onSettingsChange({
                    domAnalysisConfig: {
                      initialDepth,
                    },
                  });
                }}
                className="w-full theme-input tabular-nums"
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
                <span className="text-xs ml-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {t('options.recommended')}: {DOM_ANALYSIS_DEFAULTS.expandDepth}
                </span>
              </label>
              <input
                type="number"
                value={settings.domAnalysisConfig?.expandDepth || DOM_ANALYSIS_DEFAULTS.expandDepth}
                onChange={(e) => {
                  const expandDepth = parseFiniteIntegerInput(e.target.value);
                  if (expandDepth === null) {
                    return;
                  }
                  onSettingsChange({
                    domAnalysisConfig: {
                      expandDepth,
                    },
                  });
                }}
                className="w-full theme-input tabular-nums"
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
                <span className="text-xs ml-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {t('options.recommended')}: {DOM_ANALYSIS_DEFAULTS.maxDepth}
                </span>
              </label>
              <input
                type="number"
                value={settings.domAnalysisConfig?.maxDepth || DOM_ANALYSIS_DEFAULTS.maxDepth}
                onChange={(e) => {
                  const maxDepth = parseFiniteIntegerInput(e.target.value);
                  if (maxDepth === null) {
                    return;
                  }
                  onSettingsChange({
                    domAnalysisConfig: {
                      maxDepth,
                    },
                  });
                }}
                className="w-full theme-input tabular-nums"
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
          <div className="mb-2 flex items-center">
            <input
              type="checkbox"
              id="developerMode"
              checked={settings.developerMode || false}
              onChange={(e) => onSettingsChange({ developerMode: e.target.checked })}
              className="h-4 w-4 rounded"
              style={{ borderColor: 'var(--border-primary)' }}
            />
            <label
              htmlFor="developerMode"
              className="ml-2 block text-sm font-medium cursor-pointer"
              style={{ color: 'var(--text-primary)' }}
            >
              {t('options.developerMode')}
            </label>
          </div>
          <p className="text-xs ml-6 mb-4" style={{ color: 'var(--text-muted)' }}>
            {t('options.developerModeHint')}
          </p>

          {settings.developerMode && (
            <div
              className="ml-6 mt-4 p-4 rounded-xl border"
              style={{
                borderColor: 'var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
              }}
            >
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                {t('options.outputLevel', 'Log Output Level')}
              </label>
              <select
                value={logLevel}
                onChange={handleLogLevelChange}
                className="w-full theme-input"
              >
                {LOG_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(LOG_LEVEL_LABELS[level])}
                  </option>
                ))}
              </select>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {t(
                  'options.outputLevelHint',
                  'Controls the minimum severity level for system logs',
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
