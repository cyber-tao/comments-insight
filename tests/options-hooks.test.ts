/**
 * @vitest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent } from 'react';
import { STORAGE, TIMING } from '../src/config/constants';
import { useConfigImport } from '../src/options/hooks/useConfigImport';
import { useSettings } from '../src/options/hooks/useSettings';
import type { CrawlingConfig, Settings } from '../src/types';
import {
  ErrorCode,
  ExtensionError,
  fromExtensionErrorPayload,
  toExtensionErrorPayload,
} from '../src/utils/error-types';

const extensionApiMock = vi.hoisted(() => ({
  exportSettings: vi.fn(),
  getSettings: vi.fn(),
  importSettings: vi.fn(),
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
  t: vi.fn((key: string) => key),
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
  changeLanguage: i18nMock.changeLanguage,
  loadLocaleResource: vi.fn(async () => undefined),
  t: i18nMock.t ?? ((key: string) => key),
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
      contextWindowSize: 200000,
      maxOutputTokens: 4096,
      protocol: 'openai-chat-completions',
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
    disabledDefaultConfigDomains: [],
    domAnalysisConfig: {
      initialDepth: 3,
      expandDepth: 2,
      maxDepth: 10,
    },
    developerMode: false,
  };
}

function createCrawlingConfig(domain: string, siteName = domain): CrawlingConfig {
  return {
    id: `config_${domain}`,
    domain,
    siteName,
    container: { selector: '.comments', type: 'css' },
    item: { selector: '.comment', type: 'css' },
    fields: [
      { name: 'username', rule: { selector: '.author', type: 'css' } },
      { name: 'content', rule: { selector: '.content', type: 'css' } },
    ],
    lastUpdated: 1,
  };
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

type SettingsChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;
const settingsChangeListeners: SettingsChangeListener[] = [];

describe('useSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    settingsChangeListeners.length = 0;
    vi.stubGlobal('chrome', {
      storage: {
        onChanged: {
          addListener: vi.fn((listener: SettingsChangeListener) =>
            settingsChangeListeners.push(listener),
          ),
          removeListener: vi.fn(),
        },
      },
    });
    extensionApiMock.getSettings.mockResolvedValue(createSettings());
    extensionApiMock.importSettings.mockResolvedValue({ success: true });
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
    expect(extensionApiMock.saveSettings.mock.calls[0][0]).toEqual({
      maxComments: 250,
      developerMode: true,
    });
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

  it('sends only nested edits and protects rule replacement with the loaded fingerprint', async () => {
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(TIMING.MICRO_WAIT_MS);
    });
    await act(async () => {
      result.current.handleSettingsChange({ aiModel: { maxOutputTokens: 2048 } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenLastCalledWith({
      aiModel: { maxOutputTokens: 2048 },
    });
    expect(result.current.settings?.aiModel.model).toBe('gpt-4o-mini');
    await act(async () => {
      result.current.handleSettingsChange({
        crawlingConfigs: [createCrawlingConfig('new.example.com')],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenLastCalledWith(
      { crawlingConfigs: [expect.objectContaining({ domain: 'new.example.com' })] },
      '[]',
    );
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

  it('saves the latest settings when changes happen during an in-flight save', async () => {
    let resolveFirstSave: ((value: { success: boolean }) => void) | undefined;
    extensionApiMock.saveSettings
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstSave = resolve;
        }),
      )
      .mockResolvedValue({ success: true });

    const { result } = renderHook(() => useSettings());

    await act(async () => {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(TIMING.MICRO_WAIT_MS);
    });

    await act(async () => {
      result.current.handleSettingsChange({ maxComments: 200 });
      await flushMicrotasks();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
      await flushMicrotasks();
    });

    expect(extensionApiMock.saveSettings).toHaveBeenCalledTimes(1);
    expect(extensionApiMock.saveSettings.mock.calls[0][0]).toMatchObject({ maxComments: 200 });

    await act(async () => {
      result.current.handleSettingsChange({ maxComments: 300 });
      await flushMicrotasks();
    });

    await act(async () => {
      resolveFirstSave?.({ success: true });
      await flushMicrotasks();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
      await flushMicrotasks();
    });

    expect(extensionApiMock.saveSettings).toHaveBeenCalledTimes(2);
    expect(extensionApiMock.saveSettings.mock.calls[1][0]).toMatchObject({ maxComments: 300 });
  });

  it('shows error toast when loading settings fails', async () => {
    extensionApiMock.getSettings.mockRejectedValue(new Error('storage unavailable'));

    renderHook(() => useSettings());

    await act(async () => {
      await flushMicrotasks();
    });

    expect(toastMock.error).toHaveBeenCalledWith('Failed to load settings: storage unavailable');
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

  it('imports settings through the background validation path and reloads settings', async () => {
    const importedSettings = { ...createSettings(), maxComments: 200 };
    extensionApiMock.getSettings
      .mockResolvedValueOnce(createSettings())
      .mockResolvedValueOnce(importedSettings);
    const fileReaderResult = '{"maxComments":200}';
    class MockFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsText(): void {
        this.onload?.({ target: { result: fileReaderResult } } as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);

    const { result } = renderHook(() => useSettings());

    await act(async () => {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(TIMING.MICRO_WAIT_MS);
    });

    await act(async () => {
      result.current.handleImport({
        target: { files: [new File([fileReaderResult], 'settings.json')] },
      } as unknown as ChangeEvent<HTMLInputElement>);
      await flushMicrotasks();
    });

    expect(extensionApiMock.importSettings).toHaveBeenCalledWith(fileReaderResult);
    expect(result.current.settings?.maxComments).toBe(200);
    expect(toastMock.success).toHaveBeenCalledWith('options.importedSuccess');
    expect(extensionApiMock.saveSettings).not.toHaveBeenCalled();
  });

  it('shows import error when background validation rejects imported settings', async () => {
    const fileReaderResult = '{"maxComments":"bad"}';
    extensionApiMock.importSettings.mockRejectedValueOnce(new Error('Invalid settings format'));
    class MockFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;

      readAsText(): void {
        this.onload?.({ target: { result: fileReaderResult } } as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);

    const { result } = renderHook(() => useSettings());

    await act(async () => {
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(TIMING.MICRO_WAIT_MS);
    });

    await act(async () => {
      result.current.handleImport({
        target: { files: [new File([fileReaderResult], 'settings.json')] },
      } as unknown as ChangeEvent<HTMLInputElement>);
      await flushMicrotasks();
    });

    expect(extensionApiMock.importSettings).toHaveBeenCalledWith(fileReaderResult);
    expect(toastMock.error).toHaveBeenCalledWith('options.importError');
  });
  it('binds model-only edits to their source endpoint and shows conflicts decoded from real messages', async () => {
    const conflict = new ExtensionError(ErrorCode.VALIDATION_ERROR, 'AI endpoint changed', {
      messageKey: 'options.settingsConflict',
    });
    extensionApiMock.saveSettings.mockRejectedValueOnce(
      fromExtensionErrorPayload(toExtensionErrorPayload(conflict)),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => result.current.handleSettingsChange({ aiModel: { model: 'old-endpoint-result' } }));
    act(() =>
      settingsChangeListeners[0](
        {
          [STORAGE.SETTINGS_KEY]: {
            newValue: { aiModel: { apiUrl: 'https://second.example/v1' } },
          },
        },
        'local',
      ),
    );
    toastMock.error.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenCalledWith(
      { aiModel: { model: 'old-endpoint-result' } },
      undefined,
      'https://api.example.com',
      'openai-chat-completions',
    );
    expect(toastMock.error).toHaveBeenCalledExactlyOnceWith('options.settingsConflict');
    expect(result.current.settings?.aiModel.apiUrl).toBe('https://api.example.com');
    expect(result.current.hasExternalConflict).toBe(true);
  });

  it('refreshes a storage update received during a save once the page has no dirty edits', async () => {
    let resolveSave!: (response: { success: boolean }) => void;
    extensionApiMock.saveSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const second = {
      ...createSettings(),
      maxComments: 200,
      aiModel: { ...createSettings().aiModel, apiUrl: 'https://second.example/v1', apiKey: '' },
    };
    extensionApiMock.getSettings
      .mockResolvedValueOnce(createSettings())
      .mockResolvedValueOnce(second);
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => result.current.handleSettingsChange({ maxComments: 200 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    act(() =>
      settingsChangeListeners[0]({ [STORAGE.SETTINGS_KEY]: { newValue: second } }, 'local'),
    );
    expect(extensionApiMock.getSettings).toHaveBeenCalledOnce();
    await act(async () => {
      resolveSave({ success: true });
      await flushMicrotasks(8);
    });
    expect(extensionApiMock.getSettings).toHaveBeenCalledTimes(2);
    expect(result.current.settings?.aiModel).toMatchObject({
      apiUrl: 'https://second.example/v1',
      apiKey: '',
    });
  });

  it('preserves and reports a remaining dirty draft when storage changes during an in-flight save', async () => {
    let resolveSave!: (response: { success: boolean }) => void;
    extensionApiMock.saveSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => result.current.handleSettingsChange({ maxComments: 200 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    act(() => result.current.handleSettingsChange({ aiModel: { model: 'unsaved-model' } }));
    act(() =>
      settingsChangeListeners[0](
        {
          [STORAGE.SETTINGS_KEY]: {
            newValue: { aiModel: { apiUrl: 'https://second.example/v1' } },
          },
        },
        'local',
      ),
    );
    await act(async () => {
      resolveSave({ success: true });
      await flushMicrotasks();
    });
    expect(result.current.settings?.aiModel).toMatchObject({
      apiUrl: 'https://api.example.com',
      model: 'unsaved-model',
    });
    expect(result.current.hasExternalConflict).toBe(true);
    expect(toastMock.error).toHaveBeenCalledWith('options.settingsConflict');
    expect(extensionApiMock.getSettings).toHaveBeenCalledOnce();
  });

  it('allows retrying the same selected file after a reader error', async () => {
    let attempts = 0;
    class MockFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: (() => void) | null = null;
      readAsText() {
        attempts += 1;
        if (attempts === 1) this.onerror?.();
        else
          this.onload?.({ target: { result: '{"maxComments":500}' } } as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);
    extensionApiMock.getSettings
      .mockResolvedValueOnce(createSettings())
      .mockResolvedValueOnce({ ...createSettings(), maxComments: 500 });
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    const input = { files: [new File(['{}'], 'same-settings.json')], value: 'same-settings.json' };
    await act(async () => {
      result.current.handleImport({ target: input } as unknown as ChangeEvent<HTMLInputElement>);
      await flushMicrotasks();
    });
    expect(input.value).toBe('');
    expect(extensionApiMock.importSettings).not.toHaveBeenCalled();
    await act(async () => {
      result.current.handleImport({ target: input } as unknown as ChangeEvent<HTMLInputElement>);
      await flushMicrotasks(8);
    });
    expect(attempts).toBe(2);
    expect(extensionApiMock.importSettings).toHaveBeenCalledOnce();
    expect(result.current.settings?.maxComments).toBe(500);
  });

  it('binds a key-only edit to the loaded endpoint', async () => {
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => result.current.handleSettingsChange({ aiModel: { apiKey: 'edited-key' } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenCalledWith(
      { aiModel: { apiKey: 'edited-key' } },
      undefined,
      'https://api.example.com',
      'openai-chat-completions',
    );
  });

  it('discards a key entered for the old endpoint in the same debounce batch when the URL changes', async () => {
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => {
      result.current.handleSettingsChange({ aiModel: { apiKey: 'old-endpoint-pending-key' } });
      result.current.handleSettingsChange({ aiModel: { apiUrl: 'https://second.example/v1' } });
    });
    expect(result.current.settings?.aiModel.apiKey).toBe('');
    expect(result.current.settings?.aiModel.model).toBe('');
    expect(result.current.settings?.aiModel.maxOutputTokens).toBe(4096);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenCalledWith(
      { aiModel: { apiUrl: 'https://second.example/v1', apiKey: '', model: '' } },
      undefined,
      'https://api.example.com',
      'openai-chat-completions',
    );
  });

  it('binds a protocol edit to the saved protocol and preserves the current key and model', async () => {
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => result.current.handleSettingsChange({ aiModel: { protocol: 'openai-responses' } }));
    expect(result.current.settings?.aiModel).toMatchObject({
      protocol: 'openai-responses',
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenCalledExactlyOnceWith(
      { aiModel: { protocol: 'openai-responses' } },
      undefined,
      'https://api.example.com',
      'openai-chat-completions',
    );
  });

  it('advances the protocol precondition only after its in-flight save succeeds', async () => {
    let resolveSave!: (response: { success: boolean }) => void;
    extensionApiMock.saveSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => result.current.handleSettingsChange({ aiModel: { protocol: 'anthropic-messages' } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    act(() => result.current.handleSettingsChange({ aiModel: { model: 'second-model' } }));
    await act(async () => {
      resolveSave({ success: true });
      await flushMicrotasks();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenNthCalledWith(
      1,
      { aiModel: { protocol: 'anthropic-messages' } },
      undefined,
      'https://api.example.com',
      'openai-chat-completions',
    );
    expect(extensionApiMock.saveSettings).toHaveBeenNthCalledWith(
      2,
      { aiModel: { model: 'second-model' } },
      undefined,
      'https://api.example.com',
      'anthropic-messages',
    );
  });

  it('accepts a new key entered after the endpoint changed but keeps the source CAS endpoint', async () => {
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => {
      result.current.handleSettingsChange({ aiModel: { apiUrl: 'https://second.example/v1' } });
      result.current.handleSettingsChange({ aiModel: { apiKey: 'new-endpoint-key' } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenCalledWith(
      { aiModel: { apiUrl: 'https://second.example/v1', apiKey: 'new-endpoint-key', model: '' } },
      undefined,
      'https://api.example.com',
      'openai-chat-completions',
    );
  });

  it('preserves a pending key for a normalized-equivalent URL', async () => {
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => {
      result.current.handleSettingsChange({ aiModel: { apiKey: 'same-endpoint-key' } });
      result.current.handleSettingsChange({
        aiModel: { apiUrl: ' https://API.example.com:443/ ' },
      });
    });
    expect(result.current.settings?.aiModel.apiKey).toBe('same-endpoint-key');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenCalledWith(
      { aiModel: { apiUrl: ' https://API.example.com:443/ ', apiKey: 'same-endpoint-key' } },
      undefined,
      'https://api.example.com',
      'openai-chat-completions',
    );
  });

  it('advances the endpoint precondition only after an in-flight URL save succeeds', async () => {
    let resolveSave!: (response: { success: boolean }) => void;
    extensionApiMock.saveSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() =>
      result.current.handleSettingsChange({ aiModel: { apiUrl: 'https://second.example/v1' } }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    act(() => result.current.handleSettingsChange({ aiModel: { apiKey: 'second-key' } }));
    await act(async () => {
      resolveSave({ success: true });
      await flushMicrotasks();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenNthCalledWith(
      1,
      { aiModel: { apiUrl: 'https://second.example/v1', apiKey: '', model: '' } },
      undefined,
      'https://api.example.com',
      'openai-chat-completions',
    );
    expect(extensionApiMock.saveSettings).toHaveBeenNthCalledWith(
      2,
      { aiModel: { apiKey: 'second-key' } },
      undefined,
      'https://second.example/v1',
      'openai-chat-completions',
    );
  });

  it('does not merge a failed old-key save into a pending new endpoint patch', async () => {
    let rejectSave!: (reason: Error) => void;
    extensionApiMock.saveSettings.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
    );
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => result.current.handleSettingsChange({ aiModel: { apiKey: 'old-key' } }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    act(() =>
      result.current.handleSettingsChange({ aiModel: { apiUrl: 'https://second.example/v1' } }),
    );
    await act(async () => {
      rejectSave(new Error('write failed'));
      await flushMicrotasks();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenLastCalledWith(
      { aiModel: { apiUrl: 'https://second.example/v1', apiKey: '', model: '' } },
      undefined,
      'https://api.example.com',
      'openai-chat-completions',
    );
  });

  it('refreshes clean state on storage changes but preserves dirty state and reports a conflict', async () => {
    const second = {
      ...createSettings(),
      maxComments: 400,
      aiModel: { ...createSettings().aiModel, apiUrl: 'https://second.example/v1', apiKey: '' },
    };
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    extensionApiMock.getSettings.mockResolvedValueOnce(second);
    await act(async () => {
      settingsChangeListeners[0]({ [STORAGE.SETTINGS_KEY]: { newValue: second } }, 'local');
      await flushMicrotasks();
    });
    expect(result.current.settings?.maxComments).toBe(400);
    act(() => result.current.handleSettingsChange({ aiModel: { apiKey: 'unsaved-second-key' } }));
    const calls = extensionApiMock.getSettings.mock.calls.length;
    act(() =>
      settingsChangeListeners[0](
        { [STORAGE.SETTINGS_KEY]: { newValue: createSettings() } },
        'local',
      ),
    );
    expect(extensionApiMock.getSettings).toHaveBeenCalledTimes(calls);
    expect(result.current.settings?.aiModel.apiKey).toBe('unsaved-second-key');
    expect(result.current.hasExternalConflict).toBe(true);
    expect(toastMock.error).toHaveBeenCalledWith('options.settingsConflict');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    expect(extensionApiMock.saveSettings).toHaveBeenCalledWith(
      { aiModel: { apiKey: 'unsaved-second-key' } },
      undefined,
      'https://second.example/v1',
      'openai-chat-completions',
    );
  });

  it('exposes load failure state and allows an explicit successful retry', async () => {
    extensionApiMock.getSettings.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.loadError).toBe('Failed to load settings: offline');
    expect(result.current.settings).toBeNull();
    await act(async () => {
      await result.current.retryLoad();
    });
    expect(result.current.settings?.maxComments).toBe(100);
    expect(result.current.loadError).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('exposes invalid initial responses as a retryable error instead of permanent loading', async () => {
    extensionApiMock.getSettings.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    expect(result.current.loadError).toBe('options.loadSettingsInvalid');
    expect(result.current.loading).toBe(false);
    await act(async () => {
      await result.current.retryLoad();
    });
    expect(result.current.settings).not.toBeNull();
  });

  it.each(['rejected', 'unsuccessful', 'empty', 'reader-error'] as const)(
    'resumes dirty autosave after a %s import and clears the file input for retry',
    async (failure) => {
      const data = failure === 'empty' ? '  ' : '{"maxComments":500}';
      class MockFileReader {
        onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
        onerror: (() => void) | null = null;
        onabort: (() => void) | null = null;
        readAsText() {
          if (failure === 'reader-error') this.onerror?.();
          else this.onload?.({ target: { result: data } } as ProgressEvent<FileReader>);
        }
      }
      vi.stubGlobal('FileReader', MockFileReader);
      if (failure === 'rejected')
        extensionApiMock.importSettings.mockRejectedValueOnce(new Error('invalid import'));
      if (failure === 'unsuccessful')
        extensionApiMock.importSettings.mockResolvedValueOnce({ success: false });
      const { result } = renderHook(() => useSettings());
      await act(async () => {
        await flushMicrotasks();
      });
      act(() => result.current.handleSettingsChange({ maxComments: 250 }));
      const input = { files: [new File([data], 'settings.json')], value: 'settings.json' };
      await act(async () => {
        result.current.handleImport({ target: input } as unknown as ChangeEvent<HTMLInputElement>);
        await flushMicrotasks();
      });
      expect(input.value).toBe('');
      expect(toastMock.error).toHaveBeenCalledWith('options.importError');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS * 2);
      });
      expect(extensionApiMock.saveSettings).toHaveBeenCalledOnce();
      expect(extensionApiMock.saveSettings).toHaveBeenCalledWith({ maxComments: 250 });
      expect(result.current.settings?.maxComments).toBe(250);
    },
  );

  it('does not replay a dirty pre-import patch after a successful import', async () => {
    let resolveImport!: (value: { success: boolean }) => void;
    extensionApiMock.importSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveImport = resolve;
      }),
    );
    extensionApiMock.getSettings
      .mockResolvedValueOnce(createSettings())
      .mockResolvedValueOnce({ ...createSettings(), maxComments: 500 });
    class MockFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      readAsText() {
        this.onload?.({ target: { result: '{"maxComments":500}' } } as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => result.current.handleSettingsChange({ maxComments: 250 }));
    await act(async () => {
      result.current.handleImport({
        target: { files: [new File(['{}'], 'settings.json')] },
      } as unknown as ChangeEvent<HTMLInputElement>);
      await flushMicrotasks();
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS * 2);
    });
    expect(extensionApiMock.saveSettings).not.toHaveBeenCalled();
    await act(async () => {
      resolveImport({ success: true });
      await flushMicrotasks();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS * 2);
    });
    expect(result.current.settings?.maxComments).toBe(500);
    expect(extensionApiMock.saveSettings).not.toHaveBeenCalled();
  });

  it('waits for an in-flight save before importing and drops a later pending edit on success', async () => {
    let resolveSave!: (value: { success: boolean }) => void;
    extensionApiMock.saveSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    extensionApiMock.getSettings
      .mockResolvedValueOnce(createSettings())
      .mockResolvedValueOnce({ ...createSettings(), maxComments: 500 });
    class MockFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
      readAsText() {
        this.onload?.({ target: { result: '{"maxComments":500}' } } as ProgressEvent<FileReader>);
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await flushMicrotasks();
    });
    act(() => result.current.handleSettingsChange({ maxComments: 200 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS);
    });
    act(() => result.current.handleSettingsChange({ maxComments: 300 }));
    await act(async () => {
      result.current.handleImport({
        target: { files: [new File(['{}'], 'settings.json')] },
      } as unknown as ChangeEvent<HTMLInputElement>);
      await flushMicrotasks();
    });
    expect(extensionApiMock.importSettings).not.toHaveBeenCalled();
    await act(async () => {
      resolveSave({ success: true });
      await flushMicrotasks(8);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.DEBOUNCE_SAVE_MS * 2);
    });
    expect(extensionApiMock.importSettings).toHaveBeenCalledOnce();
    expect(extensionApiMock.saveSettings).toHaveBeenCalledOnce();
    expect(result.current.settings?.maxComments).toBe(500);
  });
});

describe('useConfigImport', () => {
  it('normalizes domains before conflict detection and gives no-ID imports unique IDs', () => {
    const current = createCrawlingConfig('example.com', 'Current Example');
    const imported = [
      createCrawlingConfig(' Alpha.Example.COM '),
      createCrawlingConfig('BETA.Example.com'),
      createCrawlingConfig(' EXAMPLE.COM ', 'Incoming Example'),
    ].map(({ id: _id, ...config }) => config);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(12345);

    try {
      const { result } = renderHook(() => useConfigImport([current]));

      act(() => {
        result.current.processConfigs(imported, false);
      });

      expect(result.current.importAdditions.map((config) => config.domain)).toEqual([
        'alpha.example.com',
        'beta.example.com',
      ]);
      expect(result.current.importConflicts).toHaveLength(1);
      expect(result.current.importConflicts[0].incoming.domain).toBe('example.com');
      const importedIds = [
        ...result.current.importAdditions.map((config) => config.id),
        ...result.current.importConflicts.map((conflict) => conflict.incoming.id),
      ];
      expect(new Set(importedIds).size).toBe(importedIds.length);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
