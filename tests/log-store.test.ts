import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LogStore } from '../src/background/storage/LogStore';
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

describe('LogStore AI log retention', () => {
  let store: LogStore;
  let backing: StorageShape;

  beforeEach(() => {
    vi.clearAllMocks();
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
