import { MESSAGES } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { globalExtractionState } from '../extractionState';
import { PageController } from '../PageController';
import { AIStrategy } from '../strategies/AIStrategy';
import { ConfigGenerationResponse } from '@/types/messages';
import { getTools } from './tools';
import { sendCancelledCompletion } from './extraction';
import { ErrorCode, ExtensionError } from '@/utils/error-types';

export async function handleStartConfigGeneration(
  data: { taskId: string },
  sendResponse: (response: ConfigGenerationResponse) => void,
): Promise<void> {
  sendResponse({ success: true });

  const { taskId } = data;
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
        chrome.runtime.sendMessage({
          type: MESSAGES.EXTRACTION_PROGRESS,
          payload: { taskId, progress, message },
        });
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

      await chrome.runtime.sendMessage({
        type: MESSAGES.CONFIG_GENERATION_COMPLETED,
        payload: { taskId, success: true },
      });

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
    await chrome.runtime.sendMessage({
      type: MESSAGES.CONFIG_GENERATION_COMPLETED,
      payload: {
        taskId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  } finally {
    globalExtractionState.finishTask(taskId, controller);
  }
}
