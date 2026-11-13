import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleStartConfigGeneration,
  handleConfigGenerationCompleted,
} from '@/background/handlers/config-generation';
import { HandlerContext } from '@/background/handlers/types';
import { ErrorCode } from '@/utils/errors';

vi.mock('@/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/background/ContentScriptInjector', () => ({
  ensureContentScriptInjected: vi.fn().mockResolvedValue(undefined),
}));

vi.stubGlobal('chrome', {
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 10 }]),
    sendMessage: vi.fn().mockResolvedValue({ success: true }),
    onRemoved: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
});

function createMockContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    taskManager: {
      createTask: vi.fn().mockReturnValue('task_config_123'),
      setExecutor: vi.fn(),
      startTask: vi.fn().mockResolvedValue(undefined),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      getTask: vi
        .fn()
        .mockReturnValue({ id: 'task_config_123', type: 'config', status: 'running' }),
      recoverInterruptedTask: vi.fn(),
    },
    settingsStore: {
      getSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as HandlerContext;
}

describe('config-generation handler', () => {
  let context: HandlerContext;

  beforeEach(() => {
    context = createMockContext();
  });

  describe('handleStartConfigGeneration', () => {
    it('should throw validation error when url is missing', async () => {
      const message = {
        type: 'START_CONFIG_GENERATION' as const,
        payload: {} as any,
      };

      await expect(handleStartConfigGeneration(message, context)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should create config task and return taskId', async () => {
      const message = {
        type: 'START_CONFIG_GENERATION' as const,
        payload: {
          url: 'https://example.com/item/1',
          tabId: 10,
        },
      };

      const result = await handleStartConfigGeneration(message, context);

      expect(result).toEqual({ taskId: 'task_config_123' });
      expect(context.taskManager.createTask).toHaveBeenCalledWith(
        'config',
        'https://example.com/item/1',
        'example.com',
        0,
        10,
      );
    });
  });

  describe('handleConfigGenerationCompleted', () => {
    it('should complete task on success', async () => {
      const message = {
        type: 'CONFIG_GENERATION_COMPLETED' as const,
        payload: {
          taskId: 'task_config_123',
          success: true,
        },
      };

      const result = await handleConfigGenerationCompleted(message, context);

      expect(result).toEqual({ success: true });
      expect(context.taskManager.completeTask).toHaveBeenCalledWith('task_config_123', {
        tokensUsed: 0,
        commentsCount: 0,
      });
    });

    it('should include configDomain on completion when task has platform or url', async () => {
      vi.mocked(context.taskManager.getTask).mockReturnValue({
        id: 'task_config_123',
        type: 'config',
        status: 'running',
        url: 'https://news.example.com/item/1',
        platform: 'news.example.com',
        progress: 60,
        startTime: Date.now(),
        tokensUsed: 0,
      });

      const result = await handleConfigGenerationCompleted(
        {
          type: 'CONFIG_GENERATION_COMPLETED',
          payload: { taskId: 'task_config_123', success: true },
        },
        context,
      );

      expect(result).toEqual({ success: true });
      expect(context.taskManager.completeTask).toHaveBeenCalledWith('task_config_123', {
        tokensUsed: 0,
        commentsCount: 0,
        configDomain: 'news.example.com',
      });
    });

    it('should fail task on error', async () => {
      const message = {
        type: 'CONFIG_GENERATION_COMPLETED' as const,
        payload: {
          taskId: 'task_config_123',
          success: false,
          error: 'Selector not found',
        },
      };

      const result = await handleConfigGenerationCompleted(message, context);

      expect(result).toEqual({ success: true });
      expect(context.taskManager.failTask).toHaveBeenCalledWith(
        'task_config_123',
        'Selector not found',
      );
    });
  });
});
