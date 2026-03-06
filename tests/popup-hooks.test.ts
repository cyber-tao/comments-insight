/**
 * @vitest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../src/config/constants';
import { useTask } from '../src/popup/hooks/useTask';
import { usePageInfo } from '../src/popup/hooks/usePageInfo';
import type { Comment, HistoryItem, Task } from '../src/types';

const TAB_ID = 7;
const PAGE_URL = 'https://www.youtube.com/watch?v=abc123';
const PAGE_TITLE = 'Video Title';
const HISTORY_ID = 'history-1';
const TASK_ID = 'task-1';

const extensionApiMock = vi.hoisted(() => ({
  cancelTask: vi.fn(),
  ensureContentScript: vi.fn(),
  getCrawlingConfig: vi.fn(),
  getHistoryByUrl: vi.fn(),
  getTaskStatus: vi.fn(),
  getTasks: vi.fn(),
  startAnalysis: vi.fn(),
  startConfigGeneration: vi.fn(),
  startExtraction: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../src/utils/extension-api', () => ({
  ExtensionAPI: extensionApiMock,
}));

vi.mock('../src/utils/logger', () => ({
  Logger: loggerMock,
}));

vi.stubGlobal('chrome', {
  tabs: {
    query: vi.fn(),
  },
});

function createComments(): Comment[] {
  return [
    {
      id: 'comment-1',
      username: 'user',
      content: 'content',
      timestamp: '2025-01-01 12:00',
      likes: 1,
      replies: [],
    },
  ];
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    type: 'extract',
    status: 'pending',
    progress: 0,
    url: PAGE_URL,
    startTime: Date.now(),
    tokensUsed: 0,
    ...overrides,
  } as Task;
}

function createHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: HISTORY_ID,
    url: PAGE_URL,
    title: PAGE_TITLE,
    platform: 'youtube',
    extractedAt: 1700000000000,
    analyzedAt: 1700000001000,
    commentsCount: 12,
    comments: createComments(),
    analysis: {
      markdown: '# Analysis',
      summary: 'summary',
      sentiment: 'positive',
      keywords: ['alpha'],
    },
    ...overrides,
  };
}

describe('popup hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: TAB_ID, url: PAGE_URL, title: PAGE_TITLE } as chrome.tabs.Tab,
    ]);
    extensionApiMock.cancelTask.mockResolvedValue(undefined);
    extensionApiMock.ensureContentScript.mockResolvedValue(undefined);
    extensionApiMock.getCrawlingConfig.mockResolvedValue({ selectors: {} });
    extensionApiMock.getHistoryByUrl.mockResolvedValue(createHistoryItem());
    extensionApiMock.getTaskStatus.mockResolvedValue(null);
    extensionApiMock.getTasks.mockResolvedValue([]);
    extensionApiMock.startAnalysis.mockResolvedValue({ taskId: TASK_ID });
    extensionApiMock.startConfigGeneration.mockResolvedValue({ taskId: TASK_ID });
    extensionApiMock.startExtraction.mockResolvedValue({ taskId: TASK_ID });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('useTask loads current url task and clears it after completion', async () => {
    vi.useFakeTimers();
    const onStatusRefresh = vi.fn().mockResolvedValue(undefined);
    const onTaskComplete = vi.fn();

    extensionApiMock.getTasks.mockResolvedValue([
      createTask({
        id: TASK_ID,
        type: 'config',
        status: 'pending',
        message: 'queued',
      }),
    ]);
    extensionApiMock.getTaskStatus
      .mockResolvedValueOnce(
        createTask({ id: TASK_ID, type: 'config', status: 'running', progress: 45 }),
      )
      .mockResolvedValueOnce(
        createTask({ id: TASK_ID, type: 'config', status: 'completed', progress: 100 }),
      );

    const { result } = renderHook(() => useTask({ onStatusRefresh, onTaskComplete }));

    await act(async () => {
      await result.current.loadCurrentTask(PAGE_URL);
      await Promise.resolve();
    });

    expect(result.current.currentTask).toMatchObject({
      id: TASK_ID,
      type: 'config',
      status: 'running',
      progress: 45,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.POLL_TASK_RUNNING_MS);
    });

    expect(onStatusRefresh).toHaveBeenCalledOnce();
    expect(onTaskComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: TASK_ID, status: 'completed', type: 'config' }),
    );
    expect(result.current.currentTask).toMatchObject({ status: 'completed', progress: 100 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMING.CLEAR_TASK_DELAY_MS);
    });

    expect(result.current.currentTask).toBeNull();
  });

  it('useTask starts extraction once and blocks duplicate starts while pending', async () => {
    vi.useFakeTimers();
    extensionApiMock.getTaskStatus.mockResolvedValue(createTask({ status: 'pending', progress: 0 }));

    const { result } = renderHook(() => useTask());

    let taskId: string | null = null;
    await act(async () => {
      taskId = await result.current.startExtraction(PAGE_URL);
      await Promise.resolve();
    });

    expect(taskId).toBe(TASK_ID);
    expect(vi.mocked(chrome.tabs.query)).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(extensionApiMock.ensureContentScript).toHaveBeenCalledWith(TAB_ID);
    expect(extensionApiMock.startExtraction).toHaveBeenCalledWith(PAGE_URL);
    expect(result.current.currentTask).toMatchObject({
      id: TASK_ID,
      type: 'extract',
      status: 'pending',
    });

    await act(async () => {
      const duplicate = await result.current.startExtraction(PAGE_URL);
      expect(duplicate).toBeNull();
    });

    expect(extensionApiMock.startExtraction).toHaveBeenCalledTimes(1);
  });

  it('useTask starts analysis and delegates cancellation', async () => {
    const comments = createComments();
    const metadata = { url: PAGE_URL, platform: 'youtube', title: PAGE_TITLE };
    const { result } = renderHook(() => useTask());

    await act(async () => {
      const taskId = await result.current.startAnalysis(HISTORY_ID, comments, metadata);
      expect(taskId).toBe(TASK_ID);
    });

    expect(extensionApiMock.startAnalysis).toHaveBeenCalledWith({
      comments,
      historyId: HISTORY_ID,
      metadata,
    });
    expect(result.current.currentTask).toMatchObject({ type: 'analyze', status: 'pending' });

    await act(async () => {
      await result.current.cancelTask(TASK_ID);
    });

    expect(extensionApiMock.cancelTask).toHaveBeenCalledWith(TASK_ID);
  });

  it('usePageInfo loads page info and preserves config status in page state', async () => {
    const { result } = renderHook(() => usePageInfo());

    let info = null;
    await act(async () => {
      info = await result.current.loadPageInfo();
    });

    expect(info).toEqual({
      url: PAGE_URL,
      title: PAGE_TITLE,
      domain: 'youtube.com',
    });
    expect(extensionApiMock.getCrawlingConfig).toHaveBeenCalledWith('www.youtube.com');
    expect(extensionApiMock.getHistoryByUrl).toHaveBeenCalledWith(PAGE_URL);
    expect(result.current.loading).toBe(false);
    expect(result.current.pageInfo).toEqual(info);
    expect(result.current.pageStatus).toMatchObject({
      extracted: true,
      analyzed: true,
      commentsCount: 12,
      historyId: HISTORY_ID,
      hasConfig: true,
    });
  });

  it('usePageInfo refreshes status and clears hasConfig when config lookup fails', async () => {
    extensionApiMock.getCrawlingConfig
      .mockResolvedValueOnce({ selectors: {} })
      .mockRejectedValueOnce(new Error('config missing'));
    extensionApiMock.getHistoryByUrl
      .mockResolvedValueOnce(createHistoryItem())
      .mockResolvedValueOnce(null);

    const { result } = renderHook(() => usePageInfo());

    await act(async () => {
      await result.current.loadPageInfo();
    });

    await act(async () => {
      await result.current.refreshPageStatus();
    });

    expect(result.current.pageStatus).toMatchObject({
      extracted: false,
      analyzed: false,
      hasConfig: false,
    });
    expect(loggerMock.warn).toHaveBeenCalledWith('[usePageInfo] Failed to check config status', {
      error: expect.any(Error),
    });
  });
});