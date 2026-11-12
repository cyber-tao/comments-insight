import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogStore } from '../src/background/storage/LogStore';
import { TokenStatsStore } from '../src/background/storage/TokenStatsStore';
import { LOG_DEFAULTS, LIMITS, STORAGE } from '../src/config/constants';
import type { LogEntry } from '../src/utils/logger';

type StorageShape = Record<string, unknown>;

const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
const mockStorageRemove = vi.fn();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
      remove: mockStorageRemove,
    },
  },
});

vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let backing: StorageShape;

function useInMemoryStorage() {
  backing = {};
  mockStorageGet.mockImplementation((keys: string[] | string | null) => {
    if (keys === null || keys === undefined) {
      return Promise.resolve({ ...backing });
    }
    if (typeof keys === 'string') {
      return Promise.resolve({ [keys]: backing[keys] });
    }
    const result: StorageShape = {};
    for (const key of keys) {
      result[key] = backing[key];
    }
    return Promise.resolve(result);
  });
  mockStorageSet.mockImplementation((payload: StorageShape) => {
    Object.assign(backing, payload);
    return Promise.resolve(undefined);
  });
  mockStorageRemove.mockImplementation((keys: string[]) => {
    for (const key of keys) {
      delete backing[key];
    }
    return Promise.resolve(undefined);
  });
}

