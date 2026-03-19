import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageManager } from '../src/background/StorageManager';
import type { Settings, HistoryItem } from '../src/types';
import { LIMITS, STORAGE, TEXT } from '../src/config/constants';

// Mock chrome API
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
const mockStorageRemove = vi.fn();

const mockChrome = {
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
      remove: mockStorageRemove,
    },
  },
};

vi.stubGlobal('chrome', mockChrome);

// Mock Logger
vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Web Crypto API
const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();
const mockDeriveKey = vi.fn();
const mockImportKey = vi.fn();
const mockGetRandomValues = vi.fn((arr) => {
  // Fill with random values
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
});

vi.stubGlobal('crypto', {
  getRandomValues: mockGetRandomValues,
  subtle: {
    encrypt: mockEncrypt,
    decrypt: mockDecrypt,
    deriveKey: mockDeriveKey,
    importKey: mockImportKey,
  },
});

// Mock TextEncoder/Decoder
vi.stubGlobal(
  'TextEncoder',
  class {
    encode(str: string) {
      return new Uint8Array(Buffer.from(str));
    }
  },
);
vi.stubGlobal(
  'TextDecoder',
  class {
    decode(arr: Uint8Array) {
      return Buffer.from(arr).toString();
    }
  },
);

describe('StorageManager', () => {
  let storageManager: StorageManager;

  beforeEach(() => {
    vi.clearAllMocks();
    storageManager = new StorageManager();
  });

  describe('getSettings', () => {
    it('should return default settings if storage is empty', async () => {
      mockStorageGet.mockResolvedValue({});

      const settings = await storageManager.getSettings();

      expect(settings.maxComments).toBeDefined();
      expect(mockStorageSet).toHaveBeenCalled(); // Should save defaults
    });

    it('should merge stored settings with defaults', async () => {
      const storedSettings: Partial<Settings> = { maxComments: 100 };
      mockStorageGet.mockResolvedValue({ settings: storedSettings });

      const settings = await storageManager.getSettings();

      expect(settings.maxComments).toBe(100);
      expect(settings.aiModel).toBeDefined(); // Default merged
    });

    it('should throw when storage access fails', async () => {
      mockStorageGet.mockRejectedValue(new Error('storage unavailable'));

      await expect(storageManager.getSettings()).rejects.toThrow('Failed to get settings');
    });

    it('should sanitize malformed stored settings before merging defaults', async () => {
      mockStorageGet.mockResolvedValue({
        settings: {
          maxComments: 80,
          theme: 'dark',
          selectorCache: [
            {
              domain: 'example.com',
              selectors: { commentContainer: '.comment' },
              lastUsed: 1,
              successCount: 2,
            },
            {
              domain: 'broken.com',
              selectors: {},
              lastUsed: 'bad',
              successCount: 0,
            },
          ],
          crawlingConfigs: [
            {
              id: 'cfg_1',
              domain: 'example.com',
              container: { selector: '.list', type: 'css' },
              item: { selector: '.item', type: 'css' },
              fields: [],
              lastUpdated: 1,
            },
            {
              id: 'cfg_2',
              domain: '',
              container: { selector: '.list', type: 'css' },
              item: { selector: '.item', type: 'css' },
              fields: [],
              lastUpdated: 1,
            },
          ],
          domAnalysisConfig: {
            initialDepth: 2,
            expandDepth: 4,
            maxDepth: 6,
          },
        },
      });

      const settings = await storageManager.getSettings();

      expect(settings.maxComments).toBe(80);
      expect(settings.theme).toBe('dark');
      expect(settings.selectorCache).toHaveLength(1);
      expect(settings.selectorCache[0].domain).toBe('example.com');
      expect(settings.crawlingConfigs.some((config) => config.domain === 'example.com')).toBe(true);
      expect(settings.crawlingConfigs.some((config) => config.id === 'cfg_2')).toBe(false);
      expect(settings.domAnalysisConfig).toEqual({ initialDepth: 2, expandDepth: 4, maxDepth: 6 });
    });
  });

  describe('saveSettings', () => {
    it('should save settings to storage', async () => {
      const newSettings: Partial<Settings> = { maxComments: 200 };
      mockStorageGet.mockResolvedValue({}); // Allow getting current settings

      await storageManager.saveSettings(newSettings);

      expect(mockStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ maxComments: 200 }),
        }),
      );
    });
  });

  describe('History Operations', () => {
    const mockHistoryItem: HistoryItem = {
      id: 'test-id',
      title: 'Test',
      url: 'http://test.com',
      platform: 'Test',
      extractedAt: 1000,
      commentsCount: 0,
      comments: [],
    };

    it('should save history item', async () => {
      await storageManager.saveHistory(mockHistoryItem);

      expect(mockStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({
          'history_test-id': expect.anything(),
        }),
      );

      // Should update index
      expect(mockStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({
          history_index: expect.arrayContaining(['test-id']),
        }),
      );
    });

    it('should get history items', async () => {
      mockStorageGet.mockImplementation((key) => {
        if (key === 'history_index') return { history_index: ['1'] };
        if (key === 'history_1')
          return {
            history_1: {
              ...mockHistoryItem,
              id: '1',
              comments: '', // LZString mock handled implicitly or empty
            },
          };
        return {};
      });

      const history = await storageManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('1');
    });

    it('should skip stale index entries when loading history', async () => {
      mockStorageGet.mockImplementation((key) => {
        if (key === 'history_index') return { history_index: ['missing', '1'] };
        if (key === 'history_missing') return {};
        if (key === 'history_1') {
          return {
            history_1: {
              ...mockHistoryItem,
              id: '1',
              comments: '',
            },
          };
        }
        return {};
      });

      const history = await storageManager.getHistory();

      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('1');
    });

    it('should skip stale sorted-index entries when loading paged history', async () => {
      mockStorageGet.mockImplementation((key) => {
        if (key === 'history_sorted_index') {
          return {
            history_sorted_index: {
              entries: [
                {
                  id: 'missing',
                  extractedAt: 2000,
                  url: 'http://a.com',
                  title: 'A',
                  platform: 'A',
                },
                {
                  id: '1',
                  extractedAt: 1000,
                  url: 'http://test.com',
                  title: 'Test',
                  platform: 'Test',
                },
              ],
              lastUpdated: Date.now(),
            },
          };
        }
        if (key === 'history_missing') return {};
        if (key === 'history_1') {
          return {
            history_1: {
              ...mockHistoryItem,
              id: '1',
              comments: '',
            },
          };
        }
        return {};
      });

      const page = await storageManager.getHistoryPage(0, 20);

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe('1');
    });

    it('should delete history item', async () => {
      mockStorageGet.mockResolvedValue({ history_index: ['1', '2'] });

      await storageManager.deleteHistoryItem('1');

      expect(mockStorageRemove).toHaveBeenCalledWith(expect.arrayContaining(['history_1']));
      expect(mockStorageSet).toHaveBeenCalledWith({
        history_index: ['2'],
      });
    });
  });

  describe('AI Log Operations', () => {
    it('should truncate oversized AI log fields before saving', async () => {
      const longPrompt = 'p'.repeat(LIMITS.AI_LOG_MAX_FIELD_LENGTH + 50);
      const longResponse = 'r'.repeat(LIMITS.AI_LOG_MAX_FIELD_LENGTH + 75);

      await storageManager.saveAiLog('ai_log_test_1', {
        type: 'analysis',
        timestamp: 1,
        prompt: longPrompt,
        response: longResponse,
      });

      const firstPayload = mockStorageSet.mock.calls[0]?.[0] as Record<string, unknown>;
      const entry = firstPayload?.ai_log_test_1 as { prompt: string; response: string } | undefined;

      expect(entry?.prompt.length).toBe(LIMITS.AI_LOG_MAX_FIELD_LENGTH);
      expect(entry?.prompt.endsWith(TEXT.PREVIEW_SUFFIX)).toBe(true);
      expect(entry?.response.length).toBe(LIMITS.AI_LOG_MAX_FIELD_LENGTH);
      expect(entry?.response.endsWith(TEXT.PREVIEW_SUFFIX)).toBe(true);
    });

    it('should evict oldest AI logs when total log budget is exceeded', async () => {
      const storageState: Record<string, unknown> = {};

      mockStorageGet.mockImplementation(async (key: string | string[]) => {
        if (Array.isArray(key)) {
          return key.reduce<Record<string, unknown>>((accumulator, currentKey) => {
            accumulator[currentKey] = storageState[currentKey];
            return accumulator;
          }, {});
        }

        return { [key]: storageState[key] };
      });

      mockStorageSet.mockImplementation(async (payload: Record<string, unknown>) => {
        Object.assign(storageState, payload);
      });

      mockStorageRemove.mockImplementation(async (keys: string | string[]) => {
        const keysToRemove = Array.isArray(keys) ? keys : [keys];
        for (const key of keysToRemove) {
          delete storageState[key];
        }
      });

      const oversizedField = 'x'.repeat(LIMITS.AI_LOG_MAX_FIELD_LENGTH + 500);

      for (let index = 0; index < 10; index += 1) {
        await storageManager.saveAiLog(`ai_log_test_${index}`, {
          type: 'extraction',
          timestamp: index,
          prompt: oversizedField,
          response: oversizedField,
        });
      }

      const index = (storageState[STORAGE.AI_LOG_INDEX_KEY] as string[]) || [];

      expect(index.length).toBeLessThan(10);
      expect(index).not.toContain('ai_log_test_0');
      expect(index.at(-1)).toBe('ai_log_test_9');
    });

    it('should sanitize malformed AI log index entries before appending new logs', async () => {
      const storageState: Record<string, unknown> = {
        [STORAGE.AI_LOG_INDEX_KEY]: [123, '', 'ai_log_test_existing'],
        ai_log_test_existing: {
          type: 'analysis',
          timestamp: 1,
          prompt: 'old prompt',
          response: 'old response',
        },
      };

      mockStorageGet.mockImplementation(async (key: string | string[]) => {
        if (Array.isArray(key)) {
          return key.reduce<Record<string, unknown>>((accumulator, currentKey) => {
            accumulator[currentKey] = storageState[currentKey];
            return accumulator;
          }, {});
        }

        return { [key]: storageState[key] };
      });

      mockStorageSet.mockImplementation(async (payload: Record<string, unknown>) => {
        Object.assign(storageState, payload);
      });

      await storageManager.saveAiLog('ai_log_test_new', {
        type: 'extraction',
        timestamp: 2,
        prompt: 'new prompt',
        response: 'new response',
      });

      expect(storageState[STORAGE.AI_LOG_INDEX_KEY]).toEqual([
        'ai_log_test_existing',
        'ai_log_test_new',
      ]);
    });
  });
});
