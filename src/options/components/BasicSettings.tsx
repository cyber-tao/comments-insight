import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, UI_LIMITS } from '@/config/constants';
import { Settings } from '@/types';
import i18n from '@/utils/i18n';

interface BasicSettingsProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

export const BasicSettings: React.FC<BasicSettingsProps> = ({ settings, onSettingsChange }) => {
  const { t } = useTranslation();

  return (
    <section className="mb-8 bg-white p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">{t('options.basicSettings')}</h2>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">{t('options.maxComments')}</label>
        <input
          type="number"
          value={settings.maxComments}
          onChange={(e) => onSettingsChange({ ...settings, maxComments: parseInt(e.target.value) })}
          className="w-full px-3 py-2 border rounded"
          min={UI_LIMITS.MAX_COMMENTS_MIN}
          max={UI_LIMITS.MAX_COMMENTS_MAX}
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">{t('options.language')}</label>
        <select
          value={settings.language}
          onChange={(e) => {
            const newLang = e.target.value;
            onSettingsChange({ ...settings, language: newLang });
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

      <div className="mb-4 flex items-start gap-2">
        <input
          type="checkbox"
          id="normalizeTimestamps"
          checked={settings.normalizeTimestamps}
          onChange={(e) => onSettingsChange({ ...settings, normalizeTimestamps: e.target.checked })}
          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <div>
          <label htmlFor="normalizeTimestamps" className="text-sm font-medium">
            {t('options.normalizeTimestamps')}
          </label>
          <p className="text-xs text-gray-500 mt-1">{t('options.normalizeTimestampsHint')}</p>
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
          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
        />
        <div>
          <label htmlFor="exportPostContentInMarkdown" className="text-sm font-medium">
            {t('options.exportPostContentInMarkdown')}
          </label>
          <p className="text-xs text-gray-500 mt-1">
            {t('options.exportPostContentInMarkdownHint')}
          </p>
        </div>
      </div>
    </section>
  );
};
