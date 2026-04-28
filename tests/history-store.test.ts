import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryStore } from '../src/background/storage/HistoryStore';
import { HISTORY } from '../src/config/constants';

vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('HistoryStore (IndexedDB)', () => {
  let store: HistoryStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    store = new HistoryStore();
    await store.clearAllHistory();
  });

  it('should save and retrieve a history item', async () => {
    const id = 'history_1';
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

    await store.saveHistory({
      id,
      url: 'https://example.com',
      title: 'Test',
      platform: 'example',
      extractedAt: Date.now(),
      commentsCount: comments.length,
      comments: comments,
    });

    const result = await store.getHistoryItem(id);

    expect(result).toBeDefined();
    expect(result?.id).toBe(id);
    expect(result?.comments).toEqual(comments);
  });

  it('should retrieve latest history id by url', async () => {
    await store.saveHistory({
      id: 'id_old',
      url: 'https://example.com',
      title: 'Test',
      platform: 'example',
      extractedAt: 1000,
      commentsCount: 1,
      comments: [],
    });

    await store.saveHistory({
      id: 'id_new',
      url: 'https://example.com',
      title: 'Test 2',
      platform: 'example',
      extractedAt: 2000,
      commentsCount: 1,
      comments: [],
    });

    const latestId = await store.getLatestHistoryIdByUrl('https://example.com');
    expect(latestId).toBe('id_new');
  });

  it('should delete a history item', async () => {
    const id = 'history_to_delete';
    await store.saveHistory({
      id,
      url: 'https://example.com',
      title: 'Test',
      platform: 'example',
      extractedAt: Date.now(),
      commentsCount: 1,
      comments: [],
    });

    await store.deleteHistoryItem(id);

    const result = await store.getHistoryItem(id);
    expect(result).toBeUndefined();
  });

  it('should return metadata search results without comment payloads', async () => {
    await store.saveHistory({
      id: 'history_metadata_search',
      url: 'https://example.com/search',
      title: 'Needle Title',
      platform: 'example',
      extractedAt: 1000,
      commentsCount: 1,
      comments: [
        {
          id: 'comment_1',
          username: 'user',
          content: 'large comment payload',
          likes: 0,
          timestamp: new Date().toISOString(),
          replies: [],
        },
      ],
    });

    const result = await store.searchHistoryMetadataPage('needle');

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual({
      id: 'history_metadata_search',
      extractedAt: 1000,
      url: 'https://example.com/search',
      title: 'Needle Title',
      platform: 'example',
    });
    expect(result.entries[0]).not.toHaveProperty('comments');
  });

  it('should recursively search comments for full history queries', async () => {
    await store.saveHistory({
      id: 'history_nested_comment_search',
      url: 'https://example.com/nested-search',
      title: 'Nested Search',
      platform: 'example',
      extractedAt: 1000,
      commentsCount: 1,
      comments: [
        {
          id: 'comment_parent',
          username: 'parent-user',
          content: 'parent content',
          likes: 0,
          timestamp: new Date().toISOString(),
          replies: [
            {
              id: 'comment_reply',
              username: 'reply-user',
              content: 'deep reply needle',
              likes: 0,
              timestamp: new Date().toISOString(),
              replies: [],
            },
          ],
        },
      ],
    });

    const fullResult = await store.searchHistoryPaginated('deep reply needle');
    const metadataResult = await store.searchHistoryMetadataPage('deep reply needle');

    expect(fullResult.total).toBe(1);
    expect(fullResult.items[0].id).toBe('history_nested_comment_search');
    expect(metadataResult.total).toBe(0);
  });

  it('should enforce the configured history retention limit', async () => {
    for (let index = 0; index < HISTORY.MAX_ITEMS + 2; index += 1) {
      await store.saveHistory({
        id: `history_${index}`,
        url: `https://example.com/${index}`,
        title: `History ${index}`,
        platform: 'example',
        extractedAt: index,
        commentsCount: 0,
        comments: [],
      });
    }

    const page = await store.getHistoryPage(0, HISTORY.MAX_ITEMS + 2);

    expect(page.total).toBe(HISTORY.MAX_ITEMS);
    expect(page.items.map((item) => item.id)).not.toContain('history_0');
    expect(page.items.map((item) => item.id)).not.toContain('history_1');
  });
});