describe('LogStore AI log retention', () => {
  let store: LogStore;

  beforeEach(() => {
    vi.clearAllMocks();
    useInMemoryStorage();
    store = new LogStore();
  });

  function entry(prompt: string) {
    return {
      type: 'extraction' as const,
      timestamp: Date.now(),
      prompt,
      response: prompt,
    };
  }

  it('enforces the max-stored-logs count', async () => {
    for (let i = 0; i < LOG_DEFAULTS.AI_LOGS_MAX_STORED + 3; i += 1) {
      await store.saveAiLog(`ai_log_${i}`, entry(`p${i}`));
    }

    const index = backing[STORAGE.AI_LOG_INDEX_KEY] as string[];
    expect(index.length).toBe(LOG_DEFAULTS.AI_LOGS_MAX_STORED);
    // Oldest entries were removed from storage as well.
    expect(backing['ai_log_0']).toBeUndefined();
    expect(backing[`ai_log_${LOG_DEFAULTS.AI_LOGS_MAX_STORED + 2}`]).toBeDefined();
  });

  it('evicts oldest entries until the total character budget is met', async () => {
    // Each sanitized entry caps at ~2x AI_LOG_MAX_FIELD_LENGTH, so it takes a
    // handful of entries to exceed AI_LOG_TOTAL_CHAR_BUDGET (count cap is 100
    // and never triggers here).
    const big = 'x'.repeat(LIMITS.AI_LOG_MAX_FIELD_LENGTH);
    const entryCount = Math.ceil(
      LIMITS.AI_LOG_TOTAL_CHAR_BUDGET / (LIMITS.AI_LOG_MAX_FIELD_LENGTH * 2),
    );
    for (let i = 0; i < entryCount + 2; i += 1) {
      await store.saveAiLog(`ai_big_${i}`, entry(big));
    }

    const index = backing[STORAGE.AI_LOG_INDEX_KEY] as string[];
    const totalChars = index.reduce((sum, key) => {
      const stored = backing[key] as unknown;
      return sum + JSON.stringify(stored).length;
    }, 0);

    expect(totalChars).toBeLessThanOrEqual(LIMITS.AI_LOG_TOTAL_CHAR_BUDGET);
    expect(index.length).toBeLessThan(entryCount + 2);
    expect(backing['ai_big_0']).toBeUndefined();
    expect(backing[`ai_big_${entryCount + 1}`]).toBeDefined();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function systemEntry(message = 'System entry', timestamp = 1234): LogEntry {
  return { level: 'INFO' as LogEntry['level'], timestamp, message };
}

function aiEntry(prompt = 'AI entry') {
  return { type: 'extraction' as const, timestamp: 1234, prompt, response: prompt };
}

describe('LogStore system persistence and mutation serialization', () => {
  let store: LogStore;

  beforeEach(() => {
    vi.clearAllMocks();
    useInMemoryStorage();
    store = new LogStore();
  });

  it('sanitizes messages, nested data and stack traces before storing system logs', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwx';
    const entry: LogEntry = {
      ...systemEntry(`Failed with ${secret}`),
      context: 'Background',
      data: {
        apiKey: 'plain-secret-value',
        nested: { password: 'another-secret-value', safe: 42 },
        rows: [{ message: `Retry ${secret}` }],
      },
      stack: `Error: ${secret}\n at request`,
    };

    await store.saveSystemLog(entry);

    const index = backing[STORAGE.SYSTEM_LOG_INDEX_KEY] as string[];
    expect(index).toHaveLength(1);
    expect(index[0]).toMatch(/^log_info_1234_/);
    expect(backing[index[0]]).toEqual({
      ...entry,
      message: 'Failed with sk-a********uvwx',
      data: {
        apiKey: 'plai********alue',
        nested: { password: 'anot********alue', safe: 42 },
        rows: [{ message: 'Retry sk-a********uvwx' }],
      },
      stack: 'Error: sk-a********uvwx\n at request',
    });
    expect(JSON.stringify(backing)).not.toContain(secret);
    expect(entry.message).toContain(secret);
    expect(entry.data?.apiKey).toBe('plain-secret-value');
  });

  it('keeps concurrent system entries with the same timestamp under distinct keys', async () => {
    await Promise.all([
      store.saveSystemLog(systemEntry('First')),
      store.saveSystemLog(systemEntry('Second')),
      store.saveSystemLog(systemEntry('Third')),
    ]);

    const index = backing[STORAGE.SYSTEM_LOG_INDEX_KEY] as string[];
    expect(index).toHaveLength(3);
    expect(new Set(index).size).toBe(3);
    expect(index.map((key) => (backing[key] as LogEntry).message)).toEqual([
      'First',
      'Second',
      'Third',
    ]);
  });

  it('evicts the oldest system entry at the count limit without changing AI records', async () => {
    const oldKeys = Array.from({ length: LOG_DEFAULTS.LOGS_MAX_STORED }, (_, i) => `log_info_${i}`);
    backing[STORAGE.SYSTEM_LOG_INDEX_KEY] = oldKeys;
    for (const key of oldKeys) backing[key] = systemEntry(key);
    backing[STORAGE.AI_LOG_INDEX_KEY] = ['ai_log_preserved'];
    backing.ai_log_preserved = aiEntry();

    await store.saveSystemLog(systemEntry('Latest'));

    const index = backing[STORAGE.SYSTEM_LOG_INDEX_KEY] as string[];
    expect(index).toHaveLength(LOG_DEFAULTS.LOGS_MAX_STORED);
    expect(index.slice(0, -1)).toEqual(oldKeys.slice(1));
    expect(backing[oldKeys[0]]).toBeUndefined();
    expect((backing[index[index.length - 1]] as LogEntry).message).toBe('Latest');
    expect(backing[STORAGE.AI_LOG_INDEX_KEY]).toEqual(['ai_log_preserved']);
    expect(backing.ai_log_preserved).toEqual(aiEntry());
  });

  it.each(['ai', 'system'] as const)(
    'does not let a %s deletion race an append whose storage write is blocked',
    async (kind) => {
      const oldKey = kind === 'ai' ? 'ai_log_existing' : 'log_existing';
      const indexKey = kind === 'ai' ? STORAGE.AI_LOG_INDEX_KEY : STORAGE.SYSTEM_LOG_INDEX_KEY;
      backing[indexKey] = [oldKey];
      backing[oldKey] = kind === 'ai' ? aiEntry('Existing') : systemEntry('Existing');
      const started = deferred<void>();
      const release = deferred<void>();
      mockStorageSet.mockImplementationOnce(async (payload: StorageShape) => {
        started.resolve(undefined);
        await release.promise;
        Object.assign(backing, payload);
      });
      const append =
        kind === 'ai'
          ? store.saveAiLog('ai_log_new', aiEntry('New'))
          : store.saveSystemLog(systemEntry('New'));
      await started.promise;
      const readsBeforeDelete = mockStorageGet.mock.calls.length;

      const deletion = store.deleteLog(oldKey, kind);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockStorageGet).toHaveBeenCalledTimes(readsBeforeDelete);
      expect(mockStorageSet).toHaveBeenCalledOnce();
      expect(mockStorageRemove).not.toHaveBeenCalled();
      release.resolve(undefined);
      await Promise.all([append, deletion]);

      const index = backing[indexKey] as string[];
      expect(index).toHaveLength(1);
      expect(backing[oldKey]).toBeUndefined();
      expect(backing[index[0]] as { message?: string; prompt?: string }).toMatchObject(
        kind === 'ai' ? { prompt: 'New' } : { message: 'New' },
      );
      expect(mockStorageSet).toHaveBeenCalledTimes(2);
      expect(mockStorageRemove).toHaveBeenCalledExactlyOnceWith([oldKey]);
    },
  );

  it('uses the same mutex for AI deletions and system appends', async () => {
    backing[STORAGE.AI_LOG_INDEX_KEY] = ['ai_log_existing'];
    backing.ai_log_existing = aiEntry();
    const started = deferred<void>();
    const release = deferred<void>();
    mockStorageRemove.mockImplementationOnce(async (keys: string[]) => {
      started.resolve(undefined);
      await release.promise;
      for (const key of keys) delete backing[key];
    });
    const deletion = store.deleteLog('ai_log_existing', 'ai');
    await started.promise;
    const readsBeforeAppend = mockStorageGet.mock.calls.length;

    const append = store.saveSystemLog(systemEntry('After deletion'));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockStorageGet).toHaveBeenCalledTimes(readsBeforeAppend);
    expect(mockStorageSet).toHaveBeenCalledOnce();
    release.resolve(undefined);
    await Promise.all([deletion, append]);

    expect(backing[STORAGE.AI_LOG_INDEX_KEY]).toEqual([]);
    expect(backing.ai_log_existing).toBeUndefined();
    const index = backing[STORAGE.SYSTEM_LOG_INDEX_KEY] as string[];
    expect(index).toHaveLength(1);
    expect(backing[index[0]]).toEqual(systemEntry('After deletion'));
  });

  it('waits for a blocked append before sweeping all logs', async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    mockStorageSet.mockImplementationOnce(async (payload: StorageShape) => {
      started.resolve(undefined);
      await release.promise;
      Object.assign(backing, payload);
    });
    const append = store.saveSystemLog(systemEntry());
    await started.promise;

    const clearing = store.clearLogs();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockStorageGet).not.toHaveBeenCalledWith(null);
    release.resolve(undefined);
    await Promise.all([append, clearing]);

    expect(mockStorageGet).toHaveBeenCalledWith(null);
    expect(backing).toEqual({});
  });

  it('releases the mutation mutex after an append fails', async () => {
    const failure = new Error('storage write failed');
    mockStorageSet.mockRejectedValueOnce(failure);
    await expect(store.saveSystemLog(systemEntry('Failed'))).rejects.toBe(failure);

    await store.saveSystemLog(systemEntry('Recovered'));

    const index = backing[STORAGE.SYSTEM_LOG_INDEX_KEY] as string[];
    expect(index).toHaveLength(1);
    expect(backing[index[0]]).toEqual(systemEntry('Recovered'));
  });

  it.each(['ai', 'system', 'all', undefined] as const)(
    'sweeps indexed and orphan logs for %s while preserving settings, tokens and other categories',
    async (kind) => {
      const unrelated = {
        [STORAGE.SETTINGS_KEY]: { developerMode: true, theme: 'dark' },
        [STORAGE.TOKEN_STATS_KEY]: { today: 7, total: 19, lastReset: 1234 },
        [STORAGE.LOG_LEVEL_KEY]: 'WARN',
        task_state: { id: 'active-task' },
      };
      const aiRecords = {
        [STORAGE.AI_LOG_INDEX_KEY]: ['ai_log_indexed'],
        ai_log_indexed: aiEntry('Indexed AI'),
        ai_log_orphan: aiEntry('Orphan AI'),
      };
      const systemRecords = {
        [STORAGE.SYSTEM_LOG_INDEX_KEY]: ['log_indexed'],
        log_indexed: systemEntry('Indexed system'),
        log_orphan: systemEntry('Orphan system'),
      };
      Object.assign(backing, unrelated, aiRecords, systemRecords);

      await store.clearLogs(kind);

      expect(mockStorageGet).toHaveBeenCalledExactlyOnceWith(null);
      expect(backing).toEqual({
        ...unrelated,
        ...(kind === 'system' ? aiRecords : {}),
        ...(kind === 'ai' ? systemRecords : {}),
      });
    },
  );

  it.each([
    ['ai', 'log_existing'],
    ['system', 'ai_log_existing'],
    ['ai', STORAGE.AI_LOG_INDEX_KEY],
    ['system', STORAGE.SYSTEM_LOG_INDEX_KEY],
    ['system', STORAGE.LOG_LEVEL_KEY],
    ['system', STORAGE.SETTINGS_KEY],
    ['ai', STORAGE.TOKEN_STATS_KEY],
  ] as const)('rejects deleting protected or cross-category keys (%s, %s)', async (kind, key) => {
    backing[key] = 'preserved';

    await expect(store.deleteLog(key, kind)).rejects.toThrow('Invalid log key');

    expect(backing[key]).toBe('preserved');
    expect(mockStorageGet).not.toHaveBeenCalled();
    expect(mockStorageSet).not.toHaveBeenCalled();
    expect(mockStorageRemove).not.toHaveBeenCalled();
  });
});

