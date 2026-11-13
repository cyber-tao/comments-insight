import * as React from 'react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, UI_LIMITS, THEME } from '@/config/constants';
import { Settings, SettingsPatch } from '@/types';
import { changeLanguage } from '@/utils/i18n';
import { parseFiniteIntegerInput } from '@/utils/number';
import { MonitorIcon, MoonIcon, SunIcon } from '@/components/Icons';

interface BasicSettingsProps {
  settings: Settings;
  onSettingsChange: (settings: SettingsPatch) => void;
  onThemeChange?: (theme: 'light' | 'dark' | 'system') => void;
}

export const BasicSettings: React.FC<BasicSettingsProps> = ({
  settings,
  onSettingsChange,
  onThemeChange,
}) => {
  const { t } = useTranslation();

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    onSettingsChange({ theme: newTheme });
    onThemeChange?.(newTheme);
  };

  const handleMaxCommentsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const maxComments = parseFiniteIntegerInput(e.target.value);
      if (maxComments === null) {
        return;
      }
      onSettingsChange({ maxComments });
    },
    [onSettingsChange],
  );

  return (
    <section className="mb-8 theme-card p-6">
      <h2
        className="text-lg font-bold mb-4 font-serif-editorial"
        style={{ color: 'var(--text-primary)' }}
      >
        {t('options.basicSettings')}
      </h2>

      <div className="mb-4">
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          {t('options.maxComments')}
        </label>
        <input
          type="number"
          value={settings.maxComments}
          onChange={handleMaxCommentsChange}
          className="w-full theme-input tabular-nums"
          min={UI_LIMITS.MAX_COMMENTS_MIN}
          max={UI_LIMITS.MAX_COMMENTS_MAX}
        />
      </div>

      <div className="mb-4">
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          {t('options.language')}
        </label>
        <select
          value={settings.language || LANGUAGES.DEFAULT}
          onChange={(e) => {
            const newLang = e.target.value;
            onSettingsChange({ language: newLang });
            void changeLanguage(newLang);
          }}
          className="w-full theme-input"
        >
          <option value={LANGUAGES.SYSTEM}>{t('options.themeSystem')}</option>
          {LANGUAGES.SUPPORTED.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-5">
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          {t('options.theme')}
        </label>
        <div
          className="grid grid-cols-3 gap-2 p-1 rounded-xl"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          {THEME.OPTIONS.map((option) => {
            const isActive = settings.theme === option.value;
            return (
              <button
                key={option.value}
                onClick={() => handleThemeChange(option.value as 'light' | 'dark' | 'system')}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
                style={{
                  backgroundColor: isActive ? 'var(--bg-card)' : 'transparent',
                  color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                  border: isActive ? '1px solid var(--border-primary)' : '1px solid transparent',
                }}
              >
                {option.value === 'light' && <SunIcon size={15} />}
                {option.value === 'dark' && <MoonIcon size={15} />}
                {option.value === 'system' && <MonitorIcon size={15} />}
                <span>{t(option.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4 flex items-start gap-2.5">
        <input
          type="checkbox"
          id="normalizeTimestamps"
          checked={settings.normalizeTimestamps}
          onChange={(e) => onSettingsChange({ normalizeTimestamps: e.target.checked })}
          className="mt-1 h-4 w-4 rounded"
          style={{ borderColor: 'var(--border-primary)' }}
        />
        <div>
          <label
            htmlFor="normalizeTimestamps"
            className="text-sm font-medium cursor-pointer"
            style={{ color: 'var(--text-primary)' }}
          >
            {t('options.normalizeTimestamps')}
          </label>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('options.normalizeTimestampsHint')}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          id="exportPostContentInMarkdown"
          checked={settings.exportPostContentInMarkdown}
          onChange={(e) => onSettingsChange({ exportPostContentInMarkdown: e.target.checked })}
          className="mt-1 h-4 w-4 rounded"
          style={{ borderColor: 'var(--border-primary)' }}
        />
        <div>
          <label
            htmlFor="exportPostContentInMarkdown"
            className="text-sm font-medium cursor-pointer"
            style={{ color: 'var(--text-primary)' }}
          >
            {t('options.exportPostContentInMarkdown')}
          </label>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('options.exportPostContentInMarkdownHint')}
          </p>
        </div>
      </div>
    </section>
  );
};
