import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetTaskStatus, handleCancelTask } from '../../src/background/handlers/task';
import { ExtensionError } from '../../src/utils/errors';
import type { Message, Task } from '../../src/types';

describe('Task Handlers', () => {
  const mockTaskManager = {
    getTask: vi.fn(),
    getAllTasks: vi.fn(),
    cancelTask: vi.fn(),
  } as unknown as Record<string, ReturnType<typeof vi.fn>>;

  const context = {
    taskManager: mockTaskManager,
  };

  const mockTask: Task = {
    id: 'task-123',
    type: 'extract',
    status: 'running',
    url: 'https://youtube.com/watch?v=123',
    platform: 'youtube',
    tabId: 1,
    progress: 50,
    startTime: Date.now(),
    tokensUsed: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.chrome = {
      tabs: {
        sendMessage: vi.fn(),
      },
    } as unknown as typeof chrome;
  });

  describe('handleGetTaskStatus', () => {
    it('should return all tasks when no taskId provided', () => {
      const mockTasks: Task[] = [mockTask];
      mockTaskManager.getAllTasks.mockReturnValue(mockTasks);

      const message: Extract<Message, { type: 'GET_TASK_STATUS' }> = {
        type: 'GET_TASK_STATUS',
        payload: {},
      };

      const result = handleGetTaskStatus(message, context);

      expect(result).toEqual({ tasks: mockTasks });
      expect(mockTaskManager.getAllTasks).toHaveBeenCalledOnce();
      expect(mockTaskManager.getTask).not.toHaveBeenCalled();
    });

    it('should return single task when taskId is provided', () => {
      mockTaskManager.getTask.mockReturnValue(mockTask);

      const message: Extract<Message, { type: 'GET_TASK_STATUS' }> = {
        type: 'GET_TASK_STATUS',
        payload: { taskId: 'task-123' },
      };

      const result = handleGetTaskStatus(message, context);

      expect(result).toEqual({ task: mockTask });
      expect(mockTaskManager.getTask).toHaveBeenCalledWith('task-123');
      expect(mockTaskManager.getAllTasks).not.toHaveBeenCalled();
    });

    it('should return null when task not found', () => {
      mockTaskManager.getTask.mockReturnValue(null);

      const message: Extract<Message, { type: 'GET_TASK_STATUS' }> = {
        type: 'GET_TASK_STATUS',
        payload: { taskId: 'non-existent' },
      };

      const result = handleGetTaskStatus(message, context);

      expect(result).toEqual({ task: null });
    });

    it('should handle empty payload', () => {
      const mockTasks: Task[] = [];
      mockTaskManager.getAllTasks.mockReturnValue(mockTasks);

      const message: Extract<Message, { type: 'GET_TASK_STATUS' }> = {
        type: 'GET_TASK_STATUS',
        payload: undefined,
      };

      const result = handleGetTaskStatus(message, context);

      expect(result).toEqual({ tasks: [] });
      expect(mockTaskManager.getAllTasks).toHaveBeenCalledOnce();
    });
  });

  describe('handleCancelTask', () => {
    it('should cancel extract task and send message to content script', () => {
      const extractTask: Task = {
        ...mockTask,
        type: 'extract',
        tabId: 1,
      };

      mockTaskManager.getTask.mockReturnValue(extractTask);
      global.chrome.tabs.sendMessage.mockResolvedValue(undefined);

      const message: Extract<Message, { type: 'CANCEL_TASK' }> = {
        type: 'CANCEL_TASK',
        payload: { taskId: 'task-123' },
      };

      const result = handleCancelTask(message, context);

      expect(result).toEqual({ success: true });
      expect(mockTaskManager.getTask).toHaveBeenCalledWith('task-123');
      expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'CANCEL_EXTRACTION',
        payload: { taskId: 'task-123' },
      });
      expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('task-123');
    });

    it('should cancel analyze task without sending message to content script', () => {
      const analyzeTask: Task = {
        ...mockTask,
        type: 'analyze',
      };

      mockTaskManager.getTask.mockReturnValue(analyzeTask);

      const message: Extract<Message, { type: 'CANCEL_TASK' }> = {
        type: 'CANCEL_TASK',
        payload: { taskId: 'task-456' },
      };

      const result = handleCancelTask(message, context);

      expect(result).toEqual({ success: true });
      expect(mockTaskManager.getTask).toHaveBeenCalledWith('task-456');
      expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
      expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('task-456');
    });

    it('should cancel config task and send message to content script', () => {
      const configTask: Task = {
        ...mockTask,
        type: 'config',
        tabId: 2,
      };

      mockTaskManager.getTask.mockReturnValue(configTask);
      global.chrome.tabs.sendMessage.mockResolvedValue(undefined);

      const message: Extract<Message, { type: 'CANCEL_TASK' }> = {
        type: 'CANCEL_TASK',
        payload: { taskId: 'task-789' },
      };

      const result = handleCancelTask(message, context);

      expect(result).toEqual({ success: true });
      expect(mockTaskManager.getTask).toHaveBeenCalledWith('task-789');
      expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(2, {
        type: 'CANCEL_EXTRACTION',
        payload: { taskId: 'task-789' },
      });
      expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('task-789');
    });

    it('should throw error when taskId is missing', () => {
      const message: Extract<Message, { type: 'CANCEL_TASK' }> = {
        type: 'CANCEL_TASK',
        payload: { taskId: '' },
      };

      expect(() => handleCancelTask(message, context)).toThrow(ExtensionError);
      expect(() => handleCancelTask(message, context)).toThrow('Task ID is required');
    });

    it('should throw error when payload is missing', () => {
      const message = {
        type: 'CANCEL_TASK' as const,
        payload: undefined,
      } as Extract<Message, { type: 'CANCEL_TASK' }>;

      expect(() => handleCancelTask(message, context)).toThrow(ExtensionError);
      expect(() => handleCancelTask(message, context)).toThrow('Task ID is required');
    });

    it('should handle content script message error gracefully', () => {
      const extractTask: Task = {
        ...mockTask,
        type: 'extract',
        tabId: 1,
      };

      mockTaskManager.getTask.mockReturnValue(extractTask);
      global.chrome.tabs.sendMessage.mockRejectedValue(new Error('Content script not found'));

      const message: Extract<Message, { type: 'CANCEL_TASK' }> = {
        type: 'CANCEL_TASK',
        payload: { taskId: 'task-123' },
      };

      const result = handleCancelTask(message, context);

      expect(result).toEqual({ success: true });
      expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('task-123');
    });

    it('should cancel task when task is null', () => {
      mockTaskManager.getTask.mockReturnValue(null);

      const message: Extract<Message, { type: 'CANCEL_TASK' }> = {
        type: 'CANCEL_TASK',
        payload: { taskId: 'non-existent' },
      };

      const result = handleCancelTask(message, context);

      expect(result).toEqual({ success: true });
      expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('non-existent');
    });

    it('should not send message when extract task has no tabId', () => {
      const extractTask: Task = {
        ...mockTask,
        type: 'extract',
        tabId: undefined,
      };

      mockTaskManager.getTask.mockReturnValue(extractTask);

      const message: Extract<Message, { type: 'CANCEL_TASK' }> = {
        type: 'CANCEL_TASK',
        payload: { taskId: 'task-123' },
      };

      const result = handleCancelTask(message, context);

      expect(result).toEqual({ success: true });
      expect(global.chrome.tabs.sendMessage).not.toHaveBeenCalled();
      expect(mockTaskManager.cancelTask).toHaveBeenCalledWith('task-123');
    });
  });
});
