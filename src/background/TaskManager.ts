import { Task, Platform } from '../types';
import { NotificationService } from './NotificationService';
import { Logger } from '../utils/logger';
import { ExtensionError, ErrorCode } from '../utils/errors';

export interface TaskResult {
  tokensUsed?: number;
  commentsCount?: number;
}

/**
 * TaskManager handles the creation, execution, and lifecycle of tasks
 * in the Comments Insight extension.
 */
export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private queue: string[] = [];
  private currentTaskId: string | null = null;

  /**
   * Create a new task
   * @param type - Type of task ('extract' or 'analyze')
   * @param url - URL of the page
   * @param platform - Platform type
   * @returns Task ID
   */
  createTask(type: Task['type'], url: string, platform: Platform, maxComments?: number): string {
    const id = this.generateTaskId();
    const task: Task = {
      id,
      type,
      status: 'pending',
      url,
      platform,
      progress: 0,
      startTime: Date.now(),
      tokensUsed: 0,
      maxComments,
    };

    this.tasks.set(id, task);
    this.queue.push(id);

    Logger.info(`[TaskManager] Task created: ${id}`, { type, url, platform });
    return id;
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

    task.status = 'failed';
    task.error = error;
    task.endTime = Date.now();

    Logger.error(`[TaskManager] Task failed: ${taskId}`, { error });

    // Show failure notification
    NotificationService.showTaskFailed(task.type, error);

    this.currentTaskId = null;
    this.notifyTaskUpdate(task);
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

    task.status = 'failed';
    task.error = 'Task cancelled by user';
    task.endTime = Date.now();

    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
    }

    Logger.info(`[TaskManager] Task cancelled: ${taskId}`);
    this.notifyTaskUpdate(task);
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
    });

    Logger.info(`[TaskManager] Cleared ${finishedTasks.length} finished tasks`);
  }

  /**
   * Generate a unique task ID
   * @returns Unique task ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Process the task queue
   */
  private processQueue(): void {
    if (this.currentTaskId !== null || this.queue.length === 0) {
      return;
    }

    const nextTaskId = this.queue.shift();
    if (nextTaskId) {
      this.startTask(nextTaskId).catch((error) => {
        Logger.error(`[TaskManager] Failed to start task ${nextTaskId}`, { error });
        this.failTask(nextTaskId, error.message);
      });
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

/**
 * @deprecated Use getTaskManager() from ServiceContainer instead
 */
export const taskManager = new TaskManager();
