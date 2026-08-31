import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogStore } from '../src/background/storage/LogStore';
import { TokenStatsStore } from '../src/background/storage/TokenStatsStore';
import { LOG_DEFAULTS, LIMITS, STORAGE } from '../src/config/constants';

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

  it('returns zeroed stats when storage cannot be read', async () => {
    mockStorageGet.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(store.getTokenStats()).resolves.toEqual({
      today: 0,
      total: 0,
      lastReset: 0,
    });
  });

  it('does not reject callers when storage cannot persist a record', async () => {
    mockStorageSet.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(store.recordTokenUsage(12)).resolves.toBeUndefined();
    expect(backing[STORAGE.TOKEN_STATS_KEY]).toBeUndefined();
  });
});
