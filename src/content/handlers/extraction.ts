import { MESSAGES, TEXT } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { getCurrentHostname } from '@/utils/url';
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
  const type =
    taskType === 'config' ? MESSAGES.CONFIG_GENERATION_COMPLETED : MESSAGES.EXTRACTION_COMPLETED;
  chrome.runtime
    .sendMessage({
      type,
      payload: {
        taskId,
        success: false,
        error,
      },
    })
    .catch((e) => {
      Logger.debug('[Content] send message failed', { error: e });
    });
}

export interface ExtractionOutcome {
  success: boolean;
  comments?: unknown[];
  error?: string;
}

export async function handleStartExtraction(
  data: { taskId: string; maxComments: number },
  sendResponse: (response: ExtractionResponse) => void,
  onComplete?: (outcome: ExtractionOutcome) => void,
): Promise<void> {
  // 1. Immediately acknowledge receipt to prevent message timeout
  sendResponse({ success: true });

  const { taskId, maxComments } = data;

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
        chrome.runtime.sendMessage({
          type: MESSAGES.EXTRACTION_PROGRESS,
          payload: { taskId, progress, message, stage, current, total },
        });
      },
      controller.signal,
    );

    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Extraction cancelled');
      onComplete?.({ success: false, error: 'cancelled' });
      return;
    }

    const postInfo = await getPostInfo();

    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Extraction cancelled before completion');
      onComplete?.({ success: false, error: 'cancelled' });
      return;
    }

    await chrome.runtime.sendMessage({
      type: MESSAGES.EXTRACTION_COMPLETED,
      payload: {
        taskId,
        success: true,
        comments,
        postInfo,
      },
    });

    Logger.info('[Content] Extraction complete', { count: comments.length });
    onComplete?.({ success: true, comments });
  } catch (error) {
    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Extraction cancelled', { taskId });
      onComplete?.({ success: false, error: 'cancelled' });
      return;
    }

    Logger.error('[Content] Extraction failed', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await chrome.runtime.sendMessage({
      type: MESSAGES.EXTRACTION_COMPLETED,
      payload: {
        taskId,
        success: false,
        error: errorMessage,
      },
    });
    onComplete?.({ success: false, error: errorMessage });
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
