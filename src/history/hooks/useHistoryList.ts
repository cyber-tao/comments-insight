import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PAGINATION } from '@/config/constants';
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

interface UseHistoryListOptions {
  listContainerRef: React.RefObject<HTMLDivElement | null>;
  onResetListScroll: () => void;
  selectedHistoryId: string | null;
  onClearSelectedItem: () => void;
}

export function useHistoryList({
  listContainerRef,
  onResetListScroll,
  selectedHistoryId,
  onClearSelectedItem,
}: UseHistoryListOptions) {
  const [history, setHistory] = useState<HistoryListEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize] = useState(PAGINATION.DEFAULT_PER_PAGE);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(0);

  const listRequestSeqRef = useRef(0);
  const historyItemCacheRef = useRef<Map<string, unknown>>(new Map());
  const selectedHistoryIdRef = useRef(selectedHistoryId);
  const onClearSelectedItemRef = useRef(onClearSelectedItem);

  React.useEffect(() => {
    selectedHistoryIdRef.current = selectedHistoryId;
  }, [selectedHistoryId]);

  React.useEffect(() => {
    onClearSelectedItemRef.current = onClearSelectedItem;
  }, [onClearSelectedItem]);

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

        const currentSelectedId = selectedHistoryIdRef.current;
        if (currentSelectedId && !entries.some((entry) => entry.id === currentSelectedId)) {
          const urlSelectedId = new URLSearchParams(window.location.search).get('id');
          if (urlSelectedId !== currentSelectedId) {
            onClearSelectedItemRef.current();
          }
        }
      } catch (error) {
        Logger.error('[History] Failed to load history', { error });
      } finally {
        if (listRequestSeq === listRequestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [historyPageSize, listContainerRef, onResetListScroll],
  );

  useEffect(() => {
    void loadHistory(historyPage, activeSearchQuery);
  }, [historyPage, activeSearchQuery, loadHistory]);

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
        if (selectedHistoryIdRef.current === id) {
          onClearSelectedItemRef.current();
        }

        const isLastItemOnPage = history.length <= 1 && historyPage > 1;
        const targetPage = isLastItemOnPage ? historyPage - 1 : historyPage;
        await loadHistory(targetPage, activeSearchQuery);
      } catch (error) {
        Logger.error('[History] Failed to delete', { error });
      }
    },
    [activeSearchQuery, history.length, historyPage, loadHistory],
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
          onClearSelectedItemRef.current();
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
    [onResetListScroll],
  );

  return {
    history,
    searchQuery,
    setSearchQuery,
    activeSearchQuery,
    loading,
    historyPage,
    setHistoryPage,
    historyTotal,
    historyTotalPages,
    listRequestSeqRef,
    historyItemCacheRef,
    loadHistory,
    handleSearch,
    handleDelete,
    handleClearAll,
  };
}
