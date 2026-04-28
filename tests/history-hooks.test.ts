/**
 * @vitest-environment jsdom
 */

import * as React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AI, PAGINATION, TIMING } from '../src/config/constants';
import { useHistoryData } from '../src/history/hooks/useHistoryData';
import { useHistoryReanalyze } from '../src/history/hooks/useHistoryReanalyze';
import type { HistoryItem } from '../src/types';

const HISTORY_ID = 'history-1';
const SECOND_HISTORY_ID = 'history-2';
const TASK_ID = 'task-1';
const HISTORY_TITLE = 'History Title';
const HISTORY_PLATFORM = 'youtube';
const HISTORY_URL = 'https://example.com/watch?v=1';
const HISTORY_TITLE_UPDATED = 'History Title Updated';
const REANALYZE_FAILED = 'Reanalyze failed';

const extensionApiMock = vi.hoisted(() => ({
  clearAllHistory: vi.fn(),
  deleteHistory: vi.fn(),
  getHistoryItem: vi.fn(),
  getHistoryMetadataPage: vi.fn(),
  getTaskStatus: vi.fn(),
  startAnalysis: vi.fn(),
}));

vi.mock('../src/utils/extension-api', () => ({
  ExtensionAPI: extensionApiMock,
}));

vi.mock('../src/utils/logger', () => ({
  Logger: {
    error: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

function createHistoryListEntry(id: string) {
  return {
    id,
    extractedAt: 1700000000000,
    platform: HISTORY_PLATFORM,
    title: `${HISTORY_TITLE}-${id}`,
    url: `${HISTORY_URL}&entry=${id}`,
  };
}

function createHistoryItem(id: string, title: string = HISTORY_TITLE): HistoryItem {
  return {
    id,
    url: HISTORY_URL,
    title,
    platform: HISTORY_PLATFORM,
    extractedAt: 1700000000000,
    commentsCount: 1,
    comments: [
      {
        id: `comment-${id}`,
        username: 'user',
        content: 'content',
        timestamp: '2025-01-01 12:00',
        likes: 1,
        replies: [],
      },
    ],
    analysis: {
      markdown: '# Analysis',
      summary: 'summary',
      sentiment: 'positive',
      keywords: ['keyword'],
    },
  };
}

describe('history hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/history');

    extensionApiMock.getHistoryMetadataPage.mockResolvedValue({
      entries: [createHistoryListEntry(HISTORY_ID), createHistoryListEntry(SECOND_HISTORY_ID)],
      total: 2,
      page: 0,
      pageSize: PAGINATION.DEFAULT_PER_PAGE,
      totalPages: 1,
    });
    extensionApiMock.getHistoryItem.mockImplementation(async (id: string) => createHistoryItem(id));
    extensionApiMock.deleteHistory.mockResolvedValue(undefined);
    extensionApiMock.clearAllHistory.mockResolvedValue({ success: true });
    extensionApiMock.startAnalysis.mockResolvedValue({ taskId: TASK_ID });
    extensionApiMock.getTaskStatus.mockResolvedValue({ status: 'completed', progress: 100 });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, '', '/history');
  });

  it('loads metadata and auto-selects the item from url params', async () => {
    window.history.replaceState({}, '', `/history?id=${HISTORY_ID}&tab=comments`);

    const listElement = document.createElement('div');
    listElement.scrollTop = 99;
    const listContainerRef = { current: listElement };
    const onResetListScroll = vi.fn();
    const onSelectViewMode = vi.fn();

    const { result } = renderHook(() =>
      useHistoryData({
        listContainerRef,
        onResetListScroll,
        onSelectViewMode,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.history).toHaveLength(2);
      expect(result.current.selectedHistoryId).toBe(HISTORY_ID);
      expect(result.current.selectedItem?.id).toBe(HISTORY_ID);
    });

    expect(extensionApiMock.getHistoryMetadataPage).toHaveBeenCalledWith(
      0,
      PAGINATION.DEFAULT_PER_PAGE,
      '',
    );
    expect(extensionApiMock.getHistoryItem).toHaveBeenCalledWith(HISTORY_ID);
    expect(onSelectViewMode).toHaveBeenCalledWith('comments');
    expect(onResetListScroll).toHaveBeenCalled();
    expect(listElement.scrollTop).toBe(0);
  });

  it('resets local state after clearing all history', async () => {
    const listContainerRef = { current: document.createElement('div') };
    const onResetListScroll = vi.fn();

    const { result } = renderHook(() =>
      useHistoryData({
        listContainerRef,
        onResetListScroll,
        onSelectViewMode: vi.fn(),
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleSelectHistoryItem(createHistoryListEntry(HISTORY_ID));
    });

    await act(async () => {
      await result.current.handleClearAll(true);
    });

    expect(extensionApiMock.clearAllHistory).toHaveBeenCalledOnce();
    expect(result.current.history).toEqual([]);
    expect(result.current.historyPage).toBe(1);
    expect(result.current.historyTotal).toBe(0);
    expect(result.current.historyTotalPages).toBe(0);
    expect(result.current.searchQuery).toBe('');
    expect(result.current.selectedHistoryId).toBeNull();
    expect(result.current.selectedItem).toBeNull();
    expect(result.current.selectedItemError).toBeNull();
    expect(onResetListScroll).toHaveBeenCalledTimes(2);
  });

  it('surfaces selected item load failures', async () => {
    extensionApiMock.getHistoryItem.mockResolvedValueOnce(null);

    const listContainerRef = { current: document.createElement('div') };
    const onResetListScroll = vi.fn();
    const onSelectViewMode = vi.fn();

    const { result } = renderHook(() =>
      useHistoryData({
        listContainerRef,
        onResetListScroll,
        onSelectViewMode,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.handleSelectHistoryItem(createHistoryListEntry(HISTORY_ID));
    });

    expect(result.current.selectedHistoryId).toBe(HISTORY_ID);
    expect(result.current.selectedItem).toBeNull();
    expect(result.current.selectedItemLoading).toBe(false);
    expect(result.current.selectedItemError).toBe('Failed to load history item');
  });

  it('polls reanalyze task until completion and refreshes selected item', async () => {
    vi.useFakeTimers();
    const detailedProgress = {
      stage: 'analyzing' as const,
      current: 45,
      total: 100,
      estimatedTimeRemaining: -1,
      stageMessageKey: AI.ANALYSIS_PROGRESS_MESSAGE_KEYS.RECEIVING,
      stageMessageParams: {
        [AI.ANALYSIS_PROGRESS_PARAM_KEYS.CHARACTERS]: 1024,
      },
    };
    extensionApiMock.getTaskStatus
      .mockResolvedValueOnce({ status: 'running', progress: 45, detailedProgress })
      .mockResolvedValueOnce({ status: 'completed', progress: 100 });

    const initialItem = createHistoryItem(HISTORY_ID);
    const refreshedItem = createHistoryItem(HISTORY_ID, HISTORY_TITLE_UPDATED);
    const fetchHistoryItemById = vi.fn().mockResolvedValue(refreshedItem);

    const { result } = renderHook(() => {
      const [selectedItem, setSelectedItem] = React.useState<HistoryItem | null>(initialItem);
      return {
        selectedItem,
        ...useHistoryReanalyze({
          selectedItem,
          fetchHistoryItemById,
          setSelectedItem,
        }),
      };
    });

    await act(async () => {
      await result.current.handleReanalyze();
      await Promise.resolve();
    });

    expect(extensionApiMock.startAnalysis).toHaveBeenCalledWith({
      comments: initialItem.comments,
      historyId: HISTORY_ID,
      metadata: {
        platform: initialItem.platform,
        url: initialItem.url,
        title: initialItem.title,
        videoTime: initialItem.videoTime,
        postContent: initialItem.postContent,
      },
    });
    expect(result.current.isReanalyzing).toBe(true);
    expect(result.current.reanalyzeProgress).toBe(45);
    expect(result.current.reanalyzeDetailedProgress).toEqual(detailedProgress);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.POLL_TASK_RUNNING_MS);
    });

    expect(fetchHistoryItemById).toHaveBeenCalledWith(HISTORY_ID, { force: true });
    expect(result.current.selectedItem?.title).toBe(HISTORY_TITLE_UPDATED);
    expect(result.current.isReanalyzing).toBe(false);
    expect(result.current.reanalyzeTaskId).toBeNull();
    expect(result.current.reanalyzeProgress).toBeNull();
    expect(result.current.reanalyzeDetailedProgress).toBeNull();
  });

  it('surfaces task failure during reanalyze polling', async () => {
    extensionApiMock.getTaskStatus.mockResolvedValue({
      status: 'failed',
      error: REANALYZE_FAILED,
    });

    const initialItem = createHistoryItem(HISTORY_ID);
    const fetchHistoryItemById = vi.fn().mockResolvedValue(initialItem);

    const { result } = renderHook(() => {
      const [selectedItem, setSelectedItem] = React.useState<HistoryItem | null>(initialItem);
      return useHistoryReanalyze({
        selectedItem,
        fetchHistoryItemById,
        setSelectedItem,
      });
    });

    await act(async () => {
      await result.current.handleReanalyze();
    });

    await waitFor(() => {
      expect(result.current.reanalyzeError).toBe(REANALYZE_FAILED);
      expect(result.current.isReanalyzing).toBe(false);
      expect(result.current.reanalyzeTaskId).toBeNull();
    });
    expect(fetchHistoryItemById).not.toHaveBeenCalled();
  });
});
