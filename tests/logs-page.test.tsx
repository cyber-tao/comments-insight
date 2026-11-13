/**
 * @vitest-environment jsdom
 */

import { act, render, renderHook, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Logs from '../src/logs/Logs';
import { LogStore } from '../src/background/storage/LogStore';
import { useLogs } from '../src/logs/hooks/useLogs';
import { MESSAGES, STORAGE } from '../src/config/constants';
import { ErrorCode, ExtensionError, toExtensionErrorPayload } from '../src/utils/error-types';
import type { Message } from '../src/types';
import type { LogEntry } from '../src/utils/logger';

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  setMinLevel: vi.fn(),
}));

const confirmMock = vi.hoisted(() => vi.fn(async () => true));
const useConfirmMock = vi.hoisted(() =>
  vi.fn(() => ({
    confirm: confirmMock,
    ConfirmHost: () => null,
  })),
);

const useThemeMock = vi.hoisted(() => vi.fn());

const changeLanguageMock = vi.hoisted(() => vi.fn());

const extensionApiMock = vi.hoisted(() => ({
  getSettings: vi.fn().mockResolvedValue({ language: 'ja-JP' }),
}));

vi.mock('../src/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/logger')>();
  return {
    ...actual,
    Logger: loggerMock,
  };
});

vi.mock('../src/hooks/useConfirm', () => ({
  useConfirm: useConfirmMock,
}));

vi.mock('../src/hooks/useTheme', () => ({
  useTheme: useThemeMock,
}));

vi.mock('../src/utils/extension-api', () => ({
  ExtensionAPI: extensionApiMock,
}));

vi.mock('../src/utils/i18n', () => ({
  default: {},
  changeLanguage: changeLanguageMock,
  loadLocaleResource: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Keys are already covered by scripts/check-i18n.mjs; tests assert on keys.
    t: (key: string, params?: { count?: number }) =>
      params?.count === undefined ? key : `${key} ${params.count}`,
  }),
}));

type StorageShape = Record<string, unknown>;
const storageGet = vi.fn<(keys: string | string[] | null) => Promise<StorageShape>>();
const storageSet = vi.fn<(payload: StorageShape) => Promise<void>>();
const storageRemove = vi.fn<(keys: string | string[]) => Promise<void>>();
const runtimeHandler = vi.fn<(message: Message) => Promise<unknown>>();
const runtimeSendMessage =
  vi.fn<(message: Message, callback: (response: unknown) => void) => void>();
let backing: StorageShape;
let store: LogStore;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function handleLogMessage(message: Message): Promise<{ success: true }> {
  if (message.type === MESSAGES.CLEAR_LOGS) {
    await store.clearLogs(message.payload.kind);
  } else if (message.type === MESSAGES.DELETE_LOG) {
    await store.deleteLog(message.payload.key, message.payload.kind);
  } else {
    throw new Error(`Unexpected logs-page message: ${message.type}`);
  }
  return { success: true };
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let i = 0; i < iterations; i += 1) {
    await Promise.resolve();
  }
}

async function loadedLogs() {
  await waitFor(() => {
    expect(screen.getByText('logs.filterAI (2)')).toBeTruthy();
    expect(screen.getByText('logs.filterSystem (1)')).toBeTruthy();
  });
}

