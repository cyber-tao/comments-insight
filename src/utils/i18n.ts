import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES } from '@/config/constants';
import zhCN from '../locales/zh-CN.json';
import enUS from '../locales/en-US.json';

/**
 * Map of language codes to their translation resources
 * To add a new language:
 * 1. Create the locale file in src/locales/
 * 2. Import it here
 * 3. Add it to this map
 * 4. Add the language code to LANGUAGES.SUPPORTED in constants.ts
 */
const resources: Record<string, { translation: Record<string, unknown> }> = {
  'zh-CN': { translation: zhCN },
  'en-US': { translation: enUS },
};

/** Get list of supported language codes */
const supportedCodes: string[] = LANGUAGES.SUPPORTED.map((l) => l.code);

/**
 * Detect browser language and map to supported language
 */
const getBrowserLanguage = (): string => {
  const browserLang = navigator.language || LANGUAGES.DEFAULT;

  // Check for exact match first
  if (supportedCodes.includes(browserLang)) {
    return browserLang;
  }

  // Check for language prefix match (e.g., 'zh' matches 'zh-CN')
  const langPrefix = browserLang.split('-')[0];
  const match = supportedCodes.find((code) => code.startsWith(langPrefix));

  return match || LANGUAGES.DEFAULT;
};

// Initialize i18next
i18n.use(initReactI18next).init({
  resources,
  lng: getBrowserLanguage(),
  fallbackLng: LANGUAGES.FALLBACK,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
