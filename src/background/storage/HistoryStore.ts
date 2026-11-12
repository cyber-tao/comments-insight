import { HistoryItem } from '@/types';
import { HISTORY, PAGINATION } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { sanitizeHistoryItem } from '@/utils/storage-validation';
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
    this.version(3).stores({
      history: 'id, extractedAt, url, title, platform',
      historyMetadata: 'id, extractedAt, url, title, platform, [url+extractedAt]',
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

function toHistoryWriteError(
  message: string,
  error: unknown,
  details: Record<string, unknown> = {},
): ExtensionError {
  if (error instanceof ExtensionError) {
    return error;
  }

  return new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, message, {
    ...details,
    originalError: error instanceof Error ? error.message : String(error),
  });
}

function getHistoryId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function requireValidHistoryItem(value: unknown): HistoryItem {
  const item = sanitizeHistoryItem(value);
  if (item) {
    return item;
  }

  throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Invalid history item', {
    historyId: getHistoryId(value),
  });
}

function checkHistoryWriteCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ExtensionError(ErrorCode.TASK_CANCELLED, 'History write cancelled');
  }
}

export class HistoryStore {
  async createHistory(item: HistoryItem, signal?: AbortSignal): Promise<void> {
    const historyId = getHistoryId(item);
    try {
      const sanitizedItem = requireValidHistoryItem(item);
      const prunedCount = await db.transaction('rw', db.history, db.historyMetadata, async () => {
        checkHistoryWriteCancelled(signal);
        await db.history.add(sanitizedItem);
        checkHistoryWriteCancelled(signal);
        await db.historyMetadata.put(toHistoryMetadata(sanitizedItem));
        checkHistoryWriteCancelled(signal);

        const count = await db.history.count();
        checkHistoryWriteCancelled(signal);
        if (count <= HISTORY.MAX_ITEMS) {
          return 0;
        }

        const itemsToDelete = await db.history
          .orderBy('extractedAt')
          .reverse()
          .offset(HISTORY.MAX_ITEMS)
          .toArray();
        checkHistoryWriteCancelled(signal);
        const idsToDelete = itemsToDelete.map((historyItem) => historyItem.id);
        await db.history.bulkDelete(idsToDelete);
        checkHistoryWriteCancelled(signal);
        await db.historyMetadata.bulkDelete(idsToDelete);
        checkHistoryWriteCancelled(signal);
        return idsToDelete.length;
      });

      Logger.info('[HistoryStore] History item created', { id: sanitizedItem.id });
      if (prunedCount > 0) {
        Logger.info('[HistoryStore] Pruned old history items', { count: prunedCount });
      }
    } catch (error) {
      const wrappedError = toHistoryWriteError('Failed to create history', error, { historyId });
      Logger.error('[HistoryStore] Failed to create history', { error: wrappedError });
      throw wrappedError;
    }
  }

  async updateHistory(item: HistoryItem, signal?: AbortSignal): Promise<boolean> {
    const historyId = getHistoryId(item);
    try {
      const sanitizedItem = requireValidHistoryItem(item);
      const updated = await db.transaction('rw', db.history, db.historyMetadata, async () => {
        checkHistoryWriteCancelled(signal);
        const existingItem = await db.history.get(sanitizedItem.id);
        checkHistoryWriteCancelled(signal);
        if (!existingItem) {
          return false;
        }

        await db.history.put(sanitizedItem);
        checkHistoryWriteCancelled(signal);
        await db.historyMetadata.put(toHistoryMetadata(sanitizedItem));
        checkHistoryWriteCancelled(signal);
        return true;
      });

      if (updated) {
        Logger.info('[HistoryStore] History item updated', { id: sanitizedItem.id });
      }
      return updated;
    } catch (error) {
      const wrappedError = toHistoryWriteError('Failed to update history', error, { historyId });
      Logger.error('[HistoryStore] Failed to update history', { error: wrappedError });
      throw wrappedError;
    }
  }

  async updateDynamicReport(
    id: string,
    source: { markdown: string; generatedAt: number },
    result: { html: string; tokensUsed: number },
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      return await db.transaction('rw', db.history, db.historyMetadata, async () => {
        const stored = await db.history.get(id);
        if (!stored) return false;
        if (signal?.aborted)
          throw new ExtensionError(ErrorCode.TASK_CANCELLED, 'Report generation cancelled');
        const item = requireValidHistoryItem(stored);
        if (
          !item.analysis ||
          item.analysis.markdown !== source.markdown ||
          item.analysis.generatedAt !== source.generatedAt
        ) {
          throw new ExtensionError(
            ErrorCode.VALIDATION_ERROR,
            'Source analysis changed; generate the report again',
          );
        }
        item.analysis = {
          ...item.analysis,
          dynamicHtml: result.html,
          tokensUsed: item.analysis.tokensUsed + result.tokensUsed,
        };
        await db.history.put(requireValidHistoryItem(item));
        await db.historyMetadata.put(toHistoryMetadata(item));
        if (signal?.aborted)
          throw new ExtensionError(ErrorCode.TASK_CANCELLED, 'Report generation cancelled');
        return true;
      });
    } catch (error) {
      throw toHistoryWriteError('Failed to update dynamic report', error, { historyId: id });
    }
  }

  async getLatestHistoryIdByUrl(url: string): Promise<string | null> {
    try {
      if (!url) return null;
      const item = await db.historyMetadata
        .where('[url+extractedAt]')
        .between([url, Dexie.minKey], [url, Dexie.maxKey])
        .last();
      return item?.id ?? null;
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

  async getHistoryMetadataPage(page: number = 0, pageSize: number = PAGINATION.DEFAULT_PER_PAGE) {
    try {
      const [total, items] = await db.transaction('r', db.historyMetadata, async () => {
        const ordered = db.historyMetadata.orderBy('extractedAt').reverse();
        // Dexie pagination mutates the collection; the count must stay unpaged.
        return Promise.all([
          ordered.clone().count(),
          ordered
            .clone()
            .offset(page * pageSize)
            .limit(pageSize)
            .toArray(),
        ]);
      });
      const totalPages = Math.ceil(total / pageSize);

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

  async searchHistoryMetadataPage(
    query: string,
    page: number = 0,
    pageSize: number = PAGINATION.DEFAULT_PER_PAGE,
  ) {
    try {
      const lowerQuery = query.toLowerCase();
      const [total, pageItems] = await db.transaction('r', db.historyMetadata, async () => {
        const orderedCollection = db.historyMetadata
          .orderBy('extractedAt')
          .reverse()
          .filter((entry) => historyMetadataMatchesQuery(entry, lowerQuery));

        return Promise.all([
          orderedCollection.clone().count(),
          orderedCollection
            .clone()
            .offset(page * pageSize)
            .limit(pageSize)
            .toArray(),
        ]);
      });
      const totalPages = Math.ceil(total / pageSize);

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

  async getHistoryItem(id: string): Promise<HistoryItem | undefined> {
    try {
      const storedItem = await db.history.get(id);
      if (!storedItem) {
        return undefined;
      }

      const item = sanitizeHistoryItem(storedItem, { dropInvalidAnalysis: true });
      if (!item) {
        throw new ExtensionError(ErrorCode.STORAGE_READ_ERROR, 'Invalid history item', {
          historyId: id,
        });
      }
      return item;
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
}
