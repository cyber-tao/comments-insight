import { MESSAGES } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { globalExtractionState } from '../extractionState';
import { PageController } from '../PageController';
import { AIStrategy } from '../strategies/AIStrategy';
import { ConfigGenerationResponse } from '@/types/messages';
import { getTools } from './tools';
import { sendCancelledCompletion, sendTaskFailure } from './extraction';
import { ErrorCode, ExtensionError, toExtensionErrorPayload } from '@/utils/error-types';
import { checkSourcePage, isSameSourcePage, sourcePageChangedError } from '@/utils/source-page';
import { requireMessageSuccess } from '@/utils/message-response';

export async function handleStartConfigGeneration(
  data: { taskId: string; expectedUrl?: string },
  sendResponse: (response: ConfigGenerationResponse) => void,
): Promise<void> {
  const { taskId, expectedUrl } = data;
  if (expectedUrl && !isSameSourcePage(window.location.href, expectedUrl)) {
    sendResponse({ success: false, error: toExtensionErrorPayload(sourcePageChangedError()) });
    return;
  }
  sendResponse({ success: true });
  Logger.info('[Content] Starting config generation', { taskId });

  const { controller, supersededTask } = globalExtractionState.beginTask(taskId, 'config');
  if (supersededTask) {
    sendCancelledCompletion(
      supersededTask.taskId,
      supersededTask.taskType,
      'Extraction superseded by a newer task',
    );
  }

  try {
    const { domAnalyzer } = getTools();
    const localPageController = new PageController(domAnalyzer);
    const strategy = new AIStrategy(localPageController);

    try {
      const generated = await strategy.generateConfig((progress: number, message: string) => {
        if (!globalExtractionState.isCurrentTask(taskId, controller)) {
          return;
        }
        checkSourcePage(expectedUrl);
        void chrome.runtime
          .sendMessage({
            type: MESSAGES.EXTRACTION_PROGRESS,
            payload: { taskId, progress, message },
          })
          .catch((error) =>
            Logger.debug('[Content] Failed to send config generation progress', { error }),
          );
      }, controller.signal);
      if (!generated) {
        throw new ExtensionError(
          ErrorCode.DOM_ANALYSIS_FAILED,
          'No valid crawling configuration was generated',
        );
      }

      if (!globalExtractionState.isCurrentTask(taskId, controller)) {
        Logger.info('[Content] Config generation cancelled');
        return;
      }

      checkSourcePage(expectedUrl);
      const response: unknown = await chrome.runtime.sendMessage({
        type: MESSAGES.CONFIG_GENERATION_COMPLETED,
        payload: { taskId, success: true },
      });
      requireMessageSuccess(
        response,
        new ExtensionError(
          ErrorCode.EXTRACTION_FAILED,
          'Config generation completion was rejected',
          {},
          false,
        ),
      );

      Logger.info('[Content] Config generation complete');
    } finally {
      strategy.cleanup();
    }
  } catch (error) {
    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Config generation cancelled', { taskId });
      return;
    }

    Logger.error('[Content] Config generation failed', { error });
    await sendTaskFailure(taskId, 'config', error);
  } finally {
    globalExtractionState.finishTask(taskId, controller);
  }
}
