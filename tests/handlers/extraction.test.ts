import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleStartExtraction,
  handleStartConfigGeneration,
  handleExtractionProgress,
  handleExtractionCompleted,
  handleConfigGenerationCompleted,
  chunkDomText,
} from '../../src/background/handlers/extraction';
import { HandlerContext } from '../../src/background/handlers/types';
import { ErrorCode } from '../../src/utils/errors';
import { TIMEOUT, TEXT } from '../../src/config/constants';

const tabRemovedListeners = new Set<
  (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void
>();

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
    sendMessage: vi.fn().mockResolvedValue({ success: true, comments: [] }),
    onRemoved: {
      addListener: vi.fn((listener) => tabRemovedListeners.add(listener)),
      removeListener: vi.fn((listener) => tabRemovedListeners.delete(listener)),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
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
      completeTask: vi.fn(),
      failTask: vi.fn(),
      getTask: vi.fn().mockReturnValue({ maxComments: 100 }),
      recoverInterruptedTask: vi.fn().mockReturnValue(undefined),
      getAllTasks: vi.fn().mockReturnValue([]),
      cancelTask: vi.fn(),
      incrementTokens: vi.fn(),
    },
    storageManager: {
      getSettings: vi.fn().mockResolvedValue({ maxComments: 100 }),
      saveSettings: vi.fn(),
      getHistory: vi.fn().mockResolvedValue([]),
      saveHistory: vi.fn(),
    },
    aiService: {
      callAI: vi.fn(),
      analyzeComments: vi.fn(),
    },
    sender: {
      tab: { id: 1 },
    },
    ...overrides,
  } as unknown as HandlerContext;
}

describe('extraction handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tabRemovedListeners.clear();
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

      expect(context.storageManager.getSettings).toHaveBeenCalled();
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
        task: { id: string; tabId?: number },
        signal: AbortSignal,
      ) => Promise<unknown>;

      const controller = new AbortController();
      const running = executor({ id: 'task_123', tabId: 1 }, controller.signal);
      const rejection = expect(running).rejects.toMatchObject({
        code: ErrorCode.TIMEOUT_ERROR,
      });

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
        task: { id: string; tabId?: number },
        signal: AbortSignal,
      ) => Promise<unknown>;

      const controller = new AbortController();
      const running = executor({ id: 'task_123', tabId: 1 }, controller.signal);
      await flushMicrotasks();
      expect(tabRemovedListeners.size).toBe(1);

      for (const listener of tabRemovedListeners) {
        listener(1, { isWindowClosing: false, windowId: 1 });
      }

      await expect(running).rejects.toMatchObject({
        code: ErrorCode.EXTRACTION_FAILED,
        message: TEXT.TASK_SOURCE_TAB_CLOSED,
      });
    });
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
        task: { id: string; tabId?: number },
        signal: AbortSignal,
      ) => Promise<unknown>;

      const controller = new AbortController();
      const running = executor({ id: 'task_123', tabId: 1 }, controller.signal);
      const rejection = expect(running).rejects.toMatchObject({
        code: ErrorCode.TIMEOUT_ERROR,
      });

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
          getTask: vi.fn().mockReturnValue({ maxComments: 50 }),
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
  });

  describe('completion payload validation', () => {
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
      expect(context.storageManager.saveHistory).toHaveBeenCalledOnce();
      expect(context.taskManager.completeTask).toHaveBeenCalledWith(
        'task_123',
        expect.objectContaining({ commentsCount: 1, title: 'Recovered Title' }),
      );
    });

    it('should fail recovered config task when completion reports an error', async () => {
      const context = createMockContext({
        taskManager: {
          ...createMockContext().taskManager,
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
  });

  describe('chunkDomText', () => {
    it('should chunk text by token limit', () => {
      const text = Array(100).fill('line of text').join('\n');
      const chunks = chunkDomText(text, 500);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeGreaterThan(0);
      });
    });

    it('should return single chunk for small text', () => {
      const text = 'small text';
      const chunks = chunkDomText(text, 1000);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('small text');
    });
  });
});
