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
});
