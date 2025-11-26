import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleStartExtraction,
  handleExtractionProgress,
  chunkDomText,
} from '../../src/background/handlers/extraction';
import { HandlerContext } from '../../src/background/handlers/types';

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
  },
  runtime: {
    sendMessage: vi.fn(),
  },
});

function createMockContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    taskManager: {
      createTask: vi.fn().mockReturnValue('task_123'),
      startTask: vi.fn().mockResolvedValue(undefined),
      updateProgress: vi.fn(),
      updateTaskProgress: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      getTask: vi.fn().mockReturnValue({ maxComments: 100 }),
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
      );
    });

    it('should throw error when URL is missing', async () => {
      const context = createMockContext();
      const message = {
        type: 'START_EXTRACTION' as const,
        payload: {},
      };

      await expect(
        handleStartExtraction(message as Extract<import('../../src/types').Message, { type: 'START_EXTRACTION' }>, context),
      ).rejects.toThrow('URL is required');
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
      expect(context.taskManager.updateTaskProgress).toHaveBeenCalledWith('task_123', 50, expect.stringContaining('Extracting comments'));
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
        payload: { taskId: 'task_123', progress: 100, message: 'Completed', data: { commentCount: 50 } },
      };

      const result = await handleExtractionProgress(message, context);

      expect(result.success).toBe(true);
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
