/**
 * @vitest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../src/config/constants';
import { useSettings } from '../src/options/hooks/useSettings';
import type { Settings } from '../src/types';

const extensionApiMock = vi.hoisted(() => ({
  exportSettings: vi.fn(),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  ToastContainer: () => null,
  error: vi.fn(),
  success: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
}));

const i18nMock = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
}));

const translationMock = vi.hoisted(() => ({
  t: (key: string, options?: Record<string, unknown>) => {
    if (key === 'options.loadSettingsError') {
      return `Failed to load settings: ${String(options?.message)}`;
    }
    return key;
  },
}));

vi.mock('../src/utils/extension-api', () => ({
  ExtensionAPI: extensionApiMock,
}));

vi.mock('../src/hooks/useToast', () => ({
  useToast: () => toastMock,
}));

vi.mock('../src/utils/logger', () => ({
  Logger: loggerMock,
}));

vi.mock('../src/utils/i18n', () => ({
  default: i18nMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => translationMock,
}));

function createSettings(): Settings {
  return {
    maxComments: 100,
    aiModel: {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      contextWindowSize: 131072,
      maxOutputTokens: 4096,
      temperature: 0.8,
      topP: 0.95,
    },
    aiTimeout: 120000,
    analyzerPromptTemplate: 'Analyze comments',
    language: 'en-US',
    theme: 'system',
    normalizeTimestamps: true,
    exportPostContentInMarkdown: false,
    selectorRetryAttempts: 3,
    selectorCache: [
      {
        domain: 'youtube.com',
        selectors: { commentContainer: '.comment' },
        lastUsed: Date.now(),
        successCount: 1,
      },
    ],
    crawlingConfigs: [],
    domAnalysisConfig: {
      initialDepth: 3,
      expandDepth: 2,
      maxDepth: 10,
    },
    developerMode: false,
  };
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe('useSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    extensionApiMock.getSettings.mockResolvedValue(createSettings());
    extensionApiMock.saveSettings.mockResolvedValue({ success: true });
    extensionApiMock.exportSettings.mockResolvedValue('{"maxComments":100}');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads settings and applies language without auto-saving initial state', async () => {
    const { result } = renderHook(() => useSettings());

    await act(async () => {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(TIMING.MICRO_WAIT_MS);
    });

    expect(result.current.settings).toMatchObject({
      maxComments: 100,
      language: 'en-US',
    });
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('en-US');
    expect(extensionApiMock.saveSettings).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
  });

  it('debounces user changes and saves settings without selector cache', async () => {
    const { result } = renderHook(() => useSettings());

    await act(async () => {
      await flushMicrotasks();
    });

    expect(result.current.settings).toMatchObject({
      maxComments: 100,
      developerMode: false,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.MICRO_WAIT_MS);
    });

    await act(async () => {
      result.current.handleSettingsChange({ maxComments: 250, developerMode: true });
      await flushMicrotasks();
    });

    expect(result.current.settings).toMatchObject({
      maxComments: 250,
      developerMode: true,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
      await Promise.resolve();
    });

    expect(extensionApiMock.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        maxComments: 250,
        developerMode: true,
      }),
    );
    expect(extensionApiMock.saveSettings.mock.calls[0][0]).not.toHaveProperty('selectorCache');
    expect(toastMock.success).toHaveBeenCalledWith('options.savedSuccess');
    expect(result.current.saving).toBe(false);
  });

  it('does not reload settings on rerender after a user edit', async () => {
    const { result, rerender } = renderHook(() => useSettings());

    await act(async () => {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(TIMING.MICRO_WAIT_MS);
    });

    expect(extensionApiMock.getSettings).toHaveBeenCalledOnce();

    await act(async () => {
      result.current.handleSettingsChange({ maxComments: 250 });
      await flushMicrotasks();
    });

    rerender();

    expect(result.current.settings).toMatchObject({
      maxComments: 250,
    });
    expect(extensionApiMock.getSettings).toHaveBeenCalledOnce();
  });

  it('shows error toast when saving fails', async () => {
    extensionApiMock.saveSettings.mockResolvedValue({ success: false, error: 'boom' });
    const { result } = renderHook(() => useSettings());

    await act(async () => {
      await flushMicrotasks();
    });

    expect(result.current.settings).toMatchObject({
      maxComments: 100,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.MICRO_WAIT_MS);
    });

    await act(async () => {
      result.current.handleSettingsChange({ maxComments: 300 });
      await flushMicrotasks();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
      await Promise.resolve();
    });

    expect(toastMock.error).toHaveBeenCalledWith('options.savedError: boom');
    expect(result.current.saving).toBe(false);
  });

  it('exports settings through a download link and shows success toast', async () => {
    const { result } = renderHook(() => useSettings());
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.fn();
    const anchor = {
      click: clickSpy,
      href: '',
      download: '',
    } as unknown as HTMLAnchorElement;
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor);

    await act(async () => {
      await result.current.handleExport();
    });

    expect(extensionApiMock.exportSettings).toHaveBeenCalledOnce();
    expect(createObjectURLSpy).toHaveBeenCalledOnce();
    expect(anchor.href).toBe('blob:test');
    expect(anchor.download).toContain('comments-insight-settings-');
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test');
    expect(toastMock.success).toHaveBeenCalledWith('options.exportSettings common.save');

    createElementSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });
});