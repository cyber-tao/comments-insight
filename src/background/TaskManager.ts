import { Task, Platform, ProgressStage, TaskProgressMessageParams } from '../types';
import { NotificationService } from './NotificationService';
import { Logger } from '../utils/logger';
import { ExtensionError, ErrorCode } from '../utils/errors';
import {
  CHROME_MESSAGE_ERRORS,
  ERROR_KEYS,
  LIMITS,
  MESSAGES,
  TASK,
  TIMING,
} from '@/config/constants';
import i18n from '@/utils/i18n';
import { TaskPersistence } from './TaskPersistence';
import { TaskProgressCalculator } from './TaskProgressCalculator';

/**
 * Result returned when a task completes successfully.
 */
export interface TaskResult {
  /** Number of AI tokens consumed during the task */
  tokensUsed?: number;
  /** Number of comments extracted or analyzed */
  commentsCount?: number;
  /** Preferred title for notifications */
  title?: string;
}

/**
 * Detailed progress update for enhanced UI feedback.
 */
export interface DetailedProgressUpdate {
  /** Current stage of the task */
  stage: ProgressStage;
  /** Current item count (e.g., comments extracted so far) */
  current: number;
  /** Total items to process (e.g., max comments) */
  total: number;
  /** Optional stage-specific message */
  stageMessage?: string;
  /** Optional translation key for the stage-specific message */
  stageMessageKey?: string;
  /** Optional translation params for the stage-specific message */
  stageMessageParams?: TaskProgressMessageParams;
}

/** Function type for task executors */
type TaskExecutor = (task: Task, signal: AbortSignal) => Promise<TaskResult>;

interface RecoverInterruptedTaskOptions {
  taskType?: Task['type'];
  senderTabId?: number;
  maxAgeMs?: number;
}

/**
 * TaskManager handles the creation, execution, and lifecycle of tasks
 * in the Comments Insight extension.
 *
 * Features:
 * - Task queue management with sequential execution
 * - Task state persistence for recovery after extension restart
 * - Abort/cancel support with proper cleanup
 * - Progress tracking with detailed stage information
 * - Automatic notifications on task completion/failure
 *
 * @example
 * ```typescript
 * const taskManager = new TaskManager({ enablePersistence: true });
 * await taskManager.initialize();
 *
 * const taskId = taskManager.createTask('extract', url, platform);
 * taskManager.setExecutor(taskId, async (task, signal) => {
 *   // Execute extraction...
 *   return { commentsCount: 100 };
 * });
 * ```
 */
