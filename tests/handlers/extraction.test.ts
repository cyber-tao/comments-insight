import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleStartExtraction,
  handleExtractionProgress,
  handleExtractionCompleted,
} from '../../src/background/handlers/extraction';
import {
  handleStartConfigGeneration,
  handleConfigGenerationCompleted,
} from '../../src/background/handlers/config-generation';
import { HandlerContext } from '../../src/background/handlers/types';
import { ExtensionError, ErrorCode } from '../../src/utils/errors';
import { STORAGE, TIMEOUT, TEXT } from '../../src/config/constants';
import { TaskManager } from '../../src/background/TaskManager';
import type { NotificationService } from '../../src/background/NotificationService';
import type { Comment, Task } from '../../src/types';

type TabRemoveInfo = { windowId: number; isWindowClosing: boolean };

const tabRemovedListeners = new Set<(tabId: number, removeInfo: TabRemoveInfo) => void>();
const tabUpdatedListeners = new Set<(tabId: number, change: chrome.tabs.OnUpdatedInfo) => void>();
const sourceUrl = 'https://example.com/';
const sourceDocumentId = 'source-document';
const mockGetTab = vi.fn();
const mockExecuteScript = vi.fn();
const mockStorageGet = vi.fn().mockResolvedValue({});
const mockStorageSet = vi.fn().mockResolvedValue(undefined);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

async function flushMicrotasks(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

vi.mock('../../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.stubGlobal('chrome', {
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 1 }]),
    get: mockGetTab,
    sendMessage: vi.fn().mockResolvedValue({ success: true, comments: [] }),
    onRemoved: {
      addListener: vi.fn((listener) => tabRemovedListeners.add(listener)),
      removeListener: vi.fn((listener) => tabRemovedListeners.delete(listener)),
    },
    onUpdated: {
      addListener: vi.fn((listener) => tabUpdatedListeners.add(listener)),
      removeListener: vi.fn((listener) => tabUpdatedListeners.delete(listener)),
    },
  },
  scripting: { executeScript: mockExecuteScript },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
    },
  },
});

function createMockContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    taskManager: {
      createTask: vi.fn().mockReturnValue('task_123'),
      setExecutor: vi.fn(),
      startTask: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn(),
      updateTaskProgress: vi.fn(),
      updateDetailedProgress: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      getTask: vi.fn().mockReturnValue({ type: 'extract', status: 'running', maxComments: 100 }),
      bindSourceDocument: vi.fn().mockResolvedValue(undefined),
      abortTask: vi.fn(),
      getAbortSignal: vi.fn().mockReturnValue(undefined),
      recoverInterruptedTask: vi.fn().mockReturnValue(undefined),
      getAllTasks: vi.fn().mockReturnValue([]),
      cancelTask: vi.fn(),
      incrementTokens: vi.fn(),
    },
    settingsStore: {
      getSettings: vi.fn().mockResolvedValue({
        maxComments: 100,
        normalizeTimestamps: false,
      }),
    },
    historyStore: {
      createHistory: vi.fn().mockResolvedValue(undefined),
      getHistoryItem: vi.fn().mockResolvedValue({ id: 'history-123' }),
    },
    aiService: {
      callAI: vi.fn(),
    },
    commentAnalyzer: {
      analyzeComments: vi.fn(),
    },
    timestampNormalizer: {
      normalizeCommentTimestamps: vi.fn(),
      normalizeSingleTimestamp: vi.fn(),
    },
    sender: {
      tab: { id: 1 },
    },
    ...overrides,
  } as unknown as HandlerContext;
}

