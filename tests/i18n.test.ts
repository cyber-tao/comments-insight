/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGES, normalizeLanguageSetting, resolveLocale } from '../src/config/constants/ui';

describe('i18n configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('navigator', { language: 'en-US' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['en-GB', 'en-US'],
    ['zh-SG', 'zh-CN'],
    ['zh-Hans-TW', 'zh-CN'],
    ['zh-HK', 'zh-TW'],
    ['zh_Hant_MO', 'zh-TW'],
    ['ko', 'ko-KR'],
    ['pt', 'pt-PT'],
    ['fr-CA', 'fr-FR'],
    ['pt-PT', 'pt-PT'],
    ['unavailable-locale', 'en-US'],
  ])('resolves %s to %s', (input, expected) => {
    expect(resolveLocale(input)).toBe(expected);
  });

  it('resolves system language using navigator.language and preserves system setting on normalization', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    expect(resolveLocale('system')).toBe('zh-CN');
    expect(normalizeLanguageSetting('system')).toBe('system');
    expect(normalizeLanguageSetting('')).toBe('system');
    expect(normalizeLanguageSetting('zh-HK')).toBe('zh-TW');
  });

  it('loads the complete catalog for each supported locale', async () => {
    const { default: i18n, changeLanguage } = await import('../src/utils/i18n');
    for (const { code } of LANGUAGES.SUPPORTED) {
      await changeLanguage(code);
      expect(i18n.resolvedLanguage).toBe(code);
      expect(i18n.hasResourceBundle(code, 'translation')).toBe(true);
      expect(document.documentElement.lang).toBe(code);
    }
  });

  it('localizes the document on browser-language startup and settings change', async () => {
    vi.stubGlobal('navigator', { language: 'zh-Hant-HK' });
    window.history.replaceState(null, '', '/src/options/index.html');
    const { default: i18n, changeLanguage } = await import('../src/utils/i18n');
    expect(i18n.resolvedLanguage).toBe('zh-TW');
    expect(document.documentElement.lang).toBe('zh-TW');
    expect(document.title).toContain('設定');

    await changeLanguage('pt_PT');
    expect(document.documentElement.lang).toBe('pt-PT');
    expect(document.title).toContain('Definições');
  });
});
