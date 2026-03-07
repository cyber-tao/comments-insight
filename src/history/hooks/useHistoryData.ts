import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PAGINATION } from '@/config/constants';
import { HistoryItem } from '@/types';
import { ExtensionAPI } from '@/utils/extension-api';
import { Logger } from '@/utils/logger';

export interface HistoryListEntry {
  id: string;
  extractedAt: number;
  url: string;
  title: string;
  platform: string;
}

interface HistoryMetadataPageResponse {
  entries: HistoryListEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface UseHistoryDataOptions {
  listContainerRef: React.RefObject<HTMLDivElement | null>;
  onResetListScroll: () => void;
  onSelectViewMode: (mode: 'analysis' | 'comments') => void;
}

export function useHistoryData({
  listContainerRef,
  onResetListScroll,
  onSelectViewMode,
}: UseHistoryDataOptions) {
  const [history, setHistory] = useState<HistoryListEntry[]>([]);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [selectedItemLoading, setSelectedItemLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize] = useState(PAGINATION.DEFAULT_PER_PAGE);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(0);

  const historyItemCacheRef = useRef<Map<string, HistoryItem>>(new Map());
  const listRequestSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);

  const clearSelectedHistoryItem = useCallback(() => {
    detailRequestSeqRef.current += 1;
    setSelectedItemLoading(false);
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
      setSelectedItemLoading(true);
      try {
        const item = await fetchHistoryItemById(id);
        if (detailRequestSeq !== detailRequestSeqRef.current) {
          return;
        }
        setSelectedItem(item);
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

  const loadHistory = useCallback(
    async (page: number = 1, query: string = '') => {
      const listRequestSeq = ++listRequestSeqRef.current;
      setLoading(true);
      try {
        const response = (await ExtensionAPI.getHistoryMetadataPage(
          Math.max(0, page - 1),
          historyPageSize,
          query,
        )) as Partial<HistoryMetadataPageResponse>;

        if (listRequestSeq !== listRequestSeqRef.current) {
          return;
        }

        const entries = Array.isArray(response?.entries) ? response.entries : [];
        setHistory(entries);
        setHistoryTotal(typeof response?.total === 'number' ? response.total : entries.length);
        setHistoryTotalPages(typeof response?.totalPages === 'number' ? response.totalPages : 0);
        setHistoryPage(page);
        onResetListScroll();
        if (listContainerRef.current) {
          listContainerRef.current.scrollTop = 0;
        }

        setSelectedHistoryId((previousId) => {
          if (previousId && !entries.some((entry) => entry.id === previousId)) {
            const urlSelectedId = new URLSearchParams(window.location.search).get('id');
            if (urlSelectedId === previousId) {
              return previousId;
            }
            clearSelectedHistoryItem();
            return null;
          }
          return previousId;
        });
      } catch (error) {
        Logger.error('[History] Failed to load history', { error });
      } finally {
        if (listRequestSeq === listRequestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [clearSelectedHistoryItem, historyPageSize, listContainerRef, onResetListScroll],
  );

  useEffect(() => {
    void loadHistory(historyPage, activeSearchQuery);
  }, [historyPage, activeSearchQuery, loadHistory]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const tab = params.get('tab');
    if (!id || selectedHistoryId === id) {
      return;
    }

    const target = history.find((entry) => entry.id === id);
    const preferredTab = tab === 'analysis' || tab === 'comments' ? tab : undefined;
    if (target) {
      void handleSelectHistoryItem(target, preferredTab);
      return;
    }
    void selectHistoryItemById(id, preferredTab);
  }, [history, selectedHistoryId, handleSelectHistoryItem, selectHistoryItemById]);

  const handleSearch = useCallback(() => {
    const query = searchQuery.trim();
    const queryChanged = query !== activeSearchQuery;

    if (queryChanged) {
      setActiveSearchQuery(query);
    }

    if (historyPage !== 1) {
      setHistoryPage(1);
      return;
    }

    if (!queryChanged) {
      void loadHistory(1, query);
    }
  }, [activeSearchQuery, historyPage, loadHistory, searchQuery]);

  const handleDelete = useCallback(
    async (id: string, shouldConfirm: boolean) => {
      if (!shouldConfirm) {
        return;
      }

      try {
        await ExtensionAPI.deleteHistory(id);

        historyItemCacheRef.current.delete(id);
        if (selectedHistoryId === id) {
          clearSelectedHistoryItem();
        }

        const isLastItemOnPage = history.length <= 1 && historyPage > 1;
        const targetPage = isLastItemOnPage ? historyPage - 1 : historyPage;
        await loadHistory(targetPage, activeSearchQuery);
      } catch (error) {
        Logger.error('[History] Failed to delete', { error });
      }
    },
    [
      activeSearchQuery,
      clearSelectedHistoryItem,
      history.length,
      historyPage,
      loadHistory,
      selectedHistoryId,
    ],
  );

  const handleClearAll = useCallback(
    async (shouldConfirm: boolean) => {
      if (!shouldConfirm) {
        return;
      }

      try {
        const response = await ExtensionAPI.clearAllHistory();

        if (response?.success) {
          listRequestSeqRef.current += 1;
          setHistory([]);
          clearSelectedHistoryItem();
          setHistoryTotal(0);
          setHistoryTotalPages(0);
          setHistoryPage(1);
          setSearchQuery('');
          setActiveSearchQuery('');
          historyItemCacheRef.current.clear();
          onResetListScroll();
        }
      } catch (error) {
        Logger.error('[History] Failed to clear all', { error });
      }
    },
    [clearSelectedHistoryItem, onResetListScroll],
  );

  return {
    activeSearchQuery,
    clearSelectedHistoryItem,
    fetchHistoryItemById,
    handleClearAll,
    handleDelete,
    handleSearch,
    handleSelectHistoryItem,
    history,
    historyPage,
    historyTotal,
    historyTotalPages,
    loading,
    searchQuery,
    selectedHistoryId,
    selectedItem,
    selectedItemLoading,
    setHistoryPage,
    setSearchQuery,
    setSelectedItem,
  };
}
