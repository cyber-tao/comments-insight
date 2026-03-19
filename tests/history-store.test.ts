import { describe, it, expect, vi, beforeEach } from 'vitest';
import LZString from 'lz-string';
import { HistoryStore } from '../src/background/storage/HistoryStore';
import { STORAGE } from '../src/config/constants';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockRemove = vi.fn();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockGet,
      set: mockSet,
      remove: mockRemove,
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

describe('HistoryStore', () => {
  let store: HistoryStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new HistoryStore();
  });

  describe('getHistoryItem', () => {
    it('should return history item when comments payload is valid', async () => {
      const id = 'history_1';
      const key = `${STORAGE.HISTORY_KEY}_${id}`;
      const comments = [
        {
          id: 'comment_1',
          username: 'user',
          content: 'hello',
          likes: 1,
          timestamp: new Date().toISOString(),
          replies: [],
        },
      ];
      const compressed = LZString.compressToUTF16(JSON.stringify(comments));

      mockGet.mockResolvedValueOnce({
        [key]: {
          id,
          url: 'https://example.com',
          title: 'Test',
          platform: 'example',
          extractedAt: Date.now(),
          commentsCount: comments.length,
          comments: compressed,
        },
      });

      const result = await store.getHistoryItem(id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(id);
      expect(result?.comments).toEqual(comments);
    });

    it('should return undefined when comments payload is corrupted', async () => {
      const id = 'history_corrupted';
      const key = `${STORAGE.HISTORY_KEY}_${id}`;

      mockGet.mockResolvedValueOnce({
        [key]: {
          id,
          url: 'https://example.com',
          title: 'Broken',
          platform: 'example',
          extractedAt: Date.now(),
          commentsCount: 1,
          comments: '@@not-compressed@@',
        },
      });

      const result = await store.getHistoryItem(id);

      expect(result).toBeUndefined();
    });
  });

  describe('saveHistory', () => {
    it('should roll back stored payload when sorted index update fails', async () => {
      const historyId = 'history_save_failure';
      const payloadKey = `${STORAGE.HISTORY_KEY}_${historyId}`;
      const storageState: Record<string, unknown> = {};

      mockGet.mockImplementation(async (key: string) => {
        if (typeof key === 'string') {
          return { [key]: storageState[key] };
        }
        return {};
      });

      mockSet.mockImplementation(async (payload: Record<string, unknown>) => {
        const entries = Object.entries(payload);
        const shouldFail = entries.some(([key]) => key === STORAGE.HISTORY_SORTED_INDEX_KEY);

        if (shouldFail) {
          throw new Error('sorted index write failed');
        }

        for (const [key, value] of entries) {
          storageState[key] = value;
        }
      });

      mockRemove.mockImplementation(async (keys: string | string[]) => {
        const keysToDelete = Array.isArray(keys) ? keys : [keys];
        for (const key of keysToDelete) {
          delete storageState[key];
        }
      });

      await expect(
        store.saveHistory({
          id: historyId,
          url: 'https://example.com/post',
          title: 'Rollback Test',
          platform: 'example',
          extractedAt: Date.now(),
          commentsCount: 1,
          comments: [
            {
              id: 'comment-1',
              username: 'user',
              content: 'content',
              likes: 1,
              timestamp: new Date().toISOString(),
              replies: [],
            },
          ],
        }),
      ).rejects.toThrow('Failed to save history');

      expect(storageState[payloadKey]).toBeUndefined();
      expect(storageState[STORAGE.HISTORY_INDEX_KEY]).toEqual([]);
      expect(storageState[STORAGE.HISTORY_URL_INDEX_KEY]).toEqual({});
      expect(mockRemove).toHaveBeenCalledWith([payloadKey]);
    });
  });

  describe('storage sanitization', () => {
    it('should ignore malformed history index entries', async () => {
      mockGet.mockImplementation(async (key: string) => {
        if (key === STORAGE.HISTORY_INDEX_KEY) {
          return {
            [STORAGE.HISTORY_INDEX_KEY]: ['history_1', '', null, 123],
          };
        }

        if (key === `${STORAGE.HISTORY_KEY}_history_1`) {
          return {
            [`${STORAGE.HISTORY_KEY}_history_1`]: {
              id: 'history_1',
              url: 'https://example.com',
              title: 'Valid',
              platform: 'example',
              extractedAt: Date.now(),
              commentsCount: 0,
              comments: '',
            },
          };
        }

        return {};
      });

      const history = await store.getHistory();

      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('history_1');
    });

    it('should ignore malformed sorted index entries when paging history', async () => {
      mockGet.mockImplementation(async (key: string) => {
        if (key === STORAGE.HISTORY_SORTED_INDEX_KEY) {
          return {
            [STORAGE.HISTORY_SORTED_INDEX_KEY]: {
              entries: [
                {
                  id: 'history_1',
                  extractedAt: 2,
                  url: 'https://example.com/1',
                  title: 'Valid',
                  platform: 'example',
                },
                {
                  id: '',
                  extractedAt: 'bad',
                  url: 'https://example.com/2',
                  title: 'Broken',
                  platform: 'example',
                },
              ],
              lastUpdated: Date.now(),
            },
          };
        }

        if (key === `${STORAGE.HISTORY_KEY}_history_1`) {
          return {
            [`${STORAGE.HISTORY_KEY}_history_1`]: {
              id: 'history_1',
              url: 'https://example.com/1',
              title: 'Valid',
              platform: 'example',
              extractedAt: 2,
              commentsCount: 0,
              comments: '',
            },
          };
        }

        return {};
      });

      const page = await store.getHistoryPage(0, 20);

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe('history_1');
    });

    it('should return undefined for malformed stored history metadata', async () => {
      const id = 'history_broken_meta';
      const key = `${STORAGE.HISTORY_KEY}_${id}`;

      mockGet.mockResolvedValueOnce({
        [key]: {
          id,
          url: 'https://example.com',
          title: 'Broken',
          platform: 'example',
          extractedAt: Date.now(),
          commentsCount: 'bad',
          comments: '',
        },
      });

      const result = await store.getHistoryItem(id);

      expect(result).toBeUndefined();
    });
  });
});
