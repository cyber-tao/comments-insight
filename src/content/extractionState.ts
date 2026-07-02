import { TIMEOUT } from '@/config/constants';

const SAFETY_TIMEOUT_MS =
  TIMEOUT.EXTRACTION_TASK_COMPLETION_MS + TIMEOUT.EXTRACTION_SAFETY_MARGIN_MS;

type ContentTaskType = 'extract' | 'config';

export interface SupersededContentTask {
  taskId: string;
  taskType: ContentTaskType;
}

export interface BeginTaskResult {
  controller: AbortController;
  supersededTask?: SupersededContentTask;
}

class ExtractionStateManager {
  private active = false;
  private activeTaskId: string | null = null;
  private activeTaskType: ContentTaskType | null = null;
  private abortController: AbortController | null = null;
  private safetyTimer: ReturnType<typeof setTimeout> | null = null;

  beginTask(taskId: string, taskType: ContentTaskType): BeginTaskResult {
    let supersededTask: SupersededContentTask | undefined;
    if (this.abortController && this.activeTaskId !== taskId) {
      supersededTask = {
        taskId: this.activeTaskId!,
        taskType: this.activeTaskType || 'extract',
      };
      this.abortController.abort();
    }

    const controller = new AbortController();
    this.active = true;
    this.activeTaskId = taskId;
    this.activeTaskType = taskType;
    this.abortController = controller;

    this.clearSafetyTimer();
    this.safetyTimer = setTimeout(() => {
      this.active = false;
      this.activeTaskId = null;
      this.activeTaskType = null;
      this.abortController = null;
      this.safetyTimer = null;
    }, SAFETY_TIMEOUT_MS);

    return { controller, supersededTask };
  }

  isCurrentTask(taskId: string, controller: AbortController): boolean {
    return (
      this.activeTaskId === taskId &&
      this.abortController === controller &&
      !controller.signal.aborted
    );
  }

  finishTask(taskId: string, controller: AbortController): void {
    if (this.activeTaskId !== taskId || this.abortController !== controller) {
      return;
    }

    this.clearSafetyTimer();
    this.active = false;
    this.activeTaskId = null;
    this.activeTaskType = null;
    this.abortController = null;
  }

  cancelCurrentTask(): { taskId: string; taskType: ContentTaskType } | null {
    if (!this.activeTaskId) {
      return null;
    }

    const taskId = this.activeTaskId;
    const taskType = this.activeTaskType || 'extract';
    this.abortController?.abort();
    this.clearSafetyTimer();
    this.active = false;
    this.activeTaskId = null;
    this.activeTaskType = null;
    this.abortController = null;
    return { taskId, taskType };
  }

  cancelTaskById(taskId: string): { taskId: string; taskType: ContentTaskType } | null {
    if (this.activeTaskId !== taskId) {
      return null;
    }
    return this.cancelCurrentTask();
  }

  isActive(taskId?: string): boolean {
    return this.active && (!taskId || this.activeTaskId === taskId);
  }

  getActiveTaskId(): string | null {
    return this.activeTaskId;
  }

  reset(): void {
    this.clearSafetyTimer();
    this.active = false;
    this.activeTaskId = null;
    this.activeTaskType = null;
    this.abortController = null;
  }

  private clearSafetyTimer(): void {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
  }
}

const globalExtractionState = new ExtractionStateManager();

export function setExtractionActive(next: boolean, taskId?: string): void {
  if (next && taskId) {
    globalExtractionState.beginTask(taskId, 'extract');
  } else if (!next) {
    if (taskId && globalExtractionState.getActiveTaskId() !== taskId) {
      return;
    }
    globalExtractionState.reset();
  }
}

export function isExtractionActive(taskId?: string): boolean {
  return globalExtractionState.isActive(taskId);
}

export function getActiveExtractionTaskId(): string | null {
  return globalExtractionState.getActiveTaskId();
}

export function resetExtractionState(): void {
  globalExtractionState.reset();
}

export { ExtractionStateManager, globalExtractionState };
