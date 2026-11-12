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

export type FailedHistoryOperation = { kind: 'delete'; id: string } | { kind: 'clear' };

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
  const [loadError, setLoadError] = useState(false);
  const [failedOperation, setFailedOperation] = useState<FailedHistoryOperation | null>(null);
  const [operationPending, setOperationPending] = useState(false);

  const listRequestSeqRef = useRef(0);
  const listLoadingRef = useRef(false);
  const operationInFlightRef = useRef(false);
  const lastRequestRef = useRef({ page: 1, query: '' });
  const mountedRef = useRef(true);
  const selectedHistoryIdRef = useRef(selectedHistoryId);
  const onClearSelectedItemRef = useRef(onClearSelectedItem);

  React.useEffect(() => {
    selectedHistoryIdRef.current = selectedHistoryId;
  }, [selectedHistoryId]);

  React.useEffect(() => {
    onClearSelectedItemRef.current = onClearSelectedItem;
  }, [onClearSelectedItem]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listRequestSeqRef.current += 1;
    };
  }, []);

  const loadHistory = useCallback(
    async (page: number = 1, query: string = '', afterMutation = false) => {
      if (operationInFlightRef.current && !afterMutation) return;
      lastRequestRef.current = { page, query };
      const listRequestSeq = ++listRequestSeqRef.current;
      listLoadingRef.current = true;
      setLoading(true);
      setLoadError(false);
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
        if (listRequestSeq === listRequestSeqRef.current) setLoadError(true);
      } finally {
        if (listRequestSeq === listRequestSeqRef.current) {
          listLoadingRef.current = false;
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
    if (operationInFlightRef.current) return;
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
      if (!shouldConfirm || operationInFlightRef.current || listLoadingRef.current) {
        return false;
      }

      operationInFlightRef.current = true;
      listRequestSeqRef.current += 1;
      setLoading(false);
      setOperationPending(true);
      setFailedOperation(null);
      try {
        const response = await ExtensionAPI.deleteHistory(id);
        if (!response?.success) throw new Error('History deletion did not succeed');
        if (!mountedRef.current) return false;

        setHistory((current) => current.filter((entry) => entry.id !== id));
        setHistoryTotal((current) => Math.max(0, current - 1));
        if (selectedHistoryIdRef.current === id) {
          onClearSelectedItemRef.current();
        }

        const isLastItemOnPage = history.length <= 1 && historyPage > 1;
        const targetPage = isLastItemOnPage ? historyPage - 1 : historyPage;
        await loadHistory(targetPage, activeSearchQuery, true);
        return true;
      } catch (error) {
        Logger.error('[History] Failed to delete', { error });
        if (mountedRef.current) setFailedOperation({ kind: 'delete', id });
        return false;
      } finally {
        operationInFlightRef.current = false;
        if (mountedRef.current) setOperationPending(false);
      }
    },
    [activeSearchQuery, history.length, historyPage, loadHistory],
  );

  const handleClearAll = useCallback(
    async (shouldConfirm: boolean) => {
      if (!shouldConfirm || operationInFlightRef.current || listLoadingRef.current) {
        return false;
      }

      operationInFlightRef.current = true;
      listRequestSeqRef.current += 1;
      setLoading(false);
      setOperationPending(true);
      setFailedOperation(null);
      try {
        const response = await ExtensionAPI.clearAllHistory();
        if (!mountedRef.current) return false;

        if (response?.success) {
          listRequestSeqRef.current += 1;
          setHistory([]);
          onClearSelectedItemRef.current();
          setHistoryTotal(0);
          setHistoryTotalPages(0);
          setHistoryPage(1);
          setSearchQuery('');
          setActiveSearchQuery('');
          setLoadError(false);
          onResetListScroll();
          return true;
        }
        throw new Error('History clear did not succeed');
      } catch (error) {
        Logger.error('[History] Failed to clear all', { error });
        if (mountedRef.current) setFailedOperation({ kind: 'clear' });
        return false;
      } finally {
        operationInFlightRef.current = false;
        if (mountedRef.current) setOperationPending(false);
      }
    },
    [onResetListScroll],
  );

  const retryLoadHistory = useCallback(() => {
    const { page, query } = lastRequestRef.current;
    return loadHistory(page, query);
  }, [loadHistory]);

  return {
    history,
    searchQuery,
    setSearchQuery,
    activeSearchQuery,
    loading,
    loadError,
    failedOperation,
    operationPending,
    retryLoadHistory,
    historyPage,
    setHistoryPage,
    historyTotal,
    historyTotalPages,
    listRequestSeqRef,
    loadHistory,
    handleSearch,
    handleDelete,
    handleClearAll,
  };
}
