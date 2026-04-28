import { Comment, HistoryItem } from '../../types';
import { HISTORY } from '@/config/constants';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '../../utils/errors';
import Dexie, { type Table } from 'dexie';

type HistoryMetadata = Pick<
  HistoryItem,
  | 'id'
  | 'url'
  | 'title'
  | 'platform'
  | 'videoTime'
  | 'postContent'
  | 'extractedAt'
  | 'commentsCount'
  | 'analyzedAt'
> & {
  hasAnalysis: boolean;
};

function toHistoryMetadata(item: HistoryItem): HistoryMetadata {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    platform: item.platform,
    videoTime: item.videoTime,
    postContent: item.postContent,
    extractedAt: item.extractedAt,
    commentsCount: item.commentsCount,
    analyzedAt: item.analyzedAt,
    hasAnalysis: Boolean(item.analysis),
  };
}

function toMetadataEntry(item: HistoryMetadata) {
  return {
    id: item.id,
    extractedAt: item.extractedAt,
    url: item.url,
    title: item.title,
    platform: item.platform,
  };
}

function textMatchesQuery(value: string | undefined, lowerQuery: string): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(lowerQuery);
}

function historyMetadataMatchesQuery(item: HistoryMetadata, lowerQuery: string): boolean {
  return (
    textMatchesQuery(item.title, lowerQuery) ||
    textMatchesQuery(item.url, lowerQuery) ||
    textMatchesQuery(item.platform, lowerQuery) ||
    textMatchesQuery(item.videoTime, lowerQuery) ||
    textMatchesQuery(item.postContent, lowerQuery)
  );
}

function commentMatchesQuery(comment: Comment, lowerQuery: string): boolean {
  return (
    textMatchesQuery(comment.username, lowerQuery) ||
    textMatchesQuery(comment.content, lowerQuery) ||
    textMatchesQuery(comment.timestamp, lowerQuery) ||
    comment.replies.some((reply) => commentMatchesQuery(reply, lowerQuery))
  );
}

function historyItemMatchesQuery(item: HistoryItem, lowerQuery: string): boolean {
  return (
    historyMetadataMatchesQuery(toHistoryMetadata(item), lowerQuery) ||
    item.comments.some((comment) => commentMatchesQuery(comment, lowerQuery))
  );
}

export class CommentsInsightDatabase extends Dexie {
  history!: Table<HistoryItem, string>;
  historyMetadata!: Table<HistoryMetadata, string>;

  constructor() {
    super('CommentsInsightDatabase');
    this.version(1).stores({
      history: 'id, extractedAt, url, title, platform',
    });
    this.version(2)
      .stores({
        history: 'id, extractedAt, url, title, platform',
        historyMetadata: 'id, extractedAt, url, title, platform',
      })
      .upgrade(async (transaction) => {
        const history = transaction.table<HistoryItem, string>('history');
        const historyMetadata = transaction.table<HistoryMetadata, string>('historyMetadata');
        await history.toCollection().each((item) => historyMetadata.put(toHistoryMetadata(item)));
      });
  }
}

const db = new CommentsInsightDatabase();

function toHistoryReadError(
  message: string,
  error: unknown,
  details: Record<string, unknown> = {},
): ExtensionError {
  if (error instanceof ExtensionError) {
    return error;
  }

  return new ExtensionError(ErrorCode.STORAGE_READ_ERROR, message, {
    ...details,
    originalError: error instanceof Error ? error.message : String(error),
  });
}