describe('TokenStatsStore', () => {
  let store: TokenStatsStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 0, 15, 12));
    vi.clearAllMocks();
    useInMemoryStorage();
    store = new TokenStatsStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function startOfToday(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  it('records token usage for today and the all-time total', async () => {
    await store.recordTokenUsage(37);

    expect(backing[STORAGE.TOKEN_STATS_KEY]).toEqual({
      today: 37,
      total: 37,
      lastReset: startOfToday(),
    });
  });

  it('resets the daily count before recording usage on a new day', async () => {
    const todayStart = startOfToday();
    backing[STORAGE.TOKEN_STATS_KEY] = {
      today: 80,
      total: 120,
      lastReset: todayStart - 1,
    };

    await store.recordTokenUsage(9);

    expect(backing[STORAGE.TOKEN_STATS_KEY]).toEqual({
      today: 9,
      total: 129,
      lastReset: todayStart,
    });
  });

  it('serializes concurrent records so no token usage is lost', async () => {
    const usages = [3, 5, 7, 11];
    backing[STORAGE.TOKEN_STATS_KEY] = {
      today: 13,
      total: 100,
      lastReset: startOfToday(),
    };

    await Promise.all(usages.map((tokens) => store.recordTokenUsage(tokens)));

    expect(backing[STORAGE.TOKEN_STATS_KEY]).toEqual({
      today: 39,
      total: 126,
      lastReset: startOfToday(),
    });
    expect(mockStorageSet).toHaveBeenCalledTimes(usages.length);
  });

  it('rejects a failed read instead of reporting an empty record', async () => {
    mockStorageGet.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(store.getTokenStats()).rejects.toThrow('storage unavailable');
  });

  it('preserves existing totals after a failed read and records later usage', async () => {
    const previous = { today: 80, total: 1200, lastReset: startOfToday() };
    backing[STORAGE.TOKEN_STATS_KEY] = previous;
    mockStorageGet.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(store.recordTokenUsage(10)).resolves.toBeUndefined();
    expect(mockStorageSet).not.toHaveBeenCalled();
    expect(backing[STORAGE.TOKEN_STATS_KEY]).toEqual(previous);

    await store.recordTokenUsage(7);
    expect(backing[STORAGE.TOKEN_STATS_KEY]).toEqual({ ...previous, today: 87, total: 1207 });
  });

  it('does not reject callers when storage cannot persist a record', async () => {
    mockStorageSet.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(store.recordTokenUsage(12)).resolves.toBeUndefined();
    expect(backing[STORAGE.TOKEN_STATS_KEY]).toBeUndefined();
  });
});
