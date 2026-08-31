import { Message, Task } from '@/types';
import { HandlerContext } from './types';
import { Logger } from '@/utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import {
  MESSAGES,
  EXTRACTION_DEFAULTS,
  DATE_TIME,
  ANALYSIS_FORMAT,
  TIMEOUT,
  TEXT,
} from '@/config/constants';
import { getDomain } from '@/utils/url';
import { generateUniqueId } from '@/utils/id-generator';
import { ensureContentScriptInjected } from '../ContentScriptInjector';
import { resolveTabId } from '@/utils/chrome-message';
import {
  isExpectedAsyncAckError,
  resolveRunningCompletionTask,
  waitForTaskCompletion,
} from './utils/task-completion';

interface StartExtractionResponse {
  taskId: string;
}

interface ProgressResponse {
  success: boolean;
}

interface ExtractionCompletionResponse {
  success: boolean;
}

export async function handleStartExtraction(
  message: Extract<Message, { type: 'START_EXTRACTION' }>,
  context: HandlerContext,
): Promise<StartExtractionResponse> {
  const { url, maxComments, tabId: payloadTabId } = message.payload || {};

  if (!url) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'URL is required');
  }

  const domain = getDomain(url) || TEXT.UNKNOWN;

  let finalMaxComments = maxComments;
  if (!finalMaxComments) {
    const settings = await context.settingsStore.getSettings();
    finalMaxComments = settings.maxComments || EXTRACTION_DEFAULTS.MAX_COMMENTS;
  }

  const tabId = await resolveTabId(payloadTabId, context.sender?.tab?.id);
  if (!tabId) {
    throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, 'No tab ID available');
  }

  Logger.info('[ExtractionHandler] Starting extraction with maxComments', {
    maxComments: finalMaxComments,
  });

  const taskId = context.taskManager.createTask('extract', url, domain, finalMaxComments, tabId);

  context.taskManager.setExecutor(taskId, async (task: Task, signal: AbortSignal) => {
    if (!task.tabId) {
      throw new ExtensionError(ErrorCode.EXTRACTION_FAILED, 'No tab ID available');
    }

    await ensureContentScriptInjected(task.tabId);

    // Send start message to content script (fire and forget from executor perspective).
    // The content script acks immediately then reports completion later.
    try {
      await chrome.tabs.sendMessage(task.tabId, {
        type: MESSAGES.RUN_EXTRACTION,
        payload: { taskId: task.id, maxComments: finalMaxComments },
      });
    } catch (error) {
      if (!isExpectedAsyncAckError(error)) {
        throw error;
      }
      Logger.debug('[ExtractionHandler] Message ack timeout ignored, waiting for completion');
    }

    return waitForTaskCompletion({
      taskId,
      signal,
      context,
      tabId: task.tabId!,
      timeoutMs: TIMEOUT.EXTRACTION_TASK_COMPLETION_MS,
      timeoutMessage: TEXT.EXTRACTION_TASK_TIMEOUT,
      tabClosedMessage: TEXT.TASK_SOURCE_TAB_CLOSED,
      cancelWarnLabel: '[ExtractionHandler] Failed to send cancel to content script',
      timeoutWarnLabel: '[ExtractionHandler] Failed to send timeout cancel to content script',
    });
  });

  return { taskId };
}

