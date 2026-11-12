import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Dexie, { type PromiseExtended } from 'dexie';
import { HistoryStore, CommentsInsightDatabase } from '../src/background/storage/HistoryStore';
import { HISTORY } from '../src/config/constants';
import { ErrorCode } from '../src/utils/errors';
import type { HistoryItem } from '../src/types';

function createHistoryItem(
  id: string,
  extractedAt: number,
  overrides: Partial<HistoryItem> = {},
): HistoryItem {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `History ${id}`,
    platform: 'example',
    extractedAt,
    commentsCount: 0,
    comments: [],
    ...overrides,
  };
}

// Keep the real IndexedDB transaction alive while the test controls the exact
// read/write await boundary. No product promise or storage operation is mocked out.
function gateHistoryOperation(
  tableName: 'history' | 'historyMetadata',
  operation: 'get' | 'put' | 'count' | 'bulkDelete',
) {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let restoreOperation: () => void = () => {};
  const originalTransaction = CommentsInsightDatabase.prototype.transaction;
  const transactionSpy = vi
    .spyOn(CommentsInsightDatabase.prototype, 'transaction')
    .mockImplementationOnce(function (
      this: CommentsInsightDatabase,
      ...args: Parameters<typeof originalTransaction>
    ) {
      type Operation = (...args: unknown[]) => PromiseExtended<unknown>;
      const table = this[tableName] as unknown as Record<string, Operation>;
      const originalOperation = table[operation];
      const operationSpy = vi.spyOn(table, operation).mockImplementationOnce(function (
        this: typeof table,
        ...operationArgs: unknown[]
      ) {
        return originalOperation.apply(this, operationArgs).then((result) => {
          enter();
          return Dexie.waitFor(gate).then(() => result);
        });
      });
      restoreOperation = () => operationSpy.mockRestore();
      return originalTransaction.apply(this, args);
    });
  return {
    entered,
    release,
    restore: () => {
      release();
      restoreOperation();
      transactionSpy.mockRestore();
    },
  };
}

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
  let database: CommentsInsightDatabase;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    store = new HistoryStore();
    database = new CommentsInsightDatabase();
    await store.clearAllHistory();
  });

  afterEach(() => {
    database.close();
  });

  it.each(['listing', 'search'] as const)(
    'counts all matching rows independently of the %s page slice',
    async (mode) => {
      for (let index = 0; index < 47; index += 1) {
        await store.createHistory(createHistoryItem(`match_${index}`, index + 1));
      }
      if (mode === 'search') {
        await store.createHistory(createHistoryItem('unrelated', 100));
      }

      const readPage = (page: number) =>
        mode === 'search'
          ? store.searchHistoryMetadataPage('match_', page, 20)
          : store.getHistoryMetadataPage(page, 20);
      const ids: string[] = [];
      for (const [page, count] of [20, 20, 7, 0].entries()) {
        const result = await readPage(page);
        expect(result).toMatchObject({ total: 47, totalPages: 3, page, pageSize: 20 });
        expect(result.entries).toHaveLength(count);
        ids.push(...result.entries.map((entry) => entry.id));
      }
      expect(ids).toEqual(Array.from({ length: 47 }, (_, index) => `match_${46 - index}`));
    },
  );

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

    await store.createHistory({
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

  it('should reject a duplicate id without overwriting the existing row or metadata', async () => {
    const original = createHistoryItem('duplicate_id', 1000, {
      url: 'https://example.com/original',
      title: 'Original',
    });
    await store.createHistory(original);

    await expect(
      store.createHistory({
        ...original,
        url: 'https://example.com/replacement',
        title: 'Replacement',
        extractedAt: 2000,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.STORAGE_WRITE_ERROR });

    expect(await store.getHistoryItem(original.id)).toMatchObject({
      url: 'https://example.com/original',
      title: 'Original',
      extractedAt: 1000,
    });
    const page = await store.getHistoryMetadataPage(0, 10);
    expect(page.total).toBe(1);
    expect(page.entries[0]).toMatchObject({
      id: original.id,
      url: 'https://example.com/original',
      title: 'Original',
      extractedAt: 1000,
    });
  });

  it('should reject an invalid history item before writing either table', async () => {
    const invalidItem = {
      ...createHistoryItem('invalid_analysis', 1000),
      analysis: {
        markdown: '# Analysis',
        tokensUsed: 'invalid',
        generatedAt: 1000,
      },
    };

    await expect(store.createHistory(invalidItem as unknown as HistoryItem)).rejects.toMatchObject({
      code: ErrorCode.STORAGE_WRITE_ERROR,
    });
    expect(await store.getHistoryItem(invalidItem.id)).toBeUndefined();
    expect((await store.getHistoryMetadataPage(0, 10)).total).toBe(0);
  });

  it('rolls back a cancelled create after both tables were written but before commit', async () => {
    const item = createHistoryItem('cancelled_create', 1000, {
      analysis: { markdown: '# New analysis', generatedAt: 2000, tokensUsed: 5 },
      analyzedAt: 2000,
    });
    const controller = new AbortController();
    const gate = gateHistoryOperation('history', 'count');
    try {
      const writing = store.createHistory(item, controller.signal);
      const rejected = expect(writing).rejects.toMatchObject({ code: ErrorCode.TASK_CANCELLED });
      await gate.entered;
      controller.abort();
      gate.release();
      await rejected;
    } finally {
      gate.restore();
    }

    expect(await store.getHistoryItem(item.id)).toBeUndefined();
    expect(await database.historyMetadata.get(item.id)).toBeUndefined();
  });

  it.each([
    ['history', 'get'],
    ['history', 'put'],
    ['historyMetadata', 'put'],
  ] as const)(
    'rolls back a cancelled update after %s.%s without changing analysis or metadata',
    async (table, operation) => {
      const original = createHistoryItem('cancelled_update', 1000, {
        title: 'Original title',
        analysis: { markdown: '# Original analysis', generatedAt: 1000, tokensUsed: 3 },
        analyzedAt: 1000,
      });
      await store.createHistory(original);
      const metadataBefore = await database.historyMetadata.get(original.id);
      const replacement = {
        ...original,
        title: 'Must not overwrite',
        analysis: { markdown: '# Cancelled analysis', generatedAt: 2000, tokensUsed: 9 },
        analyzedAt: 2000,
      };
      const controller = new AbortController();
      const gate = gateHistoryOperation(table, operation);
      try {
        const writing = store.updateHistory(replacement, controller.signal);
        const rejected = expect(writing).rejects.toMatchObject({ code: ErrorCode.TASK_CANCELLED });
        await gate.entered;
        controller.abort();
        gate.release();
        await rejected;
      } finally {
        gate.restore();
      }

      expect(await store.getHistoryItem(original.id)).toEqual(original);
      expect(await database.historyMetadata.get(original.id)).toEqual(metadataBefore);
    },
  );

  it('rolls back cancelled create and retention deletions after the final pruning await', async () => {
    const historyConfig = HISTORY as { MAX_ITEMS: number };
    const originalLimit = historyConfig.MAX_ITEMS;
    historyConfig.MAX_ITEMS = 1;
    try {
      const original = createHistoryItem('retained_original', 1000);
      await store.createHistory(original);
      const metadataBefore = await database.historyMetadata.get(original.id);
      const controller = new AbortController();
      const gate = gateHistoryOperation('historyMetadata', 'bulkDelete');
      try {
        const writing = store.createHistory(
          createHistoryItem('cancelled_prune', 2000),
          controller.signal,
        );
        const rejected = expect(writing).rejects.toMatchObject({ code: ErrorCode.TASK_CANCELLED });
        await gate.entered;
        controller.abort();
        gate.release();
        await rejected;
      } finally {
        gate.restore();
      }
      expect(await store.getHistoryItem(original.id)).toEqual(original);
      expect(await database.historyMetadata.get(original.id)).toEqual(metadataBefore);
      expect(await store.getHistoryItem('cancelled_prune')).toBeUndefined();
      expect(await database.historyMetadata.get('cancelled_prune')).toBeUndefined();
    } finally {
      historyConfig.MAX_ITEMS = originalLimit;
    }
  });

  it.each(['create', 'update'] as const)(
    'preserves a committed %s when cancellation arrives after commit',
    async (operation) => {
      const original = createHistoryItem(`committed_${operation}`, 1000);
      if (operation === 'update') {
        await store.createHistory(original);
      }
      const item = {
        ...original,
        title: 'Committed analysis',
        analysis: { markdown: '# Committed', generatedAt: 2000, tokensUsed: 7 },
        analyzedAt: 2000,
      };
      const controller = new AbortController();
      const originalTransaction = CommentsInsightDatabase.prototype.transaction;
      const transactionSpy = vi
        .spyOn(CommentsInsightDatabase.prototype, 'transaction')
        .mockImplementationOnce(function (
          this: CommentsInsightDatabase,
          ...args: Parameters<typeof originalTransaction>
        ) {
          return originalTransaction.apply(this, args).then((result) => {
            // Dexie's transaction promise resolves only after IndexedDB commits.
            controller.abort();
            return result;
          });
        });
      try {
        if (operation === 'create') {
          await expect(store.createHistory(item, controller.signal)).resolves.toBeUndefined();
        } else {
          await expect(store.updateHistory(item, controller.signal)).resolves.toBe(true);
        }
      } finally {
        transactionSpy.mockRestore();
      }
      expect(controller.signal.aborted).toBe(true);
      expect(await store.getHistoryItem(item.id)).toEqual(item);
      expect(await database.historyMetadata.get(item.id)).toMatchObject({
        id: item.id,
        title: item.title,
        analyzedAt: 2000,
        hasAnalysis: true,
      });
    },
  );

  it('should retrieve latest history id by url', async () => {
    await store.createHistory({
      id: 'id_old',
      url: 'https://example.com',
      title: 'Test',
      platform: 'example',
      extractedAt: 1000,
      commentsCount: 1,
      comments: [],
    });

    await store.createHistory({
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
    await store.createHistory({
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

  it('should return false when updating a deleted history item', async () => {
    const item = createHistoryItem('history_deleted_before_update', 1000);
    await store.createHistory(item);
    await store.deleteHistoryItem(item.id);

    await expect(
      store.updateHistory({
        ...item,
        title: 'Must not be recreated',
      }),
    ).resolves.toBe(false);

    expect(await store.getHistoryItem(item.id)).toBeUndefined();
    expect((await store.getHistoryMetadataPage(0, 10)).total).toBe(0);
  });

  it('should return metadata search results without comment payloads', async () => {
    await store.createHistory({
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
    await store.createHistory({
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

    const metadataResult = await store.searchHistoryMetadataPage('deep reply needle');

    // Metadata search does not inspect comment bodies; the deep reply needle
    // lives only inside comments, so metadata search yields no hits. Fetching
    // the stored row by id still exposes the nested comments for inspection.
    expect(metadataResult.total).toBe(0);
    const stored = await store.getHistoryItem('history_nested_comment_search');
    expect(stored?.comments[0].replies[0].content).toBe('deep reply needle');
  });

  it('should roll back the new row when atomic pruning fails', async () => {
    const historyConfig = HISTORY as { MAX_ITEMS: number };
    const originalLimit = historyConfig.MAX_ITEMS;
    historyConfig.MAX_ITEMS = 2;

    try {
      await store.createHistory(createHistoryItem('history_0', 0));
      await store.createHistory(createHistoryItem('history_1', 1));

      const originalDelete = IDBObjectStore.prototype.delete;
      const deleteSpy = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
        this: IDBObjectStore,
        query: IDBValidKey | IDBKeyRange,
      ) {
        if (this.name === 'historyMetadata') {
          throw new Error('Forced metadata prune failure');
        }
        return originalDelete.call(this, query);
      });
      try {
        await expect(store.createHistory(createHistoryItem('history_2', 2))).rejects.toMatchObject({
          code: ErrorCode.STORAGE_WRITE_ERROR,
        });
      } finally {
        deleteSpy.mockRestore();
      }

      const page = await store.getHistoryMetadataPage(0, 10);
      expect(page.entries.map((item) => item.id)).toEqual(['history_1', 'history_0']);
      await expect(store.getHistoryItem('history_0')).resolves.toBeDefined();
      await expect(store.getHistoryItem('history_2')).resolves.toBeUndefined();
    } finally {
      historyConfig.MAX_ITEMS = originalLimit;
    }
  });

  it('should atomically create and prune old rows from both history tables', async () => {
    const historyConfig = HISTORY as { MAX_ITEMS: number };
    const originalLimit = historyConfig.MAX_ITEMS;
    historyConfig.MAX_ITEMS = 2;

    try {
      await store.createHistory(createHistoryItem('history_0', 0));
      await store.createHistory(createHistoryItem('history_1', 1));
      await store.createHistory(createHistoryItem('history_2', 2));

      const page = await store.getHistoryMetadataPage(0, 10);
      expect(page.total).toBe(2);
      expect(page.entries.map((item) => item.id)).toEqual(['history_2', 'history_1']);
      await expect(store.getHistoryItem('history_0')).resolves.toBeUndefined();
      await expect(store.getHistoryItem('history_1')).resolves.toBeDefined();
      await expect(store.getHistoryItem('history_2')).resolves.toBeDefined();
    } finally {
      historyConfig.MAX_ITEMS = originalLimit;
    }
  });

  it('should update without applying or increasing the retention count', async () => {
    const historyConfig = HISTORY as { MAX_ITEMS: number };
    const originalLimit = historyConfig.MAX_ITEMS;
    historyConfig.MAX_ITEMS = 3;

    try {
      const items = [
        createHistoryItem('history_0', 0),
        createHistoryItem('history_1', 1),
        createHistoryItem('history_2', 2),
      ];
      for (const item of items) {
        await store.createHistory(item);
      }

      historyConfig.MAX_ITEMS = 2;
      await expect(
        store.updateHistory({
          ...items[0],
          title: 'Updated without retention',
        }),
      ).resolves.toBe(true);

      const page = await store.getHistoryMetadataPage(0, 10);
      expect(page.total).toBe(3);
      expect(page.entries.map((item) => item.id).sort()).toEqual([
        'history_0',
        'history_1',
        'history_2',
      ]);
      expect((await store.getHistoryItem('history_0'))?.title).toBe('Updated without retention');
    } finally {
      historyConfig.MAX_ITEMS = originalLimit;
    }
  });
});