export class HistoryStore {
  async saveHistory(item: HistoryItem): Promise<void> {
    try {
      await db.transaction('rw', db.history, db.historyMetadata, async () => {
        await db.history.put(item);
        await db.historyMetadata.put(toHistoryMetadata(item));
      });
      await this.enforceHistoryLimit();
      Logger.info('[HistoryStore] History item saved', { id: item.id });
    } catch (error) {
      Logger.error('[HistoryStore] Failed to save history', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save history', {
        historyId: item.id,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getLatestHistoryIdByUrl(url: string): Promise<string | null> {
    try {
      if (!url) return null;
      const items = await db.historyMetadata.where('url').equals(url).sortBy('extractedAt');
      if (items.length === 0) return null;
      return items[items.length - 1].id;
    } catch (error) {
      const wrappedError = toHistoryReadError('Failed to get history id by url', error, { url });
      Logger.error('[HistoryStore] Failed to get history id by url', { url, error: wrappedError });
      throw wrappedError;
    }
  }

  async clearAllHistory(): Promise<number> {
    try {
      const count = await db.history.count();
      await db.transaction('rw', db.history, db.historyMetadata, async () => {
        await db.history.clear();
        await db.historyMetadata.clear();
      });
      return count;
    } catch (error) {
      Logger.error('[HistoryStore] Failed to clear all history', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to clear all history', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getHistory(): Promise<HistoryItem[]> {
    try {
      const items = await db.history.orderBy('extractedAt').reverse().toArray();
      return items;
    } catch (error) {
      const wrappedError = toHistoryReadError('Failed to get history', error);
      Logger.error('[HistoryStore] Failed to get history', { error: wrappedError });
      throw wrappedError;
    }
  }

  async getHistoryPage(page: number = 0, pageSize: number = 20) {
    try {
      const total = await db.historyMetadata.count();
      const totalPages = Math.ceil(total / pageSize);
      const metadata = await db.historyMetadata
        .orderBy('extractedAt')
        .reverse()
        .offset(page * pageSize)
        .limit(pageSize)
        .toArray();
      const items = await this.getItemsForMetadata(metadata);

      return { items, total, page, pageSize, totalPages };
    } catch (error) {
      const wrappedError = toHistoryReadError('Failed to get history page', error, {
        page,
        pageSize,
      });
      Logger.error('[HistoryStore] Failed to get history page', { error: wrappedError });
      throw wrappedError;
    }
  }

  async getHistoryMetadataPage(page: number = 0, pageSize: number = 20) {
    try {
      const total = await db.historyMetadata.count();
      const totalPages = Math.ceil(total / pageSize);
      const items = await db.historyMetadata
        .orderBy('extractedAt')
        .reverse()
        .offset(page * pageSize)
        .limit(pageSize)
        .toArray();

      const entries = items.map(toMetadataEntry);

      return { entries, total, page, pageSize, totalPages };
    } catch (error) {
      const wrappedError = toHistoryReadError('Failed to get history metadata page', error, {
        page,
        pageSize,
      });
      Logger.error('[HistoryStore] Failed to get history metadata page', { error: wrappedError });
      throw wrappedError;
    }
  }

  async searchHistoryMetadataPage(query: string, page: number = 0, pageSize: number = 20) {
    try {
      const lowerQuery = query.toLowerCase();
      const allItems = await db.historyMetadata.orderBy('extractedAt').reverse().toArray();

      const matchingItems = allItems.filter((entry) =>
        historyMetadataMatchesQuery(entry, lowerQuery),
      );

      const total = matchingItems.length;
      const totalPages = Math.ceil(total / pageSize);
      const start = page * pageSize;
      const pageItems = matchingItems.slice(start, start + pageSize);

      const entries = pageItems.map(toMetadataEntry);

      return { entries, total, page, pageSize, totalPages };
    } catch (error) {
      const wrappedError = toHistoryReadError('Failed to search history metadata page', error, {
        query,
        page,
        pageSize,
      });
      Logger.error('[HistoryStore] Failed to search history metadata page', {
        error: wrappedError,
      });
      throw wrappedError;
    }
  }

  async searchHistoryPaginated(query: string, page: number = 0, pageSize: number = 20) {
    try {
      const lowerQuery = query.toLowerCase();
      const matchingItems = await this.getMatchingHistoryItems(lowerQuery);

      const total = matchingItems.length;
      const totalPages = Math.ceil(total / pageSize);
      const start = page * pageSize;
      const items = matchingItems.slice(start, start + pageSize);

      return { items, total, page, pageSize, totalPages };
    } catch (error) {
      const wrappedError = toHistoryReadError('Failed to search history paginated', error, {
        query,
        page,
        pageSize,
      });
      Logger.error('[HistoryStore] Failed to search history paginated', { error: wrappedError });
      throw wrappedError;
    }
  }

  async getHistoryItem(id: string): Promise<HistoryItem | undefined> {
    try {
      return await db.history.get(id);
    } catch (error) {
      const wrappedError = toHistoryReadError('Failed to get history item', error, { id });
      Logger.error('[HistoryStore] Failed to get history item', { id, error: wrappedError });
      throw wrappedError;
    }
  }

  async deleteHistoryItem(id: string): Promise<void> {
    try {
      await db.transaction('rw', db.history, db.historyMetadata, async () => {
        await db.history.delete(id);
        await db.historyMetadata.delete(id);
      });
      Logger.info('[HistoryStore] History item deleted', { id });
    } catch (error) {
      Logger.error('[HistoryStore] Failed to delete history item', { id, error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to delete history', {
        historyId: id,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async searchHistory(query: string): Promise<HistoryItem[]> {
    try {
      const lowerQuery = query.toLowerCase();
      return await this.getMatchingHistoryItems(lowerQuery);
    } catch (error) {
      const wrappedError = toHistoryReadError('Failed to search history', error, { query });
      Logger.error('[HistoryStore] Failed to search history', { error: wrappedError });
      throw wrappedError;
    }
  }

  invalidateSortedIndexCache(): void {
    // No-op for IndexedDB
  }

  private async enforceHistoryLimit(): Promise<void> {
    const total = await db.historyMetadata.count();
    if (total <= HISTORY.MAX_ITEMS) {
      return;
    }

    const itemsToDelete = await db.historyMetadata
      .orderBy('extractedAt')
      .reverse()
      .offset(HISTORY.MAX_ITEMS)
      .toArray();
    const idsToDelete = itemsToDelete.map((item) => item.id);
    if (idsToDelete.length > 0) {
      await db.transaction('rw', db.history, db.historyMetadata, async () => {
        await db.history.bulkDelete(idsToDelete);
        await db.historyMetadata.bulkDelete(idsToDelete);
      });
      Logger.info('[HistoryStore] Pruned old history items', { count: idsToDelete.length });
    }
  }

  private async getMatchingHistoryItems(lowerQuery: string): Promise<HistoryItem[]> {
    const allItems = await db.history.orderBy('extractedAt').reverse().toArray();
    return allItems.filter((item) => historyItemMatchesQuery(item, lowerQuery));
  }

  private async getItemsForMetadata(metadata: HistoryMetadata[]): Promise<HistoryItem[]> {
    const items = await db.history.bulkGet(metadata.map((item) => item.id));
    return items.filter((item): item is HistoryItem => Boolean(item));
  }
}
