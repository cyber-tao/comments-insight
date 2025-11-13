import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from '../locales/zh-CN.json';
import enUS from '../locales/en-US.json';

// Get browser language
const getBrowserLanguage = (): string => {
  const lang = navigator.language || 'en-US';
  if (lang.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
};

// Initialize i18next
i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': {
      translation: zhCN,
    },
    'en-US': {
      translation: enUS,
    },
  },
  lng: getBrowserLanguage(),
  fallbackLng: 'en-US',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
