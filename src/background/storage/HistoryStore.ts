import { HistoryItem } from '../../types';
import { STORAGE, HISTORY } from '@/config/constants';
import LZString from 'lz-string';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '../../utils/errors';

export interface HistoryIndexEntry {
  id: string;
  extractedAt: number;
  url: string;
  title: string;
  platform: string;
}

export interface HistorySortedIndex {
  entries: HistoryIndexEntry[];
  lastUpdated: number;
}

export class HistoryStore {
  private sortedIndexCache: HistorySortedIndex | null = null;

  async saveHistory(item: HistoryItem): Promise<void> {
    try {
      const baseKey = `${STORAGE.HISTORY_KEY}_${item.id}`;
      const compressedComments = LZString.compressToUTF16(JSON.stringify(item.comments));
      const chunks: string[] = [];
      for (let i = 0; i < compressedComments.length; i += HISTORY.COMMENTS_CHUNK_SIZE) {
        chunks.push(compressedComments.slice(i, i + HISTORY.COMMENTS_CHUNK_SIZE));
      }

      const toSet: Record<string, unknown> = {};

      if (chunks.length <= 1) {
        toSet[baseKey] = {
          ...item,
          comments: compressedComments,
        };
      } else {
        for (let i = 0; i < chunks.length; i++) {
          toSet[`${baseKey}_comments_${i}`] = chunks[i];
        }
        toSet[baseKey] = {
          ...item,
          comments: '',
          commentsChunks: chunks.length,
        };
      }

      await chrome.storage.local.set(toSet);
      await this.updateHistoryIndex(item.id);

      const indexUpdates: Promise<void>[] = [this.addToSortedIndex(item)];
      if (typeof item.url === 'string' && item.url.length > 0) {
        indexUpdates.push(this.addToHistoryUrlIndex(item.url, item.id));
      }
      await Promise.all(indexUpdates);

      Logger.info('[HistoryStore] History item saved', { id: item.id });
    } catch (error) {
      this.sortedIndexCache = null;
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
      const index = await this.getHistoryUrlIndex();
      const ids = index[url];
      if (!ids || ids.length === 0) return null;
      return ids[ids.length - 1] || null;
    } catch (error) {
      Logger.error('[HistoryStore] Failed to get history id by url', { url, error });
      return null;
    }
  }

