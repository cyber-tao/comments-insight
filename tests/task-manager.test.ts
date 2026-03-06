import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskManager } from '../src/background/TaskManager';
import { STORAGE } from '../src/config/constants';

const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockStorageGet = vi.fn().mockResolvedValue({});
const mockStorageSet = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
    },
  },
});

vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/background/NotificationService', () => ({
  NotificationService: {
    showTaskCompleted: vi.fn(),
    showTaskFailed: vi.fn(),
  },
}));

describe('TaskManager', () => {
  let taskManager: TaskManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue({});
    mockStorageSet.mockResolvedValue(undefined);
    taskManager = new TaskManager();
  });

  describe('initialize', () => {
    it('should mark persisted running and pending tasks as interrupted', async () => {
      const now = Date.now();
      mockStorageGet.mockResolvedValue({
        [STORAGE.TASK_STATE_KEY]: {
          tasks: [
            {
              id: 'task_running',
              type: 'extract',
              status: 'running',
              url: 'https://example.com/a',
              platform: 'Generic',
              progress: 42,
              startTime: now - 1000,
              tokensUsed: 0,
              detailedProgress: {
                stage: 'extracting',
                current: 42,
                total: 100,
                estimatedTimeRemaining: 5,
              },
            },
            {
              id: 'task_pending',
              type: 'analyze',
              status: 'pending',
              url: 'https://example.com/b',
              platform: 'Generic',
              progress: 0,
              startTime: now - 500,
              tokensUsed: 0,
            },
          ],
          queue: ['task_running', 'task_pending'],
          currentTaskId: 'task_running',
          savedAt: now - 100,
        },
      });

      const persistentTaskManager = new TaskManager({ enablePersistence: true });
      await persistentTaskManager.initialize();

      const runningTask = persistentTaskManager.getTask('task_running');
      const pendingTask = persistentTaskManager.getTask('task_pending');

      expect(runningTask?.status).toBe('failed');
      expect(runningTask?.error).toBeTruthy();
      expect(runningTask?.message).toBe(runningTask?.error);
      expect(runningTask?.detailedProgress).toBeUndefined();
      expect(runningTask?.endTime).toBeTypeOf('number');

      expect(pendingTask?.status).toBe('failed');
      expect(pendingTask?.error).toBeTruthy();

      expect(mockStorageSet).toHaveBeenCalledWith({
        [STORAGE.TASK_STATE_KEY]: expect.objectContaining({
          queue: [],
          currentTaskId: null,
        }),
      });
    });

    it('should normalize malformed persisted state instead of crashing', async () => {
      mockStorageGet.mockResolvedValue({
        [STORAGE.TASK_STATE_KEY]: {
          tasks: [{ id: 'broken-task' }, null, 'invalid'],
          queue: ['task_a', 123, null],
          currentTaskId: 456,
          savedAt: 'invalid',
        },
      });

      const persistentTaskManager = new TaskManager({ enablePersistence: true });

      await expect(persistentTaskManager.initialize()).resolves.toBeUndefined();
      expect(persistentTaskManager.getAllTasks()).toHaveLength(0);
      expect(mockStorageSet).toHaveBeenCalledWith({
        [STORAGE.TASK_STATE_KEY]: expect.objectContaining({
          tasks: [],
          queue: [],
          currentTaskId: null,
        }),
      });
    });
  });

  describe('createTask', () => {
    it('should create a task with correct initial state', () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');

      expect(taskId).toMatch(/^task_\d+_[a-z0-9]+$/);

      const task = taskManager.getTask(taskId);
      expect(task).toBeDefined();
      expect(task?.type).toBe('extract');
      expect(task?.url).toBe('https://example.com');
      expect(task?.platform).toBe('Generic');
      expect(task?.status).toBe('pending');
      expect(task?.progress).toBe(0);
    });

    it('should create multiple tasks', () => {
      const taskId1 = taskManager.createTask('extract', 'https://a.com', 'YouTube');
      const taskId2 = taskManager.createTask('analyze', 'https://b.com', 'Twitter');

      expect(taskId1).not.toBe(taskId2);
      expect(taskManager.getAllTasks()).toHaveLength(2);
    });
  });

  describe('startTask', () => {
    it('should start a pending task', async () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');

      await taskManager.startTask(taskId);

      const task = taskManager.getTask(taskId);
      expect(task?.status).toBe('running');
    });

    it('should throw error for non-existent task', async () => {
      await expect(taskManager.startTask('non-existent')).rejects.toThrow('Task not found');
    });

    it('should not restart completed task', async () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');
      await taskManager.startTask(taskId);
      taskManager.completeTask(taskId, { commentsCount: 10 });

      await taskManager.startTask(taskId);

      const task = taskManager.getTask(taskId);
      expect(task?.status).toBe('completed');
    });

    it('should be idempotent for running tasks', async () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');
      await taskManager.startTask(taskId);

      await taskManager.startTask(taskId);

      const task = taskManager.getTask(taskId);
      expect(task?.status).toBe('running');
    });
  });

  describe('updateTaskProgress', () => {
    it('should update progress within bounds', async () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');
      await taskManager.startTask(taskId);

      taskManager.updateTaskProgress(taskId, 50, 'Halfway done');

      const task = taskManager.getTask(taskId);
      expect(task?.progress).toBe(50);
      expect(task?.message).toBe('Halfway done');
    });

    it('should clamp progress to 0-100', async () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');
      await taskManager.startTask(taskId);

      taskManager.updateTaskProgress(taskId, 150);
      expect(taskManager.getTask(taskId)?.progress).toBe(100);

      taskManager.updateTaskProgress(taskId, -50);
      expect(taskManager.getTask(taskId)?.progress).toBe(0);
    });

    it('should ignore updates for non-existent tasks', () => {
      expect(() => taskManager.updateTaskProgress('non-existent', 50)).not.toThrow();
    });
  });

  describe('completeTask', () => {
    it('should complete task with result', async () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');
      await taskManager.startTask(taskId);

      taskManager.completeTask(taskId, { tokensUsed: 100, commentsCount: 5 });

      const task = taskManager.getTask(taskId);
      expect(task?.status).toBe('completed');
      expect(task?.progress).toBe(100);
      expect(task?.tokensUsed).toBe(100);
      expect(task?.endTime).toBeDefined();
    });

    it('should notify task update', async () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');
      await taskManager.startTask(taskId);
      vi.clearAllMocks();

      taskManager.completeTask(taskId, {});

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TASK_UPDATE',
          payload: expect.objectContaining({ status: 'completed' }),
        }),
      );
    });
  });

  describe('failTask', () => {
    it('should fail task with error message', async () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');
      await taskManager.startTask(taskId);

      taskManager.failTask(taskId, 'Network error');

      const task = taskManager.getTask(taskId);
      expect(task?.status).toBe('failed');
      expect(task?.error).toBe('Network error');
      expect(task?.endTime).toBeDefined();
    });
  });

  describe('cancelTask', () => {
    it('should cancel pending task', () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');

      taskManager.cancelTask(taskId);

      const task = taskManager.getTask(taskId);
      expect(task?.status).toBe('failed');
      expect(task?.error).toBeDefined();
    });

    it('should cancel running task', async () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');
      await taskManager.startTask(taskId);

      taskManager.cancelTask(taskId);

      const task = taskManager.getTask(taskId);
      expect(task?.status).toBe('failed');
    });

    it('should not cancel completed task', async () => {
      const taskId = taskManager.createTask('extract', 'https://example.com', 'Generic');
      await taskManager.startTask(taskId);
      taskManager.completeTask(taskId, {});

      taskManager.cancelTask(taskId);

      const task = taskManager.getTask(taskId);
      expect(task?.status).toBe('completed');
    });
  });

  describe('getTasksByStatus', () => {
    it('should filter tasks by status', async () => {
      const taskId1 = taskManager.createTask('extract', 'https://a.com', 'Generic');
      const taskId2 = taskManager.createTask('extract', 'https://b.com', 'Generic');
      taskManager.createTask('extract', 'https://c.com', 'Generic');

      await taskManager.startTask(taskId1);
      taskManager.completeTask(taskId1, {});

      await taskManager.startTask(taskId2);

      expect(taskManager.getTasksByStatus('completed')).toHaveLength(1);
      expect(taskManager.getTasksByStatus('running')).toHaveLength(1);
      expect(taskManager.getTasksByStatus('pending')).toHaveLength(1);
    });
  });

  describe('clearFinishedTasks', () => {
    it('should clear completed and failed tasks', async () => {
      const taskId1 = taskManager.createTask('extract', 'https://a.com', 'Generic');
      const taskId2 = taskManager.createTask('extract', 'https://b.com', 'Generic');
      const taskId3 = taskManager.createTask('extract', 'https://c.com', 'Generic');

      await taskManager.startTask(taskId1);
      taskManager.completeTask(taskId1, {});

      await taskManager.startTask(taskId2);
      taskManager.failTask(taskId2, 'Error');

      expect(taskManager.getAllTasks()).toHaveLength(3);

      taskManager.clearFinishedTasks();

      expect(taskManager.getAllTasks()).toHaveLength(1);
      expect(taskManager.getTask(taskId3)).toBeDefined();
    });
  });
});
