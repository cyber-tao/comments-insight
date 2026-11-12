import * as React from 'react';
import { useEffect } from 'react';
import { useHistoryList, HistoryListEntry } from './useHistoryList';
import { useHistoryDetail } from './useHistoryDetail';

export type { HistoryListEntry };

interface UseHistoryDataOptions {
  listContainerRef: React.RefObject<HTMLDivElement | null>;
  onResetListScroll: () => void;
  onSelectViewMode: (mode: 'analysis' | 'dynamic' | 'comments') => void;
}

export function useHistoryData({
  listContainerRef,
  onResetListScroll,
  onSelectViewMode,
}: UseHistoryDataOptions) {
  const detail = useHistoryDetail({ onSelectViewMode });
  const {
    selectedHistoryId,
    handleSelectHistoryItem,
    selectHistoryItemById,
    clearSelectedHistoryItem,
  } = detail;

  const list = useHistoryList({
    listContainerRef,
    onResetListScroll,
    selectedHistoryId,
    onClearSelectedItem: clearSelectedHistoryItem,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const tab = params.get('tab');
    if (!id || selectedHistoryId === id) {
      return;
    }

    const target = list.history.find((entry) => entry.id === id);
    const preferredTab =
      tab === 'analysis' || tab === 'dynamic' || tab === 'comments' ? tab : undefined;
    if (target) {
      void handleSelectHistoryItem(target, preferredTab);
      return;
    }
    void selectHistoryItemById(id, preferredTab);
  }, [list.history, selectedHistoryId, handleSelectHistoryItem, selectHistoryItemById]);

  const handleDelete = async (id: string, shouldConfirm: boolean) => {
    if (await list.handleDelete(id, shouldConfirm)) detail.invalidateCache(id);
  };

  const handleClearAll = async (shouldConfirm: boolean) => {
    if (await list.handleClearAll(shouldConfirm)) detail.clearCache();
  };

  const retryHistoryOperation = async () => {
    if (list.failedOperation?.kind === 'delete') {
      await handleDelete(list.failedOperation.id, true);
    } else if (list.failedOperation?.kind === 'clear') {
      await handleClearAll(true);
    }
  };

  return {
    activeSearchQuery: list.activeSearchQuery,
    clearSelectedHistoryItem: detail.clearSelectedHistoryItem,
    fetchHistoryItemById: detail.fetchHistoryItemById,
    handleClearAll,
    handleDelete,
    handleSearch: list.handleSearch,
    handleSelectHistoryItem: detail.handleSelectHistoryItem,
    history: list.history,
    historyPage: list.historyPage,
    historyTotal: list.historyTotal,
    historyTotalPages: list.historyTotalPages,
    loading: list.loading,
    loadError: list.loadError,
    failedOperation: list.failedOperation,
    operationPending: list.operationPending,
    retryLoadHistory: list.retryLoadHistory,
    retryHistoryOperation,
    searchQuery: list.searchQuery,
    selectedHistoryId: detail.selectedHistoryId,
    selectedItem: detail.selectedItem,
    selectedItemError: detail.selectedItemError,
    selectedItemLoading: detail.selectedItemLoading,
    setHistoryPage: list.setHistoryPage,
    setSearchQuery: list.setSearchQuery,
    setSelectedItem: detail.setSelectedItem,
  };
}