  async clearAllHistory(): Promise<number> {
    try {
      const ids = await this.getHistoryIndex();
      const keysToRemove: string[] = [];
      let metadataReadFailures = 0;

      for (const id of ids) {
        const baseKey = `${STORAGE.HISTORY_KEY}_${id}`;
        keysToRemove.push(baseKey);

        try {
          const meta = await chrome.storage.local.get(baseKey);
          const storedItem = meta[baseKey] as { commentsChunks?: number } | undefined;
          const chunks = storedItem?.commentsChunks || 0;
          for (let i = 0; i < chunks; i++) {
            keysToRemove.push(`${baseKey}_comments_${i}`);
          }
        } catch {
          metadataReadFailures += 1;
        }
      }

      if (metadataReadFailures > 0) {
        Logger.debug('[HistoryStore] Failed to read history chunks metadata during clear', {
          metadataReadFailures,
          totalHistoryItems: ids.length,
        });
      }

      keysToRemove.push(STORAGE.HISTORY_INDEX_KEY);
      keysToRemove.push(STORAGE.HISTORY_URL_INDEX_KEY);
      keysToRemove.push(STORAGE.HISTORY_SORTED_INDEX_KEY);

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }

      this.sortedIndexCache = null;
      return ids.length;
    } catch (error) {
      Logger.error('[HistoryStore] Failed to clear all history', { error });
      return 0;
    }
  }

  async getHistory(): Promise<HistoryItem[]> {
    try {
      const index = await this.getHistoryIndex();
      const results = await Promise.all(index.map((id) => this.getHistoryItem(id)));
      const items = results.filter((item): item is HistoryItem => item !== undefined);
      return items.sort((a, b) => b.extractedAt - a.extractedAt);
    } catch (error) {
      Logger.error('[HistoryStore] Failed to get history', { error });
      return [];
    }
  }

  async getHistoryPage(page: number = 0, pageSize: number = 20) {
    try {
      const sortedIndex = await this.getOrBuildSortedIndex();
      const total = sortedIndex.entries.length;
      const totalPages = Math.ceil(total / pageSize);
      const start = page * pageSize;
      const end = Math.min(start + pageSize, total);

      const pageEntries = sortedIndex.entries.slice(start, end);
      const results = await Promise.all(pageEntries.map((entry) => this.getHistoryItem(entry.id)));
      const items = results.filter((item): item is HistoryItem => item !== undefined);

      return { items, total, page, pageSize, totalPages };
    } catch (error) {
      Logger.error('[HistoryStore] Failed to get history page', { error });
      return { items: [], total: 0, page, pageSize, totalPages: 0 };
    }
  }

  async getHistoryMetadataPage(page: number = 0, pageSize: number = 20) {
    try {
      const sortedIndex = await this.getOrBuildSortedIndex();
      const total = sortedIndex.entries.length;
      const totalPages = Math.ceil(total / pageSize);
      const start = page * pageSize;
      const end = Math.min(start + pageSize, total);
      const entries = sortedIndex.entries.slice(start, end);

      return { entries, total, page, pageSize, totalPages };
    } catch (error) {
      Logger.error('[HistoryStore] Failed to get history metadata page', { error });
      return { entries: [], total: 0, page, pageSize, totalPages: 0 };
    }
  }

  async searchHistoryMetadataPage(query: string, page: number = 0, pageSize: number = 20) {
    try {
      const sortedIndex = await this.getOrBuildSortedIndex();
      const lowerQuery = query.toLowerCase();

      const matchingEntries = sortedIndex.entries.filter(
        (entry) =>
          entry.title.toLowerCase().includes(lowerQuery) ||
          entry.url.toLowerCase().includes(lowerQuery) ||
          entry.platform.toLowerCase().includes(lowerQuery),
      );

      const total = matchingEntries.length;
      const totalPages = Math.ceil(total / pageSize);
      const start = page * pageSize;
      const end = Math.min(start + pageSize, total);
      const entries = matchingEntries.slice(start, end);

      return { entries, total, page, pageSize, totalPages };
    } catch (error) {
      Logger.error('[HistoryStore] Failed to search history metadata page', { error });
      return { entries: [], total: 0, page, pageSize, totalPages: 0 };
    }
  }

  async searchHistoryPaginated(query: string, page: number = 0, pageSize: number = 20) {
    try {
      const sortedIndex = await this.getOrBuildSortedIndex();
      const lowerQuery = query.toLowerCase();

      const matchingEntries = sortedIndex.entries.filter(
        (entry) =>
          entry.title.toLowerCase().includes(lowerQuery) ||
          entry.url.toLowerCase().includes(lowerQuery) ||
          entry.platform.toLowerCase().includes(lowerQuery),
      );

      const total = matchingEntries.length;
      const totalPages = Math.ceil(total / pageSize);
      const start = page * pageSize;
      const end = Math.min(start + pageSize, total);
      const pageEntries = matchingEntries.slice(start, end);

      const items: HistoryItem[] = [];
      for (const entry of pageEntries) {
        const item = await this.getHistoryItem(entry.id);
        if (item) items.push(item);
      }

      return { items, total, page, pageSize, totalPages };
    } catch (error) {
      Logger.error('[HistoryStore] Failed to search history paginated', { error });
      return { items: [], total: 0, page, pageSize, totalPages: 0 };
    }
  }

  async getHistoryItem(id: string): Promise<HistoryItem | undefined> {
    try {
      const baseKey = `${STORAGE.HISTORY_KEY}_${id}`;
      const result = await chrome.storage.local.get(baseKey);
      const compressedItem = result[baseKey] as
        | (Omit<HistoryItem, 'comments'> & { comments: string; commentsChunks?: number })
        | undefined;

      if (!compressedItem) return undefined;

      let compressedComments = compressedItem.comments;

      if (!compressedComments && typeof compressedItem.commentsChunks === 'number') {
        const chunks: string[] = [];
        for (let i = 0; i < compressedItem.commentsChunks; i++) {
          const chunkKey = `${baseKey}_comments_${i}`;
          const chunkResult = await chrome.storage.local.get(chunkKey);
          const chunk = chunkResult[chunkKey] as string | undefined;
          if (typeof chunk === 'string') chunks.push(chunk);
        }
        compressedComments = chunks.join('');
      }

      const decompressed = compressedComments
        ? LZString.decompressFromUTF16(compressedComments)
        : null;
      if (compressedComments && decompressed === null) {
        throw new ExtensionError(
          ErrorCode.STORAGE_READ_ERROR,
          'Failed to decompress history comments',
          { id },
        );
      }

      const comments = decompressed ? JSON.parse(decompressed) : [];
      if (!Array.isArray(comments)) {
        throw new ExtensionError(ErrorCode.STORAGE_READ_ERROR, 'Invalid history comments payload', {
          id,
        });
      }

      return {
        ...compressedItem,
        comments,
      } as HistoryItem;
    } catch (error) {
      Logger.error('[HistoryStore] Failed to get history item', { id, error });
      return undefined;
    }
  }

  async deleteHistoryItem(id: string): Promise<void> {
    try {
      const baseKey = `${STORAGE.HISTORY_KEY}_${id}`;
      const meta = await chrome.storage.local.get(baseKey);
      const storedItem = meta[baseKey] as { url?: string; commentsChunks?: number } | undefined;

      const keysToRemove: string[] = [baseKey];
      const chunks = storedItem?.commentsChunks || 0;
      for (let i = 0; i < chunks; i++) {
        keysToRemove.push(`${baseKey}_comments_${i}`);
      }

      await chrome.storage.local.remove(keysToRemove);

      const indexRemovals: Promise<void>[] = [
        this.removeFromHistoryIndex(id),
        this.removeFromSortedIndex(id),
      ];
      if (storedItem?.url) {
        indexRemovals.push(this.removeFromHistoryUrlIndex(storedItem.url, id));
      }
      await Promise.all(indexRemovals);
      Logger.info('[HistoryStore] History item deleted', { id });
    } catch (error) {
      this.sortedIndexCache = null;
      Logger.error('[HistoryStore] Failed to delete history item', { id, error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to delete history', {
        historyId: id,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async searchHistory(query: string): Promise<HistoryItem[]> {
    try {
      const allHistory = await this.getHistory();
      const lowerQuery = query.toLowerCase();

      return allHistory.filter(
        (item) =>
          item.title.toLowerCase().includes(lowerQuery) ||
          item.url.toLowerCase().includes(lowerQuery) ||
          item.platform.toLowerCase().includes(lowerQuery),
      );
    } catch (error) {
      Logger.error('[HistoryStore] Failed to search history', { error });
      return [];
    }
  }

  private async getHistoryIndex(): Promise<string[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE.HISTORY_INDEX_KEY);
      return (result[STORAGE.HISTORY_INDEX_KEY] as string[]) || [];
    } catch (error) {
      Logger.error('[HistoryStore] Failed to get history index', { error });
      return [];
    }
  }

  private async updateHistoryIndex(id: string): Promise<void> {
    try {
      const index = await this.getHistoryIndex();
      if (!index.includes(id)) {
        index.push(id);
      }
      if (index.length > HISTORY.MAX_ITEMS) {
        const toRemove = index.slice(0, index.length - HISTORY.MAX_ITEMS);
        const kept = index.slice(index.length - HISTORY.MAX_ITEMS);
        await chrome.storage.local.set({ [STORAGE.HISTORY_INDEX_KEY]: kept });

        for (const oldId of toRemove) {
          try {
            await this.deleteHistoryItem(oldId);
          } catch (e) {
            Logger.warn('[HistoryStore] Failed to prune history item', { id: oldId, error: e });
          }
        }
        return;
      }
      await chrome.storage.local.set({ [STORAGE.HISTORY_INDEX_KEY]: index });
    } catch (error) {
      Logger.error('[HistoryStore] Failed to update history index', { error });
    }
  }

  private async removeFromHistoryIndex(id: string): Promise<void> {
    try {
      const index = await this.getHistoryIndex();
      const filteredIndex = index.filter((itemId) => itemId !== id);
      await chrome.storage.local.set({ [STORAGE.HISTORY_INDEX_KEY]: filteredIndex });
    } catch (error) {
      Logger.error('[HistoryStore] Failed to remove from history index', { error });
    }
  }

  private async getHistoryUrlIndex(): Promise<Record<string, string[]>> {
    try {
      const result = await chrome.storage.local.get(STORAGE.HISTORY_URL_INDEX_KEY);
      return (result[STORAGE.HISTORY_URL_INDEX_KEY] as Record<string, string[]>) || {};
    } catch (error) {
      Logger.error('[HistoryStore] Failed to get history url index', { error });
      return {};
    }
  }

  private async setHistoryUrlIndex(index: Record<string, string[]>): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE.HISTORY_URL_INDEX_KEY]: index });
    } catch (error) {
      Logger.error('[HistoryStore] Failed to set history url index', { error });
    }
  }

  private async addToHistoryUrlIndex(url: string, id: string): Promise<void> {
    const index = await this.getHistoryUrlIndex();
    const existing = index[url] || [];
    const next = existing.includes(id) ? existing : [...existing, id];
    index[url] = next;
    await this.setHistoryUrlIndex(index);
  }

  private async removeFromHistoryUrlIndex(url: string, id: string): Promise<void> {
    const index = await this.getHistoryUrlIndex();
    const existing = index[url];
    if (!existing || existing.length === 0) return;
    const next = existing.filter((x) => x !== id);
    if (next.length === 0) {
      delete index[url];
    } else {
      index[url] = next;
    }
    await this.setHistoryUrlIndex(index);
  }

  private async getOrBuildSortedIndex(): Promise<HistorySortedIndex> {
    if (this.sortedIndexCache) return this.sortedIndexCache;
    try {
      const result = await chrome.storage.local.get(STORAGE.HISTORY_SORTED_INDEX_KEY);
      const storedIndex = result[STORAGE.HISTORY_SORTED_INDEX_KEY] as
        | HistorySortedIndex
        | undefined;
      if (storedIndex && storedIndex.entries) {
        this.sortedIndexCache = storedIndex;
        return storedIndex;
      }
      return await this.rebuildSortedIndex();
    } catch (error) {
      Logger.error('[HistoryStore] Failed to get sorted index', { error });
      return { entries: [], lastUpdated: Date.now() };
    }
  }

  private async rebuildSortedIndex(): Promise<HistorySortedIndex> {
    try {
      const ids = await this.getHistoryIndex();
      const entries: HistoryIndexEntry[] = [];
      for (const id of ids) {
        const baseKey = `${STORAGE.HISTORY_KEY}_${id}`;
        const result = await chrome.storage.local.get(baseKey);
        const item = result[baseKey] as
          | { id: string; extractedAt: number; url: string; title: string; platform: string }
          | undefined;
        if (item) {
          entries.push({
            id: item.id,
            extractedAt: item.extractedAt,
            url: item.url,
            title: item.title,
            platform: item.platform,
          });
        }
      }
      entries.sort((a, b) => b.extractedAt - a.extractedAt);
      const sortedIndex: HistorySortedIndex = { entries, lastUpdated: Date.now() };
      await chrome.storage.local.set({ [STORAGE.HISTORY_SORTED_INDEX_KEY]: sortedIndex });
      this.sortedIndexCache = sortedIndex;
      Logger.debug('[HistoryStore] Sorted index rebuilt', { count: entries.length });
      return sortedIndex;
    } catch (error) {
      Logger.error('[HistoryStore] Failed to rebuild sorted index', { error });
      return { entries: [], lastUpdated: Date.now() };
    }
  }

  private async addToSortedIndex(item: HistoryItem): Promise<void> {
    try {
      const index = await this.getOrBuildSortedIndex();
      const existingIdx = index.entries.findIndex((e) => e.id === item.id);
      if (existingIdx !== -1) index.entries.splice(existingIdx, 1);

      const entry: HistoryIndexEntry = {
        id: item.id,
        extractedAt: item.extractedAt,
        url: item.url,
        title: item.title,
        platform: item.platform,
      };

      let left = 0;
      let right = index.entries.length;
      while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (index.entries[mid].extractedAt > entry.extractedAt) {
          left = mid + 1;
        } else {
          right = mid;
        }
      }
      index.entries.splice(left, 0, entry);
      index.lastUpdated = Date.now();

      await chrome.storage.local.set({ [STORAGE.HISTORY_SORTED_INDEX_KEY]: index });
      this.sortedIndexCache = index;
    } catch (error) {
      Logger.error('[HistoryStore] Failed to add to sorted index', { error });
      this.sortedIndexCache = null;
    }
  }

  private async removeFromSortedIndex(id: string): Promise<void> {
    try {
      const index = await this.getOrBuildSortedIndex();
      const idx = index.entries.findIndex((e) => e.id === id);
      if (idx !== -1) {
        index.entries.splice(idx, 1);
        index.lastUpdated = Date.now();
        await chrome.storage.local.set({ [STORAGE.HISTORY_SORTED_INDEX_KEY]: index });
        this.sortedIndexCache = index;
      }
    } catch (error) {
      Logger.error('[HistoryStore] Failed to remove from sorted index', { error });
      this.sortedIndexCache = null;
    }
  }

  invalidateSortedIndexCache(): void {
    this.sortedIndexCache = null;
  }
}
