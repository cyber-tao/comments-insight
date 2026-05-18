import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGUAGES } from '@/config/constants';
import enUS from '../locales/en-US.json';
import zhCN from '../locales/zh-CN.json';

/**
 * Built-in synchronous resources cover the default + fallback languages so
 * that any consumer (including the service worker) can call `i18n.t(...)`
 * synchronously the moment this module is loaded.
 *
 * Other supported locales are split into separate chunks via dynamic imports
 * to keep the popup/options/history bundles small. They are loaded lazily on
 * the first request via `loadLocaleResource` and registered through
 * `addResourceBundle` without re-initialising i18next.
 */
const builtInResources: Record<string, { translation: Record<string, unknown> }> = {
  'en-US': { translation: enUS },
  'zh-CN': { translation: zhCN },
};

const lazyLoaders: Record<string, () => Promise<Record<string, unknown>>> = {
  'ja-JP': () => import('../locales/ja-JP.json').then((mod) => mod.default),
  'fr-FR': () => import('../locales/fr-FR.json').then((mod) => mod.default),
  'es-ES': () => import('../locales/es-ES.json').then((mod) => mod.default),
};

const supportedCodes: string[] = LANGUAGES.SUPPORTED.map((l) => l.code);
const loadedLazyLocales = new Set<string>(Object.keys(builtInResources));
const inflightLoads = new Map<string, Promise<void>>();

const getBrowserLanguage = (): string => {
  const browserLang = (typeof navigator !== 'undefined' && navigator.language) || LANGUAGES.DEFAULT;
  if (supportedCodes.includes(browserLang)) {
    return browserLang;
  }
  const langPrefix = browserLang.split('-')[0];
  const match = supportedCodes.find((code) => code.startsWith(langPrefix));
  return match || LANGUAGES.DEFAULT;
};

i18n.use(initReactI18next).init({
  resources: builtInResources,
  lng: getBrowserLanguage(),
  fallbackLng: LANGUAGES.FALLBACK,
  interpolation: {
    escapeValue: false,
  },
});

export async function loadLocaleResource(lng: string): Promise<void> {
  if (loadedLazyLocales.has(lng)) {
    return;
  }
  const loader = lazyLoaders[lng];
  if (!loader) {
    return;
  }
  const existing = inflightLoads.get(lng);
  if (existing) {
    return existing;
  }
  const task = loader()
    .then((translation) => {
      i18n.addResourceBundle(lng, 'translation', translation, true, true);
      loadedLazyLocales.add(lng);
    })
    .finally(() => {
      inflightLoads.delete(lng);
    });
  inflightLoads.set(lng, task);
  return task;
}

export async function changeLanguage(lng: string): Promise<void> {
  await loadLocaleResource(lng);
  await i18n.changeLanguage(lng);
}

// Pre-load the active locale if it is not bundled synchronously (e.g. ja-JP).
const activeLng = i18n.language;
if (activeLng && !loadedLazyLocales.has(activeLng)) {
  void loadLocaleResource(activeLng);
}

export default i18n;
export const t = i18n.t.bind(i18n);
