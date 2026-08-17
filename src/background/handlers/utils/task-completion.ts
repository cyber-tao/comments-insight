import { Task } from '@/types';
import { Logger } from '@/utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { CHROME_MESSAGE_ERRORS, MESSAGES, TIMEOUT, TIMING } from '@/config/constants';
import type { HandlerContext } from '../types';

export type PendingTaskResult = {
  tokensUsed: number;
  commentsCount: number;
  title?: string;
};

export interface WaitForTaskCompletionOptions {
  taskId: string;
  signal: AbortSignal;
  context: HandlerContext;
  tabId: number;
  timeoutMs: number;
  timeoutMessage: string;
  tabClosedMessage: string;
  cancelWarnLabel: string;
  timeoutWarnLabel: string;
}

export function notifyCancelExtraction(tabId: number, taskId: string, contextLabel: string): void {
  chrome.tabs
    .sendMessage(tabId, {
      type: MESSAGES.CANCEL_EXTRACTION,
      payload: { taskId },
    })
    .catch((err) => {
      Logger.warn(contextLabel, { err });
    });
}

export function isExpectedAsyncAckError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(CHROME_MESSAGE_ERRORS.TIMEOUT) ||
    message.includes(CHROME_MESSAGE_ERRORS.PORT_CLOSED)
  );
}

export function resolveRunningCompletionTask(
  taskId: string,
  context: HandlerContext,
  completionType: 'extraction' | 'config',
): Task | null {
  const task = context.taskManager.getTask(taskId);
  if (task?.status === 'running') {
    return task;
  }

  const senderTabId = context.sender?.tab?.id;
  const maxAgeMs =
    completionType === 'config'
      ? TIMEOUT.CONFIG_TASK_COMPLETION_MS
      : TIMEOUT.EXTRACTION_TASK_COMPLETION_MS;
  const recoveredTask = context.taskManager.recoverInterruptedTask(taskId, {
    taskType: completionType === 'config' ? 'config' : 'extract',
    senderTabId,
    maxAgeMs,
  });
  if (recoveredTask?.status === 'running') {
    return recoveredTask;
  }

  Logger.warn(`[ExtractionHandler] Ignoring stale ${completionType} completion`, {
    taskId,
    status: task?.status,
    recoveredStatus: recoveredTask?.status,
  });
  return null;
}

export function waitForTaskCompletion({
  taskId,
  signal,
  context,
  tabId,
  timeoutMs,
  timeoutMessage,
  tabClosedMessage,
  cancelWarnLabel,
  timeoutWarnLabel,
}: WaitForTaskCompletionOptions): Promise<PendingTaskResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let cleaned = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      signal.removeEventListener('abort', onAbort);
      chrome.tabs.onRemoved?.removeListener(onTabRemoved);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }
    };

    const settleResolve = (result: PendingTaskResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    const settleReject = (error: ExtensionError): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = (): void => {
      notifyCancelExtraction(tabId, taskId, cancelWarnLabel);
      settleReject(new ExtensionError(ErrorCode.TASK_CANCELLED, 'Task cancelled by user'));
    };

    const onTabRemoved = (removedTabId: number): void => {
      if (removedTabId !== tabId) {
        return;
      }

      settleReject(
        new ExtensionError(ErrorCode.EXTRACTION_FAILED, tabClosedMessage, { taskId, tabId }, false),
      );
    };

    const pollTaskStatus = (): void => {
      if (settled) {
        return;
      }

      const task = context.taskManager.getTask(taskId);
      if (!task) {
        settleReject(
          new ExtensionError(ErrorCode.TASK_NOT_FOUND, `Task not found: ${taskId}`, { taskId }),
        );
        return;
      }

      if (task.status === 'completed') {
        settleResolve({
          tokensUsed: task.tokensUsed,
          commentsCount: 0,
          title: task.url,
        });
        return;
      }

      if (task.status === 'failed') {
        settleReject(
          new ExtensionError(ErrorCode.EXTRACTION_FAILED, task.error || 'Task failed', { taskId }),
        );
        return;
      }

      pollTimeoutId = setTimeout(pollTaskStatus, TIMING.POLL_TASK_RUNNING_MS);
    };

    timeoutId = setTimeout(() => {
      notifyCancelExtraction(tabId, taskId, timeoutWarnLabel);
      settleReject(new ExtensionError(ErrorCode.TIMEOUT_ERROR, timeoutMessage));
    }, timeoutMs);

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort);
    chrome.tabs.onRemoved?.addListener(onTabRemoved);
    pollTaskStatus();
  });
}
