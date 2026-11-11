import { ContentMessage, Task } from '@/types';
import { Logger } from '@/utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { CHROME_MESSAGE_ERRORS, MESSAGES, TIMEOUT, TIMING, TEXT } from '@/config/constants';
import { requireMessageSuccess } from '@/utils/message-response';
import { isSameSourcePage, sourcePageChangedError } from '@/utils/source-page';
import { ensureContentScriptInjected } from '../../ContentScriptInjector';
import type { HandlerContext } from '../types';

export function createAnalysisDeadline(parentSignal: AbortSignal) {
  const wallClock = new AbortController();
  const timer = setTimeout(() => wallClock.abort(), TIMEOUT.ANALYSIS_TASK_COMPLETION_MS);
  return {
    signal: AbortSignal.any([parentSignal, wallClock.signal]),
    dispose: () => clearTimeout(timer),
    rethrow(error: unknown): never {
      if (wallClock.signal.aborted && !parentSignal.aborted) {
        throw new ExtensionError(ErrorCode.TIMEOUT_ERROR, TEXT.ANALYSIS_TASK_TIMEOUT);
      }
      throw error;
    },
  };
}

export type PendingTaskResult = {
  tokensUsed: number;
  commentsCount: number;
  title?: string;
};

interface WaitForTaskCompletionOptions {
  taskId: string;
  signal: AbortSignal;
  context: HandlerContext;
  tabId: number;
  sourceDocumentId: string;
  sourceUrl: string;
  timeoutMs: number;
  timeoutMessage: string;
  tabClosedMessage: string;
  cancelWarnLabel: string;
  timeoutWarnLabel: string;
}

function notifyCancelExtraction(
  tabId: number,
  documentId: string,
  taskId: string,
  contextLabel: string,
): void {
  chrome.tabs
    .sendMessage(tabId, { type: MESSAGES.CANCEL_EXTRACTION, payload: { taskId } }, { documentId })
    .catch((err) => {
      Logger.warn(contextLabel, { err });
    });
}

function isExpectedAsyncAckError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes(CHROME_MESSAGE_ERRORS.TIMEOUT) ||
    message.includes(CHROME_MESSAGE_ERRORS.PORT_CLOSED)
  );
}

export function isTaskSource(
  task: Task,
  sender: chrome.runtime.MessageSender | undefined,
): boolean {
  if (task.tabId === undefined) return true;
  return (
    sender?.tab?.id === task.tabId &&
    (sender.frameId === undefined || sender.frameId === 0) &&
    (sender.documentLifecycle === undefined || sender.documentLifecycle === 'active') &&
    (!task.sourceDocumentId || sender.documentId === task.sourceDocumentId) &&
    isSameSourcePage(sender.url, task.url)
  );
}

type RunMessage = Extract<ContentMessage, { type: 'RUN_EXTRACTION' | 'RUN_CONFIG_GENERATION' }>;

export async function runSourceTask(
  task: Task,
  signal: AbortSignal,
  context: HandlerContext,
  message: RunMessage,
  options: Pick<
    WaitForTaskCompletionOptions,
    'timeoutMs' | 'timeoutMessage' | 'tabClosedMessage' | 'cancelWarnLabel' | 'timeoutWarnLabel'
  >,
): Promise<PendingTaskResult> {
  const { tabId, url } = task;
  if (!tabId) {
    throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, 'No tab ID available');
  }
  const tab = await chrome.tabs.get(tabId);
  if (
    !isSameSourcePage(tab.url, url) ||
    (tab.pendingUrl && !isSameSourcePage(tab.pendingUrl, url))
  ) {
    throw sourcePageChangedError();
  }
  signal.throwIfAborted();
  const [source] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: () => window.location.href,
  });
  if (!source?.documentId || !isSameSourcePage(source.result, url)) {
    throw sourcePageChangedError();
  }
  const documentId = source.documentId;
  signal.throwIfAborted();
  await context.taskManager.bindSourceDocument(task, documentId);
  return waitForTaskCompletion(
    {
      ...options,
      taskId: task.id,
      signal,
      context,
      tabId,
      sourceDocumentId: documentId,
      sourceUrl: url,
    },
    async () => {
      await ensureContentScriptInjected(tabId, documentId);
      signal.throwIfAborted();
      let response: unknown;
      try {
        response = await chrome.tabs.sendMessage(tabId, message, { documentId });
      } catch (error) {
        if (!isExpectedAsyncAckError(error)) throw error;
        Logger.debug('[TaskCompletion] Message ack interrupted, waiting for completion');
        return;
      }
      requireMessageSuccess(response, sourcePageChangedError());
    },
  );
}