export async function handleExtractionCompleted(
  message: Extract<Message, { type: 'EXTRACTION_COMPLETED' }>,
  context: HandlerContext,
): Promise<ExtractionCompletionResponse> {
  const payload = message.payload;
  if (!payload?.taskId) {
    Logger.warn('[ExtractionHandler] Invalid extraction completion payload', {
      payload,
    });
    return { success: false };
  }
  const { taskId, success, comments, postInfo, error } = payload;
  const task = resolveRunningCompletionTask(taskId, context, 'extraction');

  if (!task) {
    return { success: false };
  }
  const taskSignal = context.taskManager.getAbortSignal?.(taskId);

  if (success) {
    const rawComments = comments || [];
    let normalizedComments = rawComments;
    let normalizedPostTime = postInfo?.videoTime;
    try {
      const settings = await context.settingsStore.getSettings();
      if (settings.normalizeTimestamps && rawComments.length > 0) {
        const totalCount = rawComments.length + (postInfo?.videoTime ? 1 : 0);
        context.taskManager.updateDetailedProgress(taskId, {
          stage: 'normalizing',
          current: 0,
          total: totalCount,
        });
        const pad = (value: number) => value.toString().padStart(DATE_TIME.PAD_LENGTH, '0');
        const now = new Date();
        const referenceTime = `${now.getFullYear()}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${pad(
          now.getMonth() + DATE_TIME.MONTH_OFFSET,
        )}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${pad(now.getDate())}T${pad(
          now.getHours(),
        )}${DATE_TIME.DISPLAY_TIME_SEPARATOR}${pad(now.getMinutes())}`;
        normalizedComments = await context.timestampNormalizer.normalizeCommentTimestamps(
          rawComments,
          settings.aiModel,
          referenceTime,
          settings.aiTimeout,
          taskSignal,
        );
        normalizedPostTime = await context.timestampNormalizer.normalizeSingleTimestamp(
          postInfo?.videoTime,
          settings.aiModel,
          referenceTime,
          settings.aiTimeout,
          taskSignal,
        );
        context.taskManager.updateDetailedProgress(taskId, {
          stage: 'normalizing',
          current: totalCount,
          total: totalCount,
        });
      }
    } catch (normalizationError) {
      if (taskSignal?.aborted) {
        return { success: false };
      }
      Logger.warn('[ExtractionHandler] Timestamp normalization failed', {
        error: normalizationError,
      });
    }

    if (taskSignal?.aborted || task.status !== 'running') {
      return { success: false };
    }

    const historyItem = {
      id: generateUniqueId('history'),
      url: postInfo?.url || task.url,
      title: postInfo?.title || TEXT.UNTITLED,
      platform: task.platform || ANALYSIS_FORMAT.UNKNOWN_PLATFORM,
      videoTime: normalizedPostTime,
      postContent: postInfo?.postContent,
      extractedAt: Date.now(),
      commentsCount: normalizedComments.length,
      comments: normalizedComments,
    };
    try {
      await context.historyStore.createHistory(historyItem);
    } catch (saveError) {
      Logger.error('[ExtractionHandler] Failed to save extraction history', { saveError });
      const historyError = new ExtensionError(
        ErrorCode.STORAGE_WRITE_ERROR,
        'Failed to save extraction history',
      );
      context.taskManager.failTask(taskId, historyError.message);
      return { success: false };
    }

    context.taskManager.completeTask(taskId, {
      tokensUsed: 0,
      commentsCount: normalizedComments.length,
      title: postInfo?.title || postInfo?.url,
    });
  } else {
    context.taskManager.failTask(taskId, error || 'Extraction failed');
  }

  return { success: true };
}

export async function handleExtractionProgress(
  message: Extract<Message, { type: 'EXTRACTION_PROGRESS' }>,
  context: HandlerContext,
): Promise<ProgressResponse> {
  const {
    taskId,
    progress,
    message: progressMessage,
    stage,
    current,
    total,
  } = message.payload || {};

  if (taskId) {
    if (stage && current !== undefined && total !== undefined) {
      context.taskManager.updateDetailedProgress(taskId, {
        stage,
        current,
        total,
        stageMessage: progressMessage,
      });
    } else if (typeof progress === 'number') {
      context.taskManager.updateTaskProgress(taskId, progress, progressMessage || '');
    } else {
      Logger.warn('[ExtractionHandler] Invalid progress payload', { payload: message.payload });
      return { success: false };
    }
  }

  return { success: true };
}
