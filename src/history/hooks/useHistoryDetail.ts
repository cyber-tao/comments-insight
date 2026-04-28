import { useCallback, useRef, useState } from 'react';
import { HistoryItem } from '@/types';
import { ExtensionAPI } from '@/utils/extension-api';
import { Logger } from '@/utils/logger';
import type { HistoryListEntry } from './useHistoryList';

interface UseHistoryDetailOptions {
  onSelectViewMode: (mode: 'analysis' | 'comments') => void;
}

export function useHistoryDetail({ onSelectViewMode }: UseHistoryDetailOptions) {
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [selectedItemLoading, setSelectedItemLoading] = useState(false);
  const [selectedItemError, setSelectedItemError] = useState<string | null>(null);

  const historyItemCacheRef = useRef<Map<string, HistoryItem>>(new Map());
  const detailRequestSeqRef = useRef(0);

  const clearSelectedHistoryItem = useCallback(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('id')) {
      url.searchParams.delete('id');
      url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.toString());
    }

    detailRequestSeqRef.current += 1;
    setSelectedItemLoading(false);
    setSelectedItemError(null);
    setSelectedHistoryId(null);
    setSelectedItem(null);
  }, []);

  const fetchHistoryItemById = useCallback(
    async (id: string, options?: { force?: boolean }): Promise<HistoryItem | null> => {
      const force = options?.force === true;
      const cached = historyItemCacheRef.current.get(id);
      if (cached && !force) {
        return cached;
      }

      try {
        const item = await ExtensionAPI.getHistoryItem(id);

        if (item) {
          historyItemCacheRef.current.set(id, item);
          return item;
        }
      } catch (error) {
        Logger.error('[History] Failed to load history item', { id, error });
      }

      return null;
    },
    [],
  );

  const selectHistoryItemById = useCallback(
    async (id: string, preferredTab?: 'analysis' | 'comments') => {
      const url = new URL(window.location.href);
      let urlChanged = false;
      if (url.searchParams.get('id') !== id) {
        url.searchParams.set('id', id);
        urlChanged = true;
      }
      if (preferredTab && url.searchParams.get('tab') !== preferredTab) {
        url.searchParams.set('tab', preferredTab);
        urlChanged = true;
      }
      if (urlChanged) {
        window.history.replaceState({}, '', url.toString());
      }

      const detailRequestSeq = ++detailRequestSeqRef.current;
      setSelectedHistoryId(id);
      setSelectedItem((current) => (current?.id === id ? current : null));
      setSelectedItemError(null);
      setSelectedItemLoading(true);
      try {
        const item = await fetchHistoryItemById(id);
        if (detailRequestSeq !== detailRequestSeqRef.current) {
          return;
        }
        setSelectedItem(item);
        if (!item) {
          setSelectedItemError('Failed to load history item');
          return;
        }
        if (preferredTab) {
          onSelectViewMode(preferredTab);
        }
      } finally {
        if (detailRequestSeq === detailRequestSeqRef.current) {
          setSelectedItemLoading(false);
        }
      }
    },
    [fetchHistoryItemById, onSelectViewMode],
  );

  const handleSelectHistoryItem = useCallback(
    async (entry: HistoryListEntry, preferredTab?: 'analysis' | 'comments') => {
      await selectHistoryItemById(entry.id, preferredTab);
    },
    [selectHistoryItemById],
  );

  const invalidateCache = useCallback((id: string) => {
    historyItemCacheRef.current.delete(id);
  }, []);

  const clearCache = useCallback(() => {
    historyItemCacheRef.current.clear();
  }, []);

  return {
    selectedItem,
    setSelectedItem,
    selectedHistoryId,
    selectedItemLoading,
    selectedItemError,
    detailRequestSeqRef,
    historyItemCacheRef,
    clearSelectedHistoryItem,
    fetchHistoryItemById,
    selectHistoryItemById,
    handleSelectHistoryItem,
    invalidateCache,
    clearCache,
  };
}