async function createRestartedContext(documentId?: string): Promise<HandlerContext> {
  const now = Date.now();
  const persistedTask: Task = {
    id: 'task_restored',
    type: 'extract',
    status: 'running',
    url: 'https://example.com/restored',
    platform: 'example.com',
    tabId: 1,
    sourceDocumentId: documentId,
    progress: 80,
    startTime: now - 1000,
    tokensUsed: 0,
  };
  mockStorageGet.mockResolvedValueOnce({
    [STORAGE.TASK_STATE_KEY]: {
      tasks: [persistedTask],
      queue: [],
      currentTaskId: persistedTask.id,
      savedAt: now - 100,
    },
  });
  const notifications = {
    showTaskCompleted: vi.fn(),
    showTaskFailed: vi.fn(),
  } as unknown as NotificationService;
  const taskManager = new TaskManager(notifications, { enablePersistence: true });
  await taskManager.initialize();
  expect(taskManager.getTask(persistedTask.id)?.interruptedByRestart).toBe(true);
  return createMockContext({
    taskManager,
    sender: { tab: { id: 1 } as chrome.tabs.Tab, frameId: 0, url: persistedTask.url, documentId },
  });
}

const restoredComments: Comment[] = [
  {
    id: 'comment-restored',
    username: 'user',
    content: 'content',
    likes: 1,
    timestamp: '1 hour ago',
    replies: [],
  },
];
const restoredCompletion = {
  type: 'EXTRACTION_COMPLETED' as const,
  payload: {
    taskId: 'task_restored',
    success: true,
    comments: restoredComments,
    postInfo: { title: 'Restored extraction' },
  },
};

function gateNormalization(context: HandlerContext) {
  const entered = deferred<AbortSignal | undefined>();
  const gate = deferred<void>();
  vi.mocked(context.settingsStore.getSettings).mockResolvedValue({
    normalizeTimestamps: true,
    aiModel: {},
    aiTimeout: 1000,
  } as Awaited<ReturnType<HandlerContext['settingsStore']['getSettings']>>);
  vi.mocked(context.timestampNormalizer.normalizeCommentTimestamps).mockImplementation(
    async (_comments, _model, _referenceTime, _timeout, signal) => {
      entered.resolve(signal);
      await gate.promise;
      return restoredComments;
    },
  );
  return { entered: entered.promise, release: () => gate.resolve() };
}

function lastPersistedState() {
  const calls = mockStorageSet.mock.calls;
  return calls[calls.length - 1]?.[0]?.[STORAGE.TASK_STATE_KEY];
}

