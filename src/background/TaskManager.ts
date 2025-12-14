import { Task, Platform } from '../types';
import { NotificationService } from './NotificationService';
import { Logger } from '../utils/logger';
import { ExtensionError, ErrorCode } from '../utils/errors';
import { ERRORS, LIMITS, STORAGE, TIMING } from '@/config/constants';

export interface TaskResult {
  tokensUsed?: number;
  commentsCount?: number;
}

type TaskExecutor = (task: Task, signal: AbortSignal) => Promise<TaskResult>;

interface PersistedTaskState {
  tasks: Task[];
  queue: string[];
  currentTaskId: string | null;
  savedAt: number;
}

/**
 * TaskManager handles the creation, execution, and lifecycle of tasks
 * in the Comments Insight extension.
 */
export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private queue: string[] = [];
  private currentTaskId: string | null = null;
  private abortControllers: Map<string, AbortController> = new Map();
  private executors: Map<string, TaskExecutor> = new Map();
  private readonly enablePersistence: boolean;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options?: { enablePersistence?: boolean }) {
    this.enablePersistence = options?.enablePersistence === true;
  }

  async initialize(): Promise<void> {
    if (!this.enablePersistence) {
      return;
    }

    try {
      const state = await this.loadState();
      if (!state) {
        return;
      }

      this.tasks = new Map(state.tasks.map((t) => [t.id, t]));
      this.queue = [...state.queue];
      this.currentTaskId = state.currentTaskId;

      const now = Date.now();
      let changed = false;

      for (const task of this.tasks.values()) {
        if (task.status === 'pending' || task.status === 'running') {
          task.status = 'failed';
          task.error = ERRORS.TASK_INTERRUPTED_BY_RESTART;
          task.endTime = now;
          changed = true;
        }
      }

      if (this.queue.length > 0) {
        this.queue = [];
        changed = true;
      }
      if (this.currentTaskId !== null) {
        this.currentTaskId = null;
        changed = true;
      }

      if (changed) {
        await this.saveState();
      }
    } catch (error) {
      Logger.warn('[TaskManager] Failed to initialize task state', { error });
    }
  }

  /**
   * Create a new task
   * @param type - Type of task ('extract' or 'analyze')
   * @param url - URL of the page
   * @param platform - Platform type
   * @returns Task ID
   */
  createTask(
    type: Task['type'],
    url: string,
    platform: Platform,
    maxComments?: number,
    tabId?: number,
  ): string {
    const id = this.generateTaskId();
    const task: Task = {
      id,
      type,
      status: 'pending',
      url,
      platform,
      tabId,
      progress: 0,
      startTime: Date.now(),
      tokensUsed: 0,
      maxComments,
    };

    this.tasks.set(id, task);
    this.queue.push(id);

    this.schedulePersist();

    Logger.info(`[TaskManager] Task created: ${id}`, { type, url, platform });
    return id;
  }

  setExecutor(taskId: string, executor: TaskExecutor): void {
    this.executors.set(taskId, executor);
    if (!this.queue.includes(taskId)) {
      this.queue.push(taskId);
    }
    this.schedulePersist();
    this.processQueue();
  }

  registerAbortController(taskId: string, controller: AbortController): void {
    this.abortControllers.set(taskId, controller);
  }

  abortTask(taskId: string): void {
    const controller = this.abortControllers.get(taskId);
    if (!controller) {
      return;
    }
    controller.abort();
    this.abortControllers.delete(taskId);
  }

  private clearAbortController(taskId: string): void {
    this.abortControllers.delete(taskId);
  }

  /**
   * Start a task
   * @param taskId - ID of the task to start
   */
  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new ExtensionError(ErrorCode.TASK_NOT_FOUND, `Task not found: ${taskId}`, { taskId });
    }

    // If task is already running, just return (idempotent)
    if (task.status === 'running') {
      Logger.debug(`[TaskManager] Task ${taskId} is already running`);
      return;
    }

    // If task is completed or failed, don't restart
    if (task.status === 'completed' || task.status === 'failed') {
      Logger.warn(`[TaskManager] Task ${taskId} is in ${task.status} state, cannot restart`);
      // Ensure it's removed from queue if it somehow got there
      const queueIndex = this.queue.indexOf(taskId);
      if (queueIndex !== -1) {
        this.queue.splice(queueIndex, 1);
      }
      return;
    }

    // Remove from queue to prevent double execution
    const queueIndex = this.queue.indexOf(taskId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    task.status = 'running';
    task.startTime = Date.now();
    this.currentTaskId = taskId;

    Logger.info(`[TaskManager] Task started: ${taskId}`);
    this.notifyTaskUpdate(task);

    this.schedulePersist();
  }

  /**
   * Update task progress
   * @param taskId - ID of the task
   * @param progress - Progress percentage (0-100)
   * @param message - Optional progress message
   */
  updateTaskProgress(taskId: string, progress: number, message?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      Logger.warn(`[TaskManager] Task not found: ${taskId}`);
      return;
    }

    task.progress = Math.min(100, Math.max(0, progress));
    if (message) {
      task.message = message;
    }
    Logger.debug(`[TaskManager] Task progress updated: ${taskId}`, {
      progress: task.progress,
      message,
    });
    this.notifyTaskUpdate(task);

    this.schedulePersist();
  }

  /**
   * Complete a task successfully
   * @param taskId - ID of the task
   * @param result - Task result data
   */
  completeTask(taskId: string, result: TaskResult): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      Logger.warn(`[TaskManager] Task not found: ${taskId}`);
      return;
    }

    this.clearAbortController(taskId);

    task.status = 'completed';
    task.progress = 100;
    task.endTime = Date.now();

    // Update tokens used if provided in result
    if (result && typeof result.tokensUsed === 'number') {
      task.tokensUsed = result.tokensUsed;
    }

    Logger.info(`[TaskManager] Task completed: ${taskId}`, {
      duration: task.endTime - task.startTime,
      tokensUsed: task.tokensUsed,
      commentsCount: result?.commentsCount,
    });

    // Show completion notification
    NotificationService.showTaskCompleted(task.type, `Task completed`, result?.commentsCount);

    this.currentTaskId = null;
    this.notifyTaskUpdate(task);
    this.schedulePersist();
    this.processQueue();
  }

  /**
   * Fail a task with an error
   * @param taskId - ID of the task
   * @param error - Error message
   */
  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      Logger.warn(`[TaskManager] Task not found: ${taskId}`);
      return;
    }

    this.clearAbortController(taskId);

    task.status = 'failed';
    task.error = error;
    task.endTime = Date.now();

    Logger.error(`[TaskManager] Task failed: ${taskId}`, { error });

    // Show failure notification
    NotificationService.showTaskFailed(task.type, error);

    this.currentTaskId = null;
    this.notifyTaskUpdate(task);
    this.schedulePersist();
    this.processQueue();
  }

  /**
   * Cancel a running or pending task
   * @param taskId - ID of the task to cancel
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      Logger.warn(`[TaskManager] Task not found: ${taskId}`);
      return;
    }

    if (task.status === 'completed' || task.status === 'failed') {
      Logger.warn(`[TaskManager] Cannot cancel task in ${task.status} state`);
      return;
    }

    // Remove from queue if pending
    const queueIndex = this.queue.indexOf(taskId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    this.executors.delete(taskId);

    this.abortTask(taskId);

    task.status = 'failed';
    task.error = ERRORS.TASK_CANCELLED_BY_USER;
    task.endTime = Date.now();

    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
    }

    Logger.info(`[TaskManager] Task cancelled: ${taskId}`);
    this.notifyTaskUpdate(task);
    this.schedulePersist();
    this.processQueue();
  }

  /**
   * Get a task by ID
   * @param taskId - ID of the task
   * @returns Task or undefined
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks
   * @returns Array of all tasks
   */
  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by status
   * @param status - Task status to filter by
   * @returns Array of tasks with the specified status
   */
  getTasksByStatus(status: Task['status']): Task[] {
    return this.getAllTasks().filter((task) => task.status === status);
  }

  /**
   * Clear completed and failed tasks
   */
  clearFinishedTasks(): void {
    const finishedTasks = this.getAllTasks().filter(
      (task) => task.status === 'completed' || task.status === 'failed',
    );

    finishedTasks.forEach((task) => {
      this.tasks.delete(task.id);
      this.executors.delete(task.id);
      this.abortControllers.delete(task.id);
    });

    Logger.info(`[TaskManager] Cleared ${finishedTasks.length} finished tasks`);
    this.schedulePersist();
  }

  /**
   * Generate a unique task ID
   * @returns Unique task ID
   */
  private generateTaskId(): string {
    const start = LIMITS.RANDOM_ID_START_INDEX;
    const end = LIMITS.RANDOM_ID_START_INDEX + LIMITS.ID_RANDOM_LENGTH;
    return `task_${Date.now()}_${Math.random().toString(36).slice(start, end)}`;
  }

  /**
   * Process the task queue
   */
  private processQueue(): void {
    if (this.currentTaskId !== null || this.queue.length === 0) {
      return;
    }

    const nextIndex = this.queue.findIndex((id) => this.executors.has(id));
    if (nextIndex === -1) {
      return;
    }

    const nextTaskId = this.queue.splice(nextIndex, 1)[0];
    const executor = this.executors.get(nextTaskId);
    if (!executor) {
      return;
    }

    this.startTask(nextTaskId)
      .then(async () => {
        const task = this.tasks.get(nextTaskId);
        if (!task) {
          return;
        }

        const controller = new AbortController();
        this.registerAbortController(nextTaskId, controller);

        try {
          const result = await executor(task, controller.signal);
          const latest = this.tasks.get(nextTaskId);
          if (!latest || latest.status !== 'running') {
            return;
          }
          this.completeTask(nextTaskId, result || {});
        } catch (error) {
          const latest = this.tasks.get(nextTaskId);
          if (!latest || latest.status !== 'running') {
            return;
          }
          Logger.error(`[TaskManager] Executor failed for task ${nextTaskId}`, { error });
          this.failTask(nextTaskId, error instanceof Error ? error.message : String(error));
        } finally {
          this.executors.delete(nextTaskId);
          this.clearAbortController(nextTaskId);
        }
      })
      .catch((error) => {
        Logger.error(`[TaskManager] Failed to start task ${nextTaskId}`, { error });
        this.failTask(nextTaskId, error instanceof Error ? error.message : String(error));
      });
  }

  private schedulePersist(): void {
    if (!this.enablePersistence) {
      return;
    }
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.saveState().catch((error) => {
        Logger.warn('[TaskManager] Failed to persist task state', { error });
      });
    }, TIMING.TASK_STATE_PERSIST_DEBOUNCE_MS);
  }

  private async loadState(): Promise<PersistedTaskState | null> {
    try {
      const result = await chrome.storage.local.get(STORAGE.TASK_STATE_KEY);
      const state = result[STORAGE.TASK_STATE_KEY] as PersistedTaskState | undefined;
      return state || null;
    } catch {
      return null;
    }
  }

  private async saveState(): Promise<void> {
    if (!this.enablePersistence) {
      return;
    }
    try {
      const state: PersistedTaskState = {
        tasks: Array.from(this.tasks.values()),
        queue: [...this.queue],
        currentTaskId: this.currentTaskId,
        savedAt: Date.now(),
      };
      await chrome.storage.local.set({ [STORAGE.TASK_STATE_KEY]: state });
    } catch {
      return;
    }
  }

  /**
   * Notify listeners about task updates
   * @param task - Updated task
   */
  private notifyTaskUpdate(task: Task): void {
    chrome.runtime
      .sendMessage({
        type: 'TASK_UPDATE',
        payload: task,
      })
      .catch(() => {
        // Expected: no listeners active (popup closed)
      });
  }
}
