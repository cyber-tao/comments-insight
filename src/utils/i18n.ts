import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES, PATHS, resolveLocale, type LocaleCode } from '@/config/constants/ui';
import enUS from '../locales/en-US.json';
import esES from '../locales/es-ES.json';
import frFR from '../locales/fr-FR.json';
import jaJP from '../locales/ja-JP.json';
import koKR from '../locales/ko-KR.json';
import ptPT from '../locales/pt-PT.json';
import zhCN from '../locales/zh-CN.json';
import zhTW from '../locales/zh-TW.json';

// MV3 service workers cannot load language chunks using dynamic import.
const resources: Record<LocaleCode, { translation: Record<string, unknown> }> = {
  'en-US': { translation: enUS },
  'es-ES': { translation: esES },
  'fr-FR': { translation: frFR },
  'ja-JP': { translation: jaJP },
  'ko-KR': { translation: koKR },
  'pt-PT': { translation: ptPT },
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW },
};

const initialLanguage = resolveLocale(
  typeof navigator === 'undefined' ? undefined : navigator.language,
);
const i18n = createInstance();

const pageTitleKeys: Partial<Record<string, string>> = {
  [PATHS.HISTORY_PAGE]: 'history.title',
  [PATHS.OPTIONS_PAGE]: 'options.title',
  [PATHS.LOGS_PAGE]: 'logs.title',
};

i18n.on('languageChanged', (language) => {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  const path = document.location.pathname.slice(1);
  const pageTitleKey = pageTitleKeys[path];
  if (pageTitleKey) {
    document.title = i18n.t('common.pageTitle', {
      pageName: i18n.t(pageTitleKey),
      appName: i18n.t('common.appName'),
    });
  } else if (path === 'src/popup/index.html') {
    document.title = i18n.t('common.appName');
  }
});

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: LANGUAGES.FALLBACK,
  supportedLngs: LANGUAGES.SUPPORTED.map(({ code }) => code),
  showSupportNotice: false,
  interpolation: {
    escapeValue: false,
  },
});

export async function changeLanguage(language: string): Promise<void> {
  await i18n.changeLanguage(resolveLocale(language));
}

export default i18n;
export const t = i18n.t.bind(i18n);