export function resolveRunningCompletionTask(
  taskId: string,
  context: HandlerContext,
  completionType: 'extraction' | 'config',
): Task | null {
  const task = context.taskManager.getTask(taskId);
  const expectedTaskType = completionType === 'config' ? 'config' : 'extract';
  if (!task || task.type !== expectedTaskType || !isTaskSource(task, context.sender)) {
    return null;
  }
  if (task.status === 'running') {
    return task;
  }

  const senderTabId = context.sender?.tab?.id;
  const maxAgeMs =
    completionType === 'config'
      ? TIMEOUT.CONFIG_TASK_COMPLETION_MS
      : TIMEOUT.EXTRACTION_TASK_COMPLETION_MS;
  const recoveredTask = context.taskManager.recoverInterruptedTask(taskId, {
    taskType: expectedTaskType,
    senderTabId,
    maxAgeMs,
  });
  if (recoveredTask?.status === 'running') {
    return recoveredTask;
  }

  Logger.warn(`[ExtractionHandler] Ignoring stale ${completionType} completion`, {
    taskId,
    status: task.status,
    recoveredStatus: recoveredTask?.status,
  });
  return null;
}

function waitForTaskCompletion(
  {
    taskId,
    signal,
    context,
    tabId,
    sourceDocumentId,
    sourceUrl,
    timeoutMs,
    timeoutMessage,
    tabClosedMessage,
    cancelWarnLabel,
    timeoutWarnLabel,
  }: WaitForTaskCompletionOptions,
  dispatch: () => Promise<void>,
): Promise<PendingTaskResult> {
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
      chrome.tabs.onUpdated?.removeListener(onTabUpdated);
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

    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = (): void => {
      notifyCancelExtraction(tabId, sourceDocumentId, taskId, cancelWarnLabel);
      settleReject(new ExtensionError(ErrorCode.TASK_CANCELLED, 'Task cancelled by user'));
    };

    const onTabRemoved = (removedTabId: number): void => {
      if (removedTabId !== tabId) {
        return;
      }

      settleReject(
        new ExtensionError(ErrorCode.EXTRACTION_FAILED, tabClosedMessage, { taskId, tabId }, false),
      );
      context.taskManager.abortTask(taskId);
    };

    const onTabUpdated = (updatedTabId: number, change: chrome.tabs.OnUpdatedInfo): void => {
      if (
        updatedTabId !== tabId ||
        (change.status !== 'loading' && (!change.url || isSameSourcePage(change.url, sourceUrl)))
      ) {
        return;
      }
      settleReject(sourcePageChangedError());
      context.taskManager.abortTask(taskId);
      notifyCancelExtraction(tabId, sourceDocumentId, taskId, cancelWarnLabel);
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
      notifyCancelExtraction(tabId, sourceDocumentId, taskId, timeoutWarnLabel);
      settleReject(new ExtensionError(ErrorCode.TIMEOUT_ERROR, timeoutMessage));
      context.taskManager.abortTask(taskId);
    }, timeoutMs);

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort);
    chrome.tabs.onRemoved?.addListener(onTabRemoved);
    chrome.tabs.onUpdated?.addListener(onTabUpdated);
    pollTaskStatus();
    if (!settled) void dispatch().catch(settleReject);
  });
}
