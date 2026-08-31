import { Task } from '@/types';
import { Logger } from '@/utils/logger';
import { ErrorHandler } from '@/utils/errors';
import { ERROR_KEYS, RETRY, STORAGE, TIMING } from '@/config/constants';
import i18n from '@/utils/i18n';
import { Mutex } from '@/utils/promise';
import { sanitizePersistedTaskState } from '@/utils/storage-validation';

export interface PersistedTaskState {
  tasks: Task[];
  queue: string[];
  currentTaskId: string | null;
  savedAt: number;
}

export interface PersistenceSnapshot {
  tasks: Task[];
  queue: string[];
  currentTaskId: string | null;
}

export class TaskPersistence {
  private readonly enabled: boolean;
  private readonly stateMutex = new Mutex();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly getSnapshot: () => PersistenceSnapshot;

  constructor(config: { enabled: boolean; getSnapshot: () => PersistenceSnapshot }) {
    this.enabled = config.enabled;
    this.getSnapshot = config.getSnapshot;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async load(): Promise<PersistedTaskState | null> {
    if (!this.enabled) {
      return null;
    }
    try {
      const result = await chrome.storage.local.get(STORAGE.TASK_STATE_KEY);
      const state = sanitizePersistedTaskState(result[STORAGE.TASK_STATE_KEY]);
      if (!state) {
        return null;
      }
      return {
        tasks: state.tasks,
        queue: state.queue,
        currentTaskId: state.currentTaskId,
        savedAt: state.savedAt,
      };
    } catch (error) {
      Logger.warn('[TaskPersistence] Failed to load task state', { error });
      throw error;
    }
  }

  markInterruptedByRestart(task: Task, interruptedAt: number): void {
    task.status = 'failed';
    task.error = i18n.t(ERROR_KEYS.TASK_INTERRUPTED_BY_RESTART);
    task.message = task.error;
    // Language-independent marker so recovery never depends on the localized
    // error text staying identical across service worker restarts.
    task.interruptedByRestart = true;
    task.detailedProgress = undefined;
    task.endTime = interruptedAt;
  }

  schedule(): void {
    if (!this.enabled) {
      return;
    }
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.save().catch((error) => {
        Logger.warn('[TaskPersistence] Failed to persist task state', { error });
      });
    }, TIMING.TASK_STATE_PERSIST_DEBOUNCE_MS);
  }

  async save(): Promise<void> {
    if (!this.enabled) {
      return;
    }
    return this.stateMutex.withLock(async () => {
      try {
        await ErrorHandler.withRetry(
          async () => {
            const snapshot = this.getSnapshot();
            const state: PersistedTaskState = {
              tasks: snapshot.tasks,
              queue: snapshot.queue,
              currentTaskId: snapshot.currentTaskId,
              savedAt: Date.now(),
            };
            await chrome.storage.local.set({ [STORAGE.TASK_STATE_KEY]: state });
          },
          'TaskPersistence.save',
          {
            maxAttempts: RETRY.MAX_ATTEMPTS,
            initialDelay: RETRY.INITIAL_DELAY_MS,
            maxDelay: RETRY.MAX_DELAY_MS,
          },
        );
      } catch (error) {
        Logger.warn('[TaskPersistence] Failed to persist task state', { error });
        throw error;
      }
    });
  }
}