describe('extraction handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue({});
    mockStorageSet.mockResolvedValue(undefined);
    tabRemovedListeners.clear();
    tabUpdatedListeners.clear();
    mockGetTab.mockResolvedValue({ id: 1, url: sourceUrl });
    mockExecuteScript.mockResolvedValue([{ result: sourceUrl, documentId: sourceDocumentId }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('handleStartExtraction', () => {
    it('should create task with URL and maxComments from message', async () => {
      const context = createMockContext();
      const message = {
        type: 'START_EXTRACTION' as const,
        payload: { url: 'https://example.com', maxComments: 50 },
      };

      const result = await handleStartExtraction(message, context);

      expect(result.taskId).toBe('task_123');
      expect(context.taskManager.createTask).toHaveBeenCalledWith(
        'extract',
        'https://example.com',
        'example.com',
        50,
        1,
      );
    });

    it('should use settings maxComments when not provided', async () => {
      const context = createMockContext();
      const message = {
        type: 'START_EXTRACTION' as const,
        payload: { url: 'https://example.com' },
      };

      await handleStartExtraction(message, context);

      expect(context.settingsStore.getSettings).toHaveBeenCalled();
      expect(context.taskManager.createTask).toHaveBeenCalledWith(
        'extract',
        'https://example.com',
        'example.com',
        100,
        1,
      );
    });

    it('should throw error when URL is missing', async () => {
      const context = createMockContext();
      const message = {
        type: 'START_EXTRACTION' as const,
        payload: {},
      };

      await expect(
        handleStartExtraction(
          message as Extract<import('../../src/types').Message, { type: 'START_EXTRACTION' }>,
          context,
        ),
      ).rejects.toThrow();
    });

    it('should fail executor when extraction completion times out', async () => {
      vi.useFakeTimers();
      const context = createMockContext();
      const message = {
        type: 'START_EXTRACTION' as const,
        payload: { url: 'https://example.com', maxComments: 50 },
      };

      await handleStartExtraction(message, context);

      const setExecutorMock = context.taskManager.setExecutor as unknown as {
        mock: { calls: unknown[][] };
      };
      const executor = setExecutorMock.mock.calls[0][1] as (
        task: { id: string; tabId?: number; url: string },
        signal: AbortSignal,
      ) => Promise<unknown>;

      const controller = new AbortController();
      const running = executor({ id: 'task_123', tabId: 1, url: sourceUrl }, controller.signal);
      const rejection = expect(running).rejects.toMatchObject({
        code: ErrorCode.TIMEOUT_ERROR,
      });
      await flushMicrotasks(16);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        {
          type: 'RUN_EXTRACTION',
          payload: { taskId: 'task_123', maxComments: 50, expectedUrl: sourceUrl },
        },
        { documentId: sourceDocumentId },
      );

      await vi.advanceTimersByTimeAsync(TIMEOUT.EXTRACTION_TASK_COMPLETION_MS + 1);
      await rejection;
    });

    it('should fail executor when source tab closes before completion', async () => {
      const context = createMockContext();
      const message = {
        type: 'START_EXTRACTION' as const,
        payload: { url: 'https://example.com', maxComments: 50 },
      };

      await handleStartExtraction(message, context);

      const setExecutorMock = context.taskManager.setExecutor as unknown as {
        mock: { calls: unknown[][] };
      };
      const executor = setExecutorMock.mock.calls[0][1] as (
        task: { id: string; tabId?: number; url: string },
        signal: AbortSignal,
      ) => Promise<unknown>;

      const controller = new AbortController();
      const running = executor({ id: 'task_123', tabId: 1, url: sourceUrl }, controller.signal);
      await flushMicrotasks(16);
      expect(tabRemovedListeners.size).toBe(1);

      for (const listener of tabRemovedListeners) {
        listener(1, { isWindowClosing: false, windowId: 1 });
      }

      await expect(running).rejects.toMatchObject({
        code: ErrorCode.EXTRACTION_FAILED,
        message: TEXT.TASK_SOURCE_TAB_CLOSED,
      });
    });

    it.each(['extract', 'config'] as const)(
      'rejects a queued %s task if the source tab has navigated before dispatch',
      async (type) => {
        const context = createMockContext();
        const payload = { url: sourceUrl, tabId: 1 };
        if (type === 'extract') {
          await handleStartExtraction({ type: 'START_EXTRACTION', payload }, context);
        } else {
          await handleStartConfigGeneration({ type: 'START_CONFIG_GENERATION', payload }, context);
        }
        mockGetTab.mockResolvedValueOnce({ id: 1, url: `${sourceUrl}different-route` });
        const executor = vi.mocked(context.taskManager.setExecutor).mock.calls[0][1];
        const task = { id: 'task_123', tabId: 1, url: sourceUrl } as Task;

        await expect(executor(task, new AbortController().signal)).rejects.toMatchObject({
          details: { messageKey: 'errors.sourcePageChanged' },
        });
        expect(mockExecuteScript).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
      },
    );

    it.each([{ url: `${sourceUrl}#other` }, { status: 'loading' }] as chrome.tabs.OnUpdatedInfo[])(
      'fails the running source task when Chrome signals %j',
      async (change) => {
        const context = createMockContext();
        await handleStartExtraction(
          { type: 'START_EXTRACTION', payload: { url: sourceUrl } },
          context,
        );
        const executor = vi.mocked(context.taskManager.setExecutor).mock.calls[0][1];
        const task = { id: 'task_123', tabId: 1, url: sourceUrl } as Task;
        const running = executor(task, new AbortController().signal);
        const rejected = expect(running).rejects.toMatchObject({
          details: { messageKey: 'errors.sourcePageChanged' },
        });
        await flushMicrotasks(16);
        expect(tabUpdatedListeners.size).toBe(1);
        for (const listener of tabUpdatedListeners) listener(1, change);
        await rejected;
        expect(context.taskManager.abortTask).toHaveBeenCalledWith('task_123');
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
          1,
          { type: 'CANCEL_EXTRACTION', payload: { taskId: 'task_123' } },
          { documentId: sourceDocumentId },
        );
        expect(tabUpdatedListeners.size).toBe(0);
      },
    );
  });

  describe('handleStartConfigGeneration', () => {
    it('should fail executor when config generation completion times out', async () => {
      vi.useFakeTimers();
      const context = createMockContext();
      const message = {
        type: 'START_CONFIG_GENERATION' as const,
        payload: { url: 'https://example.com' },
      };

      await handleStartConfigGeneration(message, context);
      expect(context.taskManager.createTask).toHaveBeenCalledWith(
        'config',
        'https://example.com',
        'example.com',
        0,
        1,
      );

      const setExecutorMock = context.taskManager.setExecutor as unknown as {
        mock: { calls: unknown[][] };
      };
      const executor = setExecutorMock.mock.calls[0][1] as (
        task: { id: string; tabId?: number; url: string },
        signal: AbortSignal,
      ) => Promise<unknown>;

      const controller = new AbortController();
      const running = executor({ id: 'task_123', tabId: 1, url: sourceUrl }, controller.signal);
      const rejection = expect(running).rejects.toMatchObject({
        code: ErrorCode.TIMEOUT_ERROR,
      });
      await flushMicrotasks(16);
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        {
          type: 'RUN_CONFIG_GENERATION',
          payload: { taskId: 'task_123', expectedUrl: sourceUrl },
        },
        { documentId: sourceDocumentId },
      );

      await vi.advanceTimersByTimeAsync(TIMEOUT.CONFIG_TASK_COMPLETION_MS + 1);
      await rejection;
    });
  });

  describe('handleExtractionProgress', () => {
    it('should update task progress', async () => {
      const context = createMockContext();
      const message = {
        type: 'EXTRACTION_PROGRESS' as const,
        payload: { taskId: 'task_123', progress: 50, message: 'Extracting comments...' },
      };

      const result = await handleExtractionProgress(message, context);

      expect(result.success).toBe(true);
      expect(context.taskManager.updateTaskProgress).toHaveBeenCalledWith(
        'task_123',
        50,
        expect.stringContaining('Extracting comments'),
      );
    });

    it('should handle progress with data', async () => {
      const context = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
          getTask: vi.fn().mockReturnValue({ status: 'running', maxComments: 50 }),
          updateProgress: vi.fn(),
          updateTaskProgress: vi.fn(),
        },
      } as unknown as Partial<HandlerContext>);
      const message = {
        type: 'EXTRACTION_PROGRESS' as const,
        payload: {
          taskId: 'task_123',
          progress: 100,
          message: 'Completed',
          data: { commentCount: 50 },
        },
      };

      const result = await handleExtractionProgress(message, context);

      expect(result.success).toBe(true);
    });

    it('should reject progress updates without simple or detailed progress values', async () => {
      const context = createMockContext();
      const message = {
        type: 'EXTRACTION_PROGRESS' as const,
        payload: { taskId: 'task_123', message: 'missing progress' },
      } as unknown as Extract<import('../../src/types').Message, { type: 'EXTRACTION_PROGRESS' }>;

      const result = await handleExtractionProgress(message, context);

      expect(result.success).toBe(false);
      expect(context.taskManager.updateTaskProgress).not.toHaveBeenCalled();
      expect(context.taskManager.updateDetailedProgress).not.toHaveBeenCalled();
    });
  });

  describe('restored completion lifecycle', () => {
    it('aborts restored normalization and releases its slot before the normalizer settles', async () => {
      const context = await createRestartedContext();
      const normalization = gateNormalization(context);
      const completion = handleExtractionCompleted(restoredCompletion, context);
      try {
        const signal = await normalization.entered;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);

        context.taskManager.cancelTask('task_restored');
        expect(signal?.aborted).toBe(true);
        expect(context.taskManager.getTask('task_restored')?.status).toBe('failed');
        expect(context.taskManager.getAbortSignal('task_restored')).toBeUndefined();

        const nextId = context.taskManager.createTask(
          'analyze',
          'https://example.com/new',
          'Generic',
        );
        const nextExecutor = vi.fn().mockResolvedValue({ tokensUsed: 2 });
        context.taskManager.setExecutor(nextId, nextExecutor);
        // The restored completion has no executor-finally to wait for. The new
        // executor must finish while the cancelled normalizer is still gated.
        await vi.waitFor(() =>
          expect(context.taskManager.getTask(nextId)?.status).toBe('completed'),
        );
        expect(nextExecutor).toHaveBeenCalledOnce();

        normalization.release();
        await expect(completion).resolves.toEqual({ success: false });
        expect(context.historyStore.createHistory).not.toHaveBeenCalled();
        expect(context.timestampNormalizer.normalizeSingleTimestamp).not.toHaveBeenCalled();
        expect(context.taskManager.getTask(nextId)?.status).toBe('completed');
      } finally {
        normalization.release();
        await completion;
      }
    });

    it.each(['complete', 'cancel'] as const)(
      'does not steal or clear a newer executor slot when a restored completion will %s',
      async (ending) => {
        const context = await createRestartedContext();
        const activeGate = deferred<void>();
        const activeEntered = deferred<AbortSignal>();
        const activeId = context.taskManager.createTask(
          'analyze',
          'https://example.com/active',
          'Generic',
        );
        context.taskManager.setExecutor(activeId, async (_task, signal) => {
          activeEntered.resolve(signal);
          await activeGate.promise;
          return {};
        });
        const activeSignal = await activeEntered.promise;
        const normalization = gateNormalization(context);
        const completion = handleExtractionCompleted(restoredCompletion, context);
        try {
          const restoredSignal = await normalization.entered;
          expect(restoredSignal).toBeInstanceOf(AbortSignal);
          expect(restoredSignal).not.toBe(activeSignal);
          await vi.waitFor(() => expect(lastPersistedState()?.currentTaskId).toBe(activeId));

          const queuedId = context.taskManager.createTask(
            'analyze',
            'https://example.com/queued',
            'Generic',
          );
          const queuedExecutor = vi.fn().mockResolvedValue({});
          context.taskManager.setExecutor(queuedId, queuedExecutor);
          if (ending === 'cancel') {
            context.taskManager.cancelTask('task_restored');
            expect(restoredSignal?.aborted).toBe(true);
          }
          normalization.release();
          await expect(completion).resolves.toEqual({ success: ending === 'complete' });
          await vi.waitFor(() => {
            expect(lastPersistedState()?.currentTaskId).toBe(activeId);
            expect(
              lastPersistedState()?.tasks.find((task: Task) => task.id === 'task_restored')?.status,
            ).toBe(ending === 'complete' ? 'completed' : 'failed');
          });
          expect(activeSignal.aborted).toBe(false);
          expect(context.taskManager.getAbortSignal(activeId)).toBe(activeSignal);
          expect(context.taskManager.getTask(activeId)?.status).toBe('running');
          expect(queuedExecutor).not.toHaveBeenCalled();
          expect(context.taskManager.getTask(queuedId)?.status).toBe('pending');
          if (ending === 'complete') {
            expect(context.historyStore.createHistory).toHaveBeenCalledWith(
              expect.objectContaining({ comments: restoredComments }),
              restoredSignal,
            );
          } else {
            expect(context.historyStore.createHistory).not.toHaveBeenCalled();
          }

          activeGate.resolve();
          await vi.waitFor(() =>
            expect(context.taskManager.getTask(queuedId)?.status).toBe('completed'),
          );
          expect(context.taskManager.getTask(activeId)?.status).toBe('completed');
        } finally {
          normalization.release();
          activeGate.resolve();
          await completion;
        }
      },
    );
  });

  describe('completion payload validation', () => {
    it('uses the current tab URL for a bound document after same-document navigation', async () => {
      const context = await createRestartedContext(sourceDocumentId);
      const task = context.taskManager.getTask('task_restored')!;
      const sender = {
        ...context.sender,
        url: 'https://example.com/previous',
        tab: { id: task.tabId, url: task.url } as chrome.tabs.Tab,
      };
      const navigatedAway = {
        ...context,
        sender: { ...sender, tab: { ...sender.tab, url: sender.url }, url: task.url },
      };

      await expect(handleExtractionCompleted(restoredCompletion, navigatedAway)).resolves.toEqual({
        success: false,
      });
      expect(context.historyStore.createHistory).not.toHaveBeenCalled();
      await expect(
        handleExtractionCompleted(restoredCompletion, { ...context, sender }),
      ).resolves.toEqual({
        success: true,
      });
      expect(context.historyStore.createHistory).toHaveBeenCalledOnce();
    });

    it('rejects a stale document completion after restart and still accepts the source', async () => {
      const context = await createRestartedContext(sourceDocumentId);
      const wrongDocument = { ...context, sender: { ...context.sender, documentId: 'wrong' } };

      await expect(handleExtractionCompleted(restoredCompletion, wrongDocument)).resolves.toEqual({
        success: false,
      });
      expect(context.historyStore.createHistory).not.toHaveBeenCalled();
      await expect(handleExtractionCompleted(restoredCompletion, context)).resolves.toEqual({
        success: true,
      });
      expect(context.historyStore.createHistory).toHaveBeenCalledOnce();
    });

    it('should persist successful extraction even when no comments are found', async () => {
      const context = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
          getTask: vi.fn().mockReturnValue({
            id: 'task_123',
            type: 'extract',
            status: 'running',
            url: 'https://example.com',
            platform: 'example.com',
            progress: 80,
            startTime: Date.now(),
            tokensUsed: 0,
          }),
        },
      } as unknown as Partial<HandlerContext>);
      const message = {
        type: 'EXTRACTION_COMPLETED' as const,
        payload: {
          taskId: 'task_123',
          success: true,
          comments: [],
          postInfo: {
            url: 'https://example.com',
            title: 'No Comments',
          },
        },
      };

      const result = await handleExtractionCompleted(message, context);

      expect(result).toEqual({ success: true });
      expect(context.historyStore.createHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'No Comments',
          commentsCount: 0,
          comments: [],
        }),
        undefined,
      );
      expect(context.taskManager.completeTask).toHaveBeenCalledWith(
        'task_123',
        expect.objectContaining({
          commentsCount: 0,
          title: 'No Comments',
          historyId: expect.stringMatching(/^history_/),
          historyTab: 'comments',
        }),
      );
    });

    it('should stop normalization and skip persistence after cancellation', async () => {
      const controller = new AbortController();
      const task = {
        id: 'task_123',
        type: 'extract' as const,
        status: 'running' as const,
        url: 'https://example.com',
        platform: 'example.com',
        progress: 80,
        startTime: Date.now(),
        tokensUsed: 0,
      };
      const normalizeCommentTimestamps = vi.fn().mockImplementation(async () => {
        controller.abort();
        throw new Error('cancelled');
      });
      const context = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
          getTask: vi.fn().mockReturnValue(task),
          getAbortSignal: vi.fn().mockReturnValue(controller.signal),
        },
        settingsStore: {
          getSettings: vi.fn().mockResolvedValue({
            normalizeTimestamps: true,
            aiModel: {},
            aiTimeout: 1000,
          }),
        },
        timestampNormalizer: {
          normalizeCommentTimestamps,
          normalizeSingleTimestamp: vi.fn(),
        },
      } as unknown as Partial<HandlerContext>);
      const message = {
        type: 'EXTRACTION_COMPLETED' as const,
        payload: {
          taskId: task.id,
          success: true,
          comments: [
            {
              id: 'comment-1',
              username: 'user',
              content: 'content',
              likes: 1,
              timestamp: '1 hour ago',
              replies: [],
            },
          ],
        },
      };

      const result = await handleExtractionCompleted(message, context);

      expect(result).toEqual({ success: false });
      expect(normalizeCommentTimestamps).toHaveBeenCalledWith(
        message.payload.comments,
        expect.anything(),
        expect.any(String),
        1000,
        controller.signal,
      );
      expect(context.historyStore.createHistory).not.toHaveBeenCalled();
      expect(context.taskManager.completeTask).not.toHaveBeenCalled();
    });

    it('preserves cancellation when createHistory aborts before its transaction commits', async () => {
      const controller = new AbortController();
      const task: Task = {
        id: 'task_123',
        type: 'extract',
        status: 'running',
        url: 'https://example.com',
        platform: 'example.com',
        progress: 80,
        startTime: Date.now(),
        tokensUsed: 0,
      };
      const context = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
          getTask: vi.fn().mockReturnValue(task),
          getAbortSignal: vi.fn().mockReturnValue(controller.signal),
        },
        historyStore: {
          ...createMockContext().historyStore,
          createHistory: vi.fn().mockImplementation(async (_item, signal) => {
            expect(signal).toBe(controller.signal);
            controller.abort();
            throw new ExtensionError(ErrorCode.TASK_CANCELLED, 'History write cancelled');
          }),
        },
      } as unknown as Partial<HandlerContext>);
      await expect(
        handleExtractionCompleted(
          {
            type: 'EXTRACTION_COMPLETED',
            payload: { taskId: task.id, success: true, comments: [] },
          },
          context,
        ),
      ).resolves.toEqual({ success: false });
      expect(context.taskManager.completeTask).not.toHaveBeenCalled();
      expect(context.taskManager.failTask).not.toHaveBeenCalled();
    });

    it('should return false for extraction completion without taskId', async () => {
      const context = createMockContext();
      const message = {
        type: 'EXTRACTION_COMPLETED' as const,
        payload: { success: true },
      } as unknown as Extract<import('../../src/types').Message, { type: 'EXTRACTION_COMPLETED' }>;

      const result = await handleExtractionCompleted(message, context);
      expect(result).toEqual({ success: false });
    });

    it('should return false for config completion without taskId', async () => {
      const context = createMockContext();
      const message = {
        type: 'CONFIG_GENERATION_COMPLETED' as const,
        payload: { success: true },
      } as unknown as Extract<
        import('../../src/types').Message,
        { type: 'CONFIG_GENERATION_COMPLETED' }
      >;

      const result = await handleConfigGenerationCompleted(message, context);
      expect(result).toEqual({ success: false });
    });

    it('should complete recovered extraction task when pending state is lost', async () => {
      const context = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
          getTask: vi.fn().mockReturnValue({ type: 'extract', status: 'failed' }),
          recoverInterruptedTask: vi.fn().mockReturnValue({
            id: 'task_123',
            type: 'extract',
            status: 'running',
            url: 'https://example.com',
            platform: 'example.com',
            progress: 80,
            startTime: Date.now(),
            tokensUsed: 0,
          }),
          completeTask: vi.fn(),
          failTask: vi.fn(),
        },
      } as unknown as Partial<HandlerContext>);

      const message = {
        type: 'EXTRACTION_COMPLETED' as const,
        payload: {
          taskId: 'task_123',
          success: true,
          comments: [
            {
              id: 'comment-1',
              username: 'user',
              content: 'content',
              likes: 1,
              timestamp: new Date().toISOString(),
              replies: [],
            },
          ],
          postInfo: {
            url: 'https://example.com',
            title: 'Recovered Title',
          },
        },
      };

      const result = await handleExtractionCompleted(message, context);

      expect(result).toEqual({ success: true });
      expect(context.historyStore.createHistory).toHaveBeenCalledOnce();
      expect(context.taskManager.completeTask).toHaveBeenCalledWith(
        'task_123',
        expect.objectContaining({ commentsCount: 1, title: 'Recovered Title' }),
      );
    });

    it('should ignore stale extraction completion for failed task', async () => {
      const context = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
          getTask: vi.fn().mockReturnValue({
            id: 'task_123',
            type: 'extract',
            status: 'failed',
            url: 'https://example.com',
            platform: 'example.com',
            progress: 80,
            startTime: Date.now(),
            tokensUsed: 0,
            error: 'Task cancelled by user',
          }),
          recoverInterruptedTask: vi.fn().mockReturnValue(undefined),
          completeTask: vi.fn(),
          failTask: vi.fn(),
        },
      } as unknown as Partial<HandlerContext>);

      const message = {
        type: 'EXTRACTION_COMPLETED' as const,
        payload: {
          taskId: 'task_123',
          success: true,
          comments: [
            {
              id: 'comment-1',
              username: 'user',
              content: 'content',
              likes: 1,
              timestamp: new Date().toISOString(),
              replies: [],
            },
          ],
          postInfo: {
            url: 'https://example.com',
            title: 'Late Title',
          },
        },
      };

      const result = await handleExtractionCompleted(message, context);

      expect(result).toEqual({ success: false });
      expect(context.historyStore.createHistory).not.toHaveBeenCalled();
      expect(context.taskManager.completeTask).not.toHaveBeenCalled();
      expect(context.taskManager.failTask).not.toHaveBeenCalled();
    });

    it('should ignore recovered completion when sender tab does not match task tab', async () => {
      const context = createMockContext({
        sender: {
          tab: { id: 1 },
        },
        taskManager: {
          ...createMockContext().taskManager,
          getTask: vi.fn().mockReturnValue({
            id: 'task_123',
            type: 'extract',
            status: 'failed',
            url: 'https://example.com',
            tabId: 2,
            platform: 'example.com',
            progress: 80,
            startTime: Date.now(),
            tokensUsed: 0,
            error: 'Task interrupted by restart',
            endTime: Date.now(),
          }),
          recoverInterruptedTask: vi.fn().mockReturnValue(undefined),
          completeTask: vi.fn(),
          failTask: vi.fn(),
        },
      } as unknown as Partial<HandlerContext>);

      const message = {
        type: 'EXTRACTION_COMPLETED' as const,
        payload: {
          taskId: 'task_123',
          success: true,
          comments: [],
        },
      };

      const result = await handleExtractionCompleted(message, context);

      expect(result).toEqual({ success: false });
      expect(context.taskManager.recoverInterruptedTask).not.toHaveBeenCalled();
      expect(context.taskManager.completeTask).not.toHaveBeenCalled();
    });

    it('should fail recovered config task when completion reports an error', async () => {
      const context = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
          getTask: vi.fn().mockReturnValue({ type: 'config', status: 'failed' }),
          recoverInterruptedTask: vi.fn().mockReturnValue({
            id: 'task_123',
            type: 'config',
            status: 'running',
            url: 'https://example.com',
            platform: 'example.com',
            progress: 60,
            startTime: Date.now(),
            tokensUsed: 0,
          }),
          completeTask: vi.fn(),
          failTask: vi.fn(),
        },
      } as unknown as Partial<HandlerContext>);

      const message = {
        type: 'CONFIG_GENERATION_COMPLETED' as const,
        payload: {
          taskId: 'task_123',
          success: false,
          error: 'config failed',
        },
      };

      const result = await handleConfigGenerationCompleted(message, context);

      expect(result).toEqual({ success: true });
      expect(context.taskManager.failTask).toHaveBeenCalledWith('task_123', 'config failed');
    });

    it('should ignore stale config completion for completed task', async () => {
      const context = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
          getTask: vi.fn().mockReturnValue({
            id: 'task_123',
            type: 'config',
            status: 'completed',
            url: 'https://example.com',
            platform: 'example.com',
            progress: 100,
            startTime: Date.now(),
            tokensUsed: 0,
          }),
          recoverInterruptedTask: vi.fn().mockReturnValue(undefined),
          completeTask: vi.fn(),
          failTask: vi.fn(),
        },
      } as unknown as Partial<HandlerContext>);

      const message = {
        type: 'CONFIG_GENERATION_COMPLETED' as const,
        payload: {
          taskId: 'task_123',
          success: true,
        },
      };

      const result = await handleConfigGenerationCompleted(message, context);

      expect(result).toEqual({ success: false });
      expect(context.taskManager.completeTask).not.toHaveBeenCalled();
      expect(context.taskManager.failTask).not.toHaveBeenCalled();
    });
  });
});
