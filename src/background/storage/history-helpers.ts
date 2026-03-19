import type { HistoryItem } from '@/types';
import { HISTORY, STORAGE } from '@/config/constants';
import LZString from 'lz-string';

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

export function getHistoryBaseKey(id: string): string {
  return `${STORAGE.HISTORY_KEY}_${id}`;
}

export function createHistoryIndexEntry(
  item: Pick<HistoryItem, 'id' | 'extractedAt' | 'url' | 'title' | 'platform'>,
): HistoryIndexEntry {
  return {
    id: item.id,
    extractedAt: item.extractedAt,
    url: item.url,
    title: item.title,
    platform: item.platform,
  };
}

export function buildStoredHistoryPayload(item: HistoryItem): {
  payload: Record<string, unknown>;
  storageKeys: string[];
} {
  const baseKey = getHistoryBaseKey(item.id);
  const compressedComments = LZString.compressToUTF16(JSON.stringify(item.comments));
  const chunks: string[] = [];

  for (let index = 0; index < compressedComments.length; index += HISTORY.COMMENTS_CHUNK_SIZE) {
    chunks.push(compressedComments.slice(index, index + HISTORY.COMMENTS_CHUNK_SIZE));
  }

  const payload: Record<string, unknown> = {};

  if (chunks.length <= 1) {
    payload[baseKey] = {
      ...item,
      comments: compressedComments,
    };
  } else {
    for (let index = 0; index < chunks.length; index += 1) {
      payload[`${baseKey}_comments_${index}`] = chunks[index];
    }

    payload[baseKey] = {
      ...item,
      comments: '',
      commentsChunks: chunks.length,
    };
  }

  return {
    payload,
    storageKeys: Object.keys(payload),
  };
}

export function getHistoryChunkKeys(baseKey: string, commentsChunks: number): string[] {
  const keys: string[] = [];
  for (let index = 0; index < commentsChunks; index += 1) {
    keys.push(`${baseKey}_comments_${index}`);
  }
  return keys;
}

export function matchesHistoryQuery(
  entry: Pick<HistoryIndexEntry, 'title' | 'url' | 'platform'>,
  lowerQuery: string,
): boolean {
  return (
    entry.title.toLowerCase().includes(lowerQuery) ||
    entry.url.toLowerCase().includes(lowerQuery) ||
    entry.platform.toLowerCase().includes(lowerQuery)
  );
}
