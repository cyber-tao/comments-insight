import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, UI_LIMITS, THEME } from '@/config/constants';
import { Settings } from '@/types';
import i18n from '@/utils/i18n';

interface BasicSettingsProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onThemeChange?: (theme: 'light' | 'dark' | 'system') => void;
}

export const BasicSettings: React.FC<BasicSettingsProps> = ({
  settings,
  onSettingsChange,
  onThemeChange,
}) => {
  const { t } = useTranslation();

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    onSettingsChange({ ...settings, theme: newTheme });
    onThemeChange?.(newTheme);
  };

  return (
    <section className="mb-8 theme-card p-6">
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
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
          onChange={(e) => onSettingsChange({ ...settings, maxComments: parseInt(e.target.value) })}
          className="w-full theme-input"
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
          value={settings.language}
          onChange={(e) => {
            const newLang = e.target.value;
            onSettingsChange({ ...settings, language: newLang });
            i18n.changeLanguage(newLang);
          }}
          className="w-full theme-input"
        >
          {LANGUAGES.SUPPORTED.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-4">
        <label
          className="block text-sm font-medium mb-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          {t('options.theme')}
        </label>
        <div className="flex gap-2">
          {THEME.OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => handleThemeChange(option.value as 'light' | 'dark' | 'system')}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                settings.theme === option.value
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'theme-button-secondary'
              }`}
            >
              {option.value === 'light' && '☀️ '}
              {option.value === 'dark' && '🌙 '}
              {option.value === 'system' && '💻 '}
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex items-start gap-2">
        <input
          type="checkbox"
          id="normalizeTimestamps"
          checked={settings.normalizeTimestamps}
          onChange={(e) => onSettingsChange({ ...settings, normalizeTimestamps: e.target.checked })}
          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 rounded"
          style={{ borderColor: 'var(--border-primary)' }}
        />
        <div>
          <label
            htmlFor="normalizeTimestamps"
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            {t('options.normalizeTimestamps')}
          </label>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('options.normalizeTimestampsHint')}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          id="exportPostContentInMarkdown"
          checked={settings.exportPostContentInMarkdown}
          onChange={(e) =>
            onSettingsChange({ ...settings, exportPostContentInMarkdown: e.target.checked })
          }
          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 rounded"
          style={{ borderColor: 'var(--border-primary)' }}
        />
        <div>
          <label
            htmlFor="exportPostContentInMarkdown"
            className="text-sm font-medium"
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