describe('Logs Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
    backing = {
      ai_log_index: ['ai_log_1', 'ai_log_2'],
      system_log_index: ['log_sys_1'],
      ai_log_1: {
        type: 'extraction',
        timestamp: 1000,
        prompt: 'test prompt',
        response: 'test response',
      },
      ai_log_2: {
        type: 'analysis',
        timestamp: 2000,
        prompt: 'test prompt 2',
        response: 'test response 2',
      },
      log_sys_1: {
        level: 'ERROR',
        timestamp: 3000,
        message: 'system error message',
      },
      log_min_level: 'DEBUG',
      [STORAGE.SETTINGS_KEY]: { developerMode: true, language: 'ja-JP' },
      [STORAGE.TOKEN_STATS_KEY]: { today: 7, total: 19, lastReset: 1234 },
    };
    storageGet.mockReset().mockImplementation(async (keys) => {
      if (keys === null || keys === undefined) return { ...backing };
      if (typeof keys === 'string') return { [keys]: backing[keys] };
      return Object.fromEntries(keys.map((key) => [key, backing[key]]));
    });
    storageSet.mockReset().mockImplementation(async (payload) => {
      Object.assign(backing, payload);
    });
    storageRemove.mockReset().mockImplementation(async (keys) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete backing[key];
    });
    store = new LogStore();
    runtimeHandler.mockReset().mockImplementation(handleLogMessage);
    runtimeSendMessage.mockReset().mockImplementation((message, callback) => {
      void runtimeHandler(message).then(callback, (error: unknown) => {
        callback({ error: toExtensionErrorPayload(error) });
      });
    });
    vi.stubGlobal('chrome', {
      storage: { local: { get: storageGet, set: storageSet, remove: storageRemove } },
      runtime: { sendMessage: runtimeSendMessage, lastError: undefined },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('applies the user language preference on mount', async () => {
    render(<Logs />);

    await waitFor(() => {
      expect(extensionApiMock.getSettings).toHaveBeenCalled();
      expect(changeLanguageMock).toHaveBeenCalledWith('ja-JP');
    });
  });

  it('loads and renders logs successfully', async () => {
    render(<Logs />);

    await waitFor(() => {
      expect(screen.getByText('logs.filterAI (2)')).toBeTruthy();
      expect(screen.getByText('logs.filterSystem (1)')).toBeTruthy();
    });

    // Switch to System Logs
    fireEvent.click(screen.getByText('logs.filterSystem (1)'));
    await waitFor(() => {
      expect(screen.getAllByText('system error message').length).toBeGreaterThan(0);
      expect(screen.getByText('logs.totalCount 1')).toBeTruthy();
      expect(screen.getByText('logs.errorCount 1')).toBeTruthy();
    });
  });

  it('filters logs by type', async () => {
    render(<Logs />);

    // First we are on AI tab by default, wait for it to load
    await waitFor(() => expect(screen.getByText('logs.filterAI (2)')).toBeTruthy());

    // Switch to System Logs
    fireEvent.click(screen.getByText('logs.filterSystem (1)'));
    await waitFor(() => {
      expect(screen.getAllByText('system error message').length).toBeGreaterThan(0);
    });

    // Filter Error
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ERROR' } });
    expect(screen.getAllByText('system error message').length).toBeGreaterThan(0);
  });

  it('clears through the background and keeps both UI categories until success is acknowledged', async () => {
    const acknowledge = deferred<void>();
    runtimeHandler.mockImplementationOnce(async (message) => {
      const response = await handleLogMessage(message);
      await acknowledge.promise;
      return response;
    });
    render(<Logs />);
    await loadedLogs();

    fireEvent.click(screen.getByRole('button', { name: /logs.clearAll/ }));
    await act(async () => {
      await flushMicrotasks();
    });

    expect(storageRemove).toHaveBeenCalledOnce();
    expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith(
      { type: MESSAGES.CLEAR_LOGS, payload: { kind: 'all' } },
      expect.any(Function),
    );
    expect(backing.ai_log_1).toBeUndefined();
    expect(backing.log_sys_1).toBeUndefined();
    expect(screen.getByText('logs.filterAI (2)')).toBeTruthy();
    expect(screen.getByText('logs.filterSystem (1)')).toBeTruthy();
    expect(storageSet).not.toHaveBeenCalled();

    await act(async () => {
      acknowledge.resolve(undefined);
    });

    await waitFor(() => {
      expect(screen.getByText('logs.filterAI (0)')).toBeTruthy();
      expect(screen.getByText('logs.filterSystem (0)')).toBeTruthy();
      expect(screen.getByText('logs.empty')).toBeTruthy();
    });
    expect(backing[STORAGE.LOG_LEVEL_KEY]).toBe('DEBUG');
    expect(backing[STORAGE.SETTINGS_KEY]).toEqual({ developerMode: true, language: 'ja-JP' });
    expect(backing[STORAGE.TOKEN_STATS_KEY]).toEqual({ today: 7, total: 19, lastReset: 1234 });
  });

  it('sweeps logs appended after loading and orphan rows instead of clearing a stale UI key list', async () => {
    render(<Logs />);
    await loadedLogs();
    await store.saveAiLog('ai_log_after_load', {
      type: 'analysis',
      timestamp: 4000,
      prompt: 'Fresh AI',
      response: 'Fresh response',
    });
    await store.saveSystemLog({
      level: 'INFO',
      timestamp: 5000,
      message: 'Fresh system',
    } as LogEntry);
    backing.ai_log_orphan = { type: 'analysis', timestamp: 6000, prompt: 'Orphan', response: '' };
    backing.log_orphan = { level: 'WARN', timestamp: 7000, message: 'Orphan system' };
    expect(screen.getByText('logs.filterAI (2)')).toBeTruthy();
    expect(screen.getByText('logs.filterSystem (1)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /logs.clearAll/ }));

    await waitFor(() => expect(screen.getByText('logs.filterAI (0)')).toBeTruthy());
    expect(screen.getByText('logs.filterSystem (0)')).toBeTruthy();
    expect(runtimeSendMessage).toHaveBeenCalledWith(
      { type: MESSAGES.CLEAR_LOGS, payload: { kind: 'all' } },
      expect.any(Function),
    );
    expect(storageGet).toHaveBeenCalledWith(null);
    expect(backing).toEqual({
      [STORAGE.LOG_LEVEL_KEY]: 'DEBUG',
      [STORAGE.SETTINGS_KEY]: { developerMode: true, language: 'ja-JP' },
      [STORAGE.TOKEN_STATS_KEY]: { today: 7, total: 19, lastReset: 1234 },
    });

    fireEvent.click(screen.getByRole('button', { name: /logs.refresh/ }));
    await waitFor(() => expect(screen.queryByText('logs.loading')).toBeNull());
    expect(screen.getByText('logs.filterAI (0)')).toBeTruthy();
    expect(screen.getByText('logs.filterSystem (0)')).toBeTruthy();
  });

  it.each(['ai', 'system'] as const)(
    'deletes a %s row through the background and updates only that category after the acknowledgment',
    async (kind) => {
      const acknowledge = deferred<void>();
      runtimeHandler.mockImplementationOnce(async (message) => {
        const response = await handleLogMessage(message);
        await acknowledge.promise;
        return response;
      });
      render(<Logs />);
      await loadedLogs();
      if (kind === 'system') fireEvent.click(screen.getByText('logs.filterSystem (1)'));
      fireEvent.click(screen.getByText(kind === 'ai' ? 'logs.aiAnalysis' : 'system error message'));
      fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
      const key = kind === 'ai' ? 'ai_log_2' : 'log_sys_1';

      await act(async () => {
        await flushMicrotasks();
      });
      expect(storageRemove).toHaveBeenCalledExactlyOnceWith([key]);
      expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith(
        { type: MESSAGES.DELETE_LOG, payload: { key, kind } },
        expect.any(Function),
      );
      expect(backing[key]).toBeUndefined();
      expect(screen.getByText('logs.filterAI (2)')).toBeTruthy();
      expect(screen.getByText('logs.filterSystem (1)')).toBeTruthy();
      expect(storageSet).toHaveBeenCalledExactlyOnceWith({
        [kind === 'ai' ? STORAGE.AI_LOG_INDEX_KEY : STORAGE.SYSTEM_LOG_INDEX_KEY]:
          kind === 'ai' ? ['ai_log_1'] : [],
      });

      await act(async () => {
        acknowledge.resolve(undefined);
      });

      await waitFor(() => {
        expect(screen.getByText(`logs.filterAI (${kind === 'ai' ? 1 : 2})`)).toBeTruthy();
        expect(screen.getByText(`logs.filterSystem (${kind === 'system' ? 0 : 1})`)).toBeTruthy();
      });
      expect(backing.ai_log_1).toBeDefined();
      expect(backing[kind === 'ai' ? 'log_sys_1' : 'ai_log_2']).toBeDefined();
    },
  );

  it.each([
    { operation: 'clear', kind: 'ai' },
    { operation: 'delete', kind: 'ai' },
    { operation: 'delete', kind: 'system' },
  ] as const)(
    'keeps page logs and displays an alert when $operation ($kind) fails, then allows retry',
    async ({ operation, kind }) => {
      const removalStarted = deferred<void>();
      const release = deferred<void>();
      storageRemove.mockImplementationOnce(async () => {
        removalStarted.resolve(undefined);
        await release.promise;
        throw new ExtensionError(
          ErrorCode.STORAGE_WRITE_ERROR,
          'Storage removal failed',
          undefined,
          true,
        );
      });
      render(<Logs />);
      await loadedLogs();
      if (kind === 'system') fireEvent.click(screen.getByText('logs.filterSystem (1)'));
      if (operation === 'delete') {
        fireEvent.click(
          screen.getByText(kind === 'ai' ? 'logs.aiAnalysis' : 'system error message'),
        );
      }
      const action =
        operation === 'clear'
          ? screen.getByRole('button', { name: /logs.clearAll/ })
          : screen.getByRole('button', { name: 'common.delete' });
      await act(async () => {
        fireEvent.click(action);
        await removalStarted.promise;
      });

      expect(screen.getByText('logs.filterAI (2)')).toBeTruthy();
      expect(screen.getByText('logs.filterSystem (1)')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      await act(async () => {
        release.resolve(undefined);
      });

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe('errors.storageWriteError');
      expect(screen.getByText('logs.filterAI (2)')).toBeTruthy();
      expect(screen.getByText('logs.filterSystem (1)')).toBeTruthy();
      expect(backing.ai_log_2).toBeDefined();
      expect(backing.log_sys_1).toBeDefined();
      expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith(
        operation === 'clear'
          ? { type: MESSAGES.CLEAR_LOGS, payload: { kind: 'all' } }
          : {
              type: MESSAGES.DELETE_LOG,
              payload: {
                key: kind === 'ai' ? 'ai_log_2' : 'log_sys_1',
                kind,
              },
            },
        expect.any(Function),
      );

      await act(async () => {
        fireEvent.click(action);
      });

      await waitFor(() => {
        expect(
          screen.getByText(`logs.filterAI (${operation === 'clear' ? 0 : kind === 'ai' ? 1 : 2})`),
        ).toBeTruthy();
        expect(
          screen.getByText(
            `logs.filterSystem (${operation === 'clear' || kind === 'system' ? 0 : 1})`,
          ),
        ).toBeTruthy();
      });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(runtimeSendMessage).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['clear', 'delete'] as const)(
    'retains loaded UI logs while %s is pending and after a structured storage failure',
    async (operation) => {
      const { result } = renderHook(() => useLogs());
      await act(async () => {
        await result.current.loadLogs();
      });
      const removalStarted = deferred<void>();
      const release = deferred<void>();
      const failure = new ExtensionError(
        ErrorCode.STORAGE_WRITE_ERROR,
        'Storage removal failed',
        undefined,
        true,
      );
      storageRemove.mockImplementationOnce(async () => {
        removalStarted.resolve(undefined);
        await release.promise;
        throw failure;
      });
      const request =
        operation === 'clear'
          ? result.current.clearAllLogs()
          : result.current.deleteLog('ai_log_2', 'ai');
      const rejection = expect(request).rejects.toMatchObject({
        code: ErrorCode.STORAGE_WRITE_ERROR,
        message: 'Storage removal failed',
        retryable: true,
      });
      await removalStarted.promise;

      expect(result.current.aiLogs).toHaveLength(2);
      expect(result.current.systemLogs).toHaveLength(1);
      expect(result.current.systemStats.total).toBe(1);
      await act(async () => {
        release.resolve(undefined);
        await rejection;
      });

      expect(result.current.aiLogs).toHaveLength(2);
      expect(result.current.systemLogs).toHaveLength(1);
      expect(backing.ai_log_2).toBeDefined();
      expect(backing.log_sys_1).toBeDefined();
      expect(runtimeSendMessage).toHaveBeenCalledExactlyOnceWith(
        operation === 'clear'
          ? { type: MESSAGES.CLEAR_LOGS, payload: { kind: 'all' } }
          : { type: MESSAGES.DELETE_LOG, payload: { key: 'ai_log_2', kind: 'ai' } },
        expect.any(Function),
      );
      expect(loggerMock.error).toHaveBeenCalledWith(
        operation === 'clear' ? '[Logs] Failed to clear logs' : '[Logs] Failed to delete log',
        {
          error: expect.objectContaining({ code: ErrorCode.STORAGE_WRITE_ERROR, retryable: true }),
        },
      );
    },
  );

  it.each([
    ['clear', undefined],
    ['clear', { success: false }],
    ['delete', undefined],
    ['delete', { success: false }],
  ] as const)(
    'requires an explicit success acknowledgment for %s (%j)',
    async (operation, response) => {
      const { result } = renderHook(() => useLogs());
      await act(async () => {
        await result.current.loadLogs();
      });
      const acknowledge = deferred<unknown>();
      runtimeHandler.mockImplementationOnce(() => acknowledge.promise);
      const request =
        operation === 'clear'
          ? result.current.clearAllLogs()
          : result.current.deleteLog('ai_log_2', 'ai');
      const rejection = expect(request).rejects.toThrow(
        operation === 'clear' ? 'Failed to clear logs' : 'Failed to delete log',
      );
      expect(result.current.aiLogs).toHaveLength(2);
      expect(result.current.systemLogs).toHaveLength(1);

      await act(async () => {
        acknowledge.resolve(response);
        await rejection;
      });

      expect(result.current.aiLogs).toHaveLength(2);
      expect(result.current.systemLogs).toHaveLength(1);
      expect(storageSet).not.toHaveBeenCalled();
      expect(storageRemove).not.toHaveBeenCalled();
    },
  );

  it('handles log item expansion', async () => {
    render(<Logs />);
    await waitFor(() => expect(screen.getByText('logs.filterAI (2)')).toBeTruthy());

    // Switch to System Logs to find the system error message
    fireEvent.click(screen.getByText('logs.filterSystem (1)'));

    await waitFor(() =>
      expect(screen.getAllByText('system error message').length).toBeGreaterThan(0),
    );

    // Expand
    fireEvent.click(screen.getAllByText('system error message')[0]);
    expect(screen.getByText('logs.copyLog')).toBeTruthy();

    // Collapse
    fireEvent.click(screen.getAllByText('system error message')[0]);
    expect(screen.queryByText('logs.copyLog')).toBeNull();
  });
});
