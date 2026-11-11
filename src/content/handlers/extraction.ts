import { MESSAGES, TEXT } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { getCurrentHostname } from '@/utils/url';
import { requireMessageSuccess } from '@/utils/message-response';
import { ErrorCode, ExtensionError, toExtensionErrorPayload } from '@/utils/error-types';
import { checkSourcePage, isSameSourcePage, sourcePageChangedError } from '@/utils/source-page';
import { isWithinValidationBudget } from '@/utils/validation-budget';
import { globalExtractionState } from '../extractionState';
import { ExtractionResponse } from '@/types/messages';
import { ProgressStage } from '@/types';
import { getTools } from './tools';
import { getPostInfo } from './dom';

export function sendCancelledCompletion(
  taskId: string,
  taskType: 'extract' | 'config',
  error: string = TEXT.EXTRACTION_CANCELLED_BY_USER,
): void {
  void sendTaskFailure(taskId, taskType, error);
}

export async function sendTaskFailure(
  taskId: string,
  taskType: 'extract' | 'config',
  failure: unknown,
): Promise<void> {
  const error = typeof failure === 'string' ? failure : taskFailureMessage(failure);
  const errorKey =
    failure instanceof ExtensionError
      ? (failure.details?.messageKey ??
        (failure.code === ErrorCode.STORAGE_WRITE_ERROR ? 'errors.storageWriteError' : undefined))
      : undefined;
  const type =
    taskType === 'config' ? MESSAGES.CONFIG_GENERATION_COMPLETED : MESSAGES.EXTRACTION_COMPLETED;
  await chrome.runtime
    .sendMessage({
      type,
      payload: {
        taskId,
        success: false,
        error,
        ...(typeof errorKey === 'string' ? { errorKey } : {}),
      },
    })
    .catch((e) => {
      Logger.debug('[Content] send message failed', { error: e });
    });
}

function taskFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export interface ExtractionOutcome {
  success: boolean;
  comments?: unknown[];
  error?: string;
}

export async function handleStartExtraction(
  data: { taskId: string; maxComments: number; expectedUrl?: string },
  sendResponse: (response: ExtractionResponse) => void,
  onComplete?: (outcome: ExtractionOutcome) => void,
): Promise<void> {
  const { taskId, maxComments, expectedUrl } = data;
  if (expectedUrl && !isSameSourcePage(window.location.href, expectedUrl)) {
    sendResponse({ success: false, error: toExtensionErrorPayload(sourcePageChangedError()) });
    return;
  }
  sendResponse({ success: true });

  Logger.info('[Content] Starting extraction', { taskId });

  const { controller, supersededTask } = globalExtractionState.beginTask(taskId, 'extract');
  if (supersededTask) {
    sendCancelledCompletion(
      supersededTask.taskId,
      supersededTask.taskType,
      'Extraction superseded by a newer task',
    );
  }

  try {
    const { commentExtractor } = getTools();
    const comments = await commentExtractor.extractWithAI(
      maxComments,
      getCurrentHostname(),
      (
        progress: number,
        message: string,
        stage?: ProgressStage,
        current?: number,
        total?: number,
      ) => {
        if (!globalExtractionState.isCurrentTask(taskId, controller)) {
          return;
        }
        checkSourcePage(expectedUrl);
        void chrome.runtime
          .sendMessage({
            type: MESSAGES.EXTRACTION_PROGRESS,
            payload: { taskId, progress, message, stage, current, total },
          })
          .catch((error) =>
            Logger.debug('[Content] Failed to send extraction progress', { error }),
          );
      },
      controller.signal,
    );

    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Extraction cancelled');
      onComplete?.({ success: false, error: 'cancelled' });
      return;
    }

    checkSourcePage(expectedUrl);
    const postInfo = await getPostInfo();

    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Extraction cancelled before completion');
      onComplete?.({ success: false, error: 'cancelled' });
      return;
    }

    checkSourcePage(expectedUrl);
    const payload = { taskId, success: true, comments, postInfo };
    if (!isWithinValidationBudget(payload)) {
      throw new ExtensionError(
        ErrorCode.VALIDATION_ERROR,
        'The extracted comments and replies exceed the result limit. Reduce the number of comments and try again.',
        { messageKey: 'errors.extractionResultTooLarge' },
        false,
      );
    }
    const response: unknown = await chrome.runtime.sendMessage({
      type: MESSAGES.EXTRACTION_COMPLETED,
      payload,
    });
    requireMessageSuccess(
      response,
      new ExtensionError(
        ErrorCode.STORAGE_WRITE_ERROR,
        'Failed to save extraction history',
        { messageKey: 'errors.storageWriteError' },
        false,
      ),
    );

    Logger.info('[Content] Extraction complete', { count: comments.length });
    onComplete?.({ success: true, comments });
  } catch (error) {
    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Extraction cancelled', { taskId });
      onComplete?.({ success: false, error: 'cancelled' });
      return;
    }

    Logger.error('[Content] Extraction failed', { error });
    await sendTaskFailure(taskId, 'extract', error);
    onComplete?.({ success: false, error: taskFailureMessage(error) });
  } finally {
    globalExtractionState.finishTask(taskId, controller);
  }
}

export function handleCancelExtraction(taskId: string): void {
  const cancelled = globalExtractionState.cancelTaskById(taskId);
  if (cancelled) {
    Logger.info('[Content] Cancelling extraction', { taskId });
    sendCancelledCompletion(cancelled.taskId, cancelled.taskType);
  }
}