export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private queue: string[] = [];
  private currentTaskId: string | null = null;
  private abortControllers: Map<string, AbortController> = new Map();
  private executors: Map<string, TaskExecutor> = new Map();
  // The executor chain owns its slot until finally, even after cancellation.
  // Recovered completions have no executor chain and must release their own slot.
  private executingTaskId: string | null = null;
  private pendingTaskUpdates: Map<string, Task> = new Map();
  private taskUpdateThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly persistence: TaskPersistence;

  constructor(
    private notificationService: NotificationService,
    config: { enablePersistence?: boolean } = {},
  ) {
    this.persistence = new TaskPersistence({
      enabled: config.enablePersistence === true,
      getSnapshot: () => ({
        tasks: Array.from(this.tasks.values()),
        queue: [...this.queue],
        currentTaskId: this.currentTaskId,
      }),
    });
  }

  async initialize(): Promise<void> {
    if (!this.persistence.isEnabled()) {
      return;
    }

    try {
      const state = await this.persistence.load();
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
          this.persistence.markInterruptedByRestart(task, now);
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
        await this.persistence.save();
      }
    } catch (error) {
      Logger.warn('[TaskManager] Failed to initialize task state', { error });
      throw error;
    }
  }

  /**
   * Create a new task
   * @param type - Type of task ('extract', 'analyze', or 'config')
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

  getAbortSignal(taskId: string): AbortSignal | undefined {
    return this.abortControllers.get(taskId)?.signal;
  }

  async bindSourceDocument(task: Task, documentId: string): Promise<void> {
    task.sourceDocumentId = documentId;
    await this.saveState().catch((error) => {
      Logger.warn('[TaskManager] Failed to persist the source document', { error });
    });
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
    this.notifyTaskUpdate(task, { immediate: true });

    // Persist running/currentTaskId immediately so a service worker eviction
    // does not lose track of the active task before the debounce timer fires.
    try {
      await this.saveState();
    } catch (error) {
      Logger.warn('[TaskManager] Failed to persist running task state', { error });
    }
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

    if (task.status !== 'running') {
      Logger.debug(`[TaskManager] Ignoring progress update for ${task.status} task: ${taskId}`);
      return;
    }

    task.progress = Math.min(100, Math.max(0, progress));
    if (message) {
      task.message = message;
    }
    // Raw percent writes own the display; drop any stale detailed-progress
    // stage so the UI does not keep showing the previous stage's label.
    task.detailedProgress = undefined;
    Logger.debug(`[TaskManager] Task progress updated: ${taskId}`, {
      progress: task.progress,
      message,
    });
    this.notifyTaskUpdate(task);

    this.schedulePersist();
  }

  /**
   * Update task with detailed progress information
   * @param taskId - ID of the task
   * @param detailedProgress - Detailed progress update
   */
  updateDetailedProgress(taskId: string, detailedProgress: DetailedProgressUpdate): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      Logger.warn(`[TaskManager] Task not found: ${taskId}`);
      return;
    }

    if (task.status !== 'running') {
      Logger.debug(
        `[TaskManager] Ignoring detailed progress update for ${task.status} task: ${taskId}`,
      );
      return;
    }

    // Calculate estimated time remaining based on progress rate
    const elapsed = Date.now() - task.startTime;
    const { stage, current, total, stageMessage, stageMessageKey, stageMessageParams } =
      detailedProgress;
    const previousStage = task.detailedProgress?.stage;
    const stageChanged = previousStage !== undefined && previousStage !== stage;

    const { progressPercent, estimatedTimeRemaining } = TaskProgressCalculator.calculate({
      taskType: task.type,
      stage,
      current,
      total,
      elapsed,
    });

    // Update task. Progress is monotonic within a task run: stage ranges can
    // overlap across phases, so never let a computed value move backwards.
    task.progress = Math.max(task.progress, progressPercent);
    task.message = `${stage}:${current}:${total}`;
    task.detailedProgress = {
      stage,
      current,
      total,
      estimatedTimeRemaining,
      stageMessage,
      stageMessageKey,
      stageMessageParams,
    };

    Logger.debug(`[TaskManager] Detailed progress updated: ${taskId}`, {
      stage,
      current,
      total,
      progressPercent: task.progress,
      estimatedTimeRemaining,
    });

    // Stage transitions are user-visible milestones — flush them immediately
    // and persist synchronously so a SW eviction does not lose the new stage.
    this.notifyTaskUpdate(task, { immediate: stageChanged });
    if (stageChanged) {
      this.saveState().catch((error) => {
        Logger.warn('[TaskManager] Failed to persist task state on stage change', { error });
      });
    } else {
      this.schedulePersist();
    }
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

    if (task.status !== 'running') {
      Logger.warn(`[TaskManager] Cannot complete task ${taskId} in ${task.status} state`);
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

    const notificationTitle = result?.title?.trim() || task.url;
    this.notificationService.showTaskCompleted(task.type, notificationTitle, result?.commentsCount);

    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
    }
    this.notifyTaskUpdate(task, { immediate: true });
    this.autoCleanFinishedTasks();
    this.saveState().catch((error) => {
      Logger.warn('[TaskManager] Failed to persist completed task state', { error });
    });
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

    if (task.status === 'completed' || task.status === 'failed') {
      Logger.warn(`[TaskManager] Cannot fail task ${taskId} in ${task.status} state`);
      return;
    }

    this.clearAbortController(taskId);

    task.status = 'failed';
    task.error = error;
    task.endTime = Date.now();

    Logger.error(`[TaskManager] Task failed: ${taskId}: ${error}`);

    this.notificationService.showTaskFailed(task.type, error);

    if (this.currentTaskId === taskId) {
      this.currentTaskId = null;
    }
    this.notifyTaskUpdate(task, { immediate: true });
    this.autoCleanFinishedTasks();
    this.saveState().catch((err) => {
      Logger.warn('[TaskManager] Failed to persist failed task state', { error: err });
    });
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

    // An ordinary executor still owns cleanup until its finally runs. A
    // completion recovered after restart has no such chain to release its slot.
    if (this.currentTaskId === taskId && this.executingTaskId !== taskId) {
      this.currentTaskId = null;
    }
    this.executors.delete(taskId);

    this.abortTask(taskId);

    this.clearAbortController(taskId);

    task.status = 'failed';
    task.error = i18n.t(ERROR_KEYS.TASK_CANCELLED_BY_USER);
    task.endTime = Date.now();

    Logger.info(`[TaskManager] Task cancelled: ${taskId}`);
    this.notifyTaskUpdate(task, { immediate: true });
    this.autoCleanFinishedTasks();
    this.saveState().catch((error) => {
      Logger.warn('[TaskManager] Failed to persist cancelled task state', { error });
    });
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

  recoverInterruptedTask(
    taskId: string,
    options: RecoverInterruptedTaskOptions = {},
  ): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) {
      Logger.warn(`[TaskManager] Task not found: ${taskId}`);
      return undefined;
    }

    // Newer persisted tasks carry the language-independent interruptedByRestart
    // flag; the localized-error comparison only stays as a legacy fallback for
    // state written before the flag existed.
    const interruptedMessage = i18n.t(ERROR_KEYS.TASK_INTERRUPTED_BY_RESTART);
    const tabMatchesSender =
      typeof options.senderTabId !== 'number' ||
      typeof task.tabId !== 'number' ||
      task.tabId === options.senderTabId;
    const taskTypeMatches = !options.taskType || task.type === options.taskType;
    const withinRecoveryWindow =
      typeof options.maxAgeMs !== 'number' ||
      typeof task.endTime !== 'number' ||
      Date.now() - task.endTime <= options.maxAgeMs;
    const canRecoverFromInterruption =
      task.status === 'failed' &&
      (task.interruptedByRestart === true || task.error === interruptedMessage) &&
      tabMatchesSender &&
      taskTypeMatches &&
      withinRecoveryWindow;

    if (task.status === 'running') {
      return task;
    }

    if (task.status === 'pending' || canRecoverFromInterruption) {
      task.status = 'running';
      task.error = undefined;
      task.message = undefined;
      task.interruptedByRestart = undefined;
      task.endTime = undefined;
      // A late completion can coexist with a newer active executor. It owns a
      // cancellation signal, but may only claim the running slot when it is free.
      if (!this.abortControllers.has(taskId)) {
        this.registerAbortController(taskId, new AbortController());
      }
      if (this.currentTaskId === null && this.executingTaskId === null) {
        this.currentTaskId = taskId;
      }
      this.queue = this.queue.filter((id) => id !== taskId);
      this.notifyTaskUpdate(task, { immediate: true });
      // Recovery is itself a key transition; persist immediately so the next
      // service worker eviction does not roll back to "interrupted" state.
      this.saveState().catch((error) => {
        Logger.warn('[TaskManager] Failed to persist recovered task state', { error });
      });
      Logger.info(`[TaskManager] Recovered interrupted task: ${taskId}`);
      return task;
    }

    Logger.warn(`[TaskManager] Cannot recover task ${taskId} in ${task.status} state`);
    return undefined;
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

  private autoCleanFinishedTasks(): void {
    const finishedTasks = this.getAllTasks().filter(
      (task) => task.status === 'completed' || task.status === 'failed',
    );

    if (finishedTasks.length <= TASK.MAX_FINISHED_TASKS) {
      return;
    }

    const sorted = finishedTasks.sort((a, b) => (a.endTime || 0) - (b.endTime || 0));
    const toRemove = sorted.slice(0, finishedTasks.length - TASK.MAX_FINISHED_TASKS);

    for (const task of toRemove) {
      this.tasks.delete(task.id);
      this.executors.delete(task.id);
      this.abortControllers.delete(task.id);
    }

    Logger.info(`[TaskManager] Auto-cleaned ${toRemove.length} old finished tasks`);
  }

  /**
   * Generate a unique task ID
   * @returns Unique task ID
   */
  private generateTaskId(): string {
    if (typeof crypto.randomUUID === 'function') {
      return `task_${crypto.randomUUID()}`;
    }

    const bytes = crypto.getRandomValues(new Uint8Array(LIMITS.ID_RANDOM_BYTE_LENGTH));
    const suffix = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(LIMITS.HEX_BYTE_PAD_LENGTH, '0'),
    ).join('');
    return `task_${Date.now()}_${suffix}`;
  }

  /**
   * Process the task queue
   */
  private processQueue(): void {
    if (this.executingTaskId !== null || this.currentTaskId !== null || this.queue.length === 0) {
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

    this.executingTaskId = nextTaskId;
    // Cancellation must own the signal before persistence can yield.
    const controller = new AbortController();
    this.registerAbortController(nextTaskId, controller);
    this.startTask(nextTaskId)
      .then(async () => {
        const task = this.tasks.get(nextTaskId);
        if (!task || task.status !== 'running' || controller.signal.aborted) {
          return;
        }

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
          Logger.debug(`[TaskManager] Executor failed for task ${nextTaskId}`, { error });
          const messageKey =
            error instanceof ExtensionError ? error.details?.messageKey : undefined;
          this.failTask(
            nextTaskId,
            typeof messageKey === 'string' && i18n.exists(messageKey)
              ? i18n.t(messageKey)
              : error instanceof Error
                ? error.message
                : String(error),
          );
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        Logger.error(`[TaskManager] Failed to start task ${nextTaskId}: ${message}`);
        this.failTask(nextTaskId, message);
      })
      .finally(() => {
        this.executors.delete(nextTaskId);
        this.clearAbortController(nextTaskId);
        if (this.currentTaskId === nextTaskId) {
          this.currentTaskId = null;
        }
        if (this.executingTaskId === nextTaskId) {
          this.executingTaskId = null;
        }
        this.processQueue();
      });
  }

  private schedulePersist(): void {
    this.persistence.schedule();
  }

  private saveState(): Promise<void> {
    return this.persistence.save();
  }

  /**
   * Notify listeners about task updates
   * @param task - Updated task
   */
  private notifyTaskUpdate(task: Task, options: { immediate?: boolean } = {}): void {
    const taskId = task.id;
    if (options.immediate) {
      this.pendingTaskUpdates.delete(taskId);
      this.flushTaskUpdate(task);
      return;
    }

    this.pendingTaskUpdates.set(taskId, task);
    if (this.taskUpdateThrottleTimer) {
      return;
    }

    this.taskUpdateThrottleTimer = setTimeout(() => {
      this.taskUpdateThrottleTimer = null;
      const buffered = Array.from(this.pendingTaskUpdates.values());
      this.pendingTaskUpdates.clear();
      for (const buffered_task of buffered) {
        this.flushTaskUpdate(buffered_task);
      }
    }, TIMING.TASK_UPDATE_NOTIFY_THROTTLE_MS);
  }

  private flushTaskUpdate(task: Task): void {
    chrome.runtime
      .sendMessage({
        type: MESSAGES.TASK_UPDATE,
        payload: task,
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes(CHROME_MESSAGE_ERRORS.PORT_CLOSED) ||
          message.includes(CHROME_MESSAGE_ERRORS.RECEIVING_END_MISSING)
        ) {
          Logger.debug('[TaskManager] Task update listener unavailable', {
            taskId: task.id,
            error: message,
          });
          return;
        }
        Logger.warn('[TaskManager] Failed to notify task update', {
          taskId: task.id,
          error: message,
        });
      });
  }
}
