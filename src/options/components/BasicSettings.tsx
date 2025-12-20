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
    </section>
  );
};
