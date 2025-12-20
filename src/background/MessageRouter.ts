import { Message, PortMessage } from '../types';
import { TaskManager } from './TaskManager';
import { AIService } from './AIService';
import { StorageManager } from './StorageManager';
import { Logger } from '../utils/logger';
import { ErrorHandler, ExtensionError, ErrorCode } from '../utils/errors';
import { MESSAGES } from '@/config/constants';
import { HandlerContext } from './handlers/types';

import * as extractionHandlers from './handlers/extraction';
import * as settingsHandlers from './handlers/settings';
import * as historyHandlers from './handlers/history';
import * as taskHandlers from './handlers/task';
import * as miscHandlers from './handlers/misc';

/**
 * MessageRouter handles all incoming messages and routes them
 * to the appropriate service
 */
export class MessageRouter {
  constructor(
    private taskManager: TaskManager,
    private aiService: AIService,
    private storageManager: StorageManager,
  ) {}

  /**
   * Handle message from a long-lived port connection
   * @param port - Chrome runtime port
   * @param message - Port message with correlation ID
   */
  async handlePortMessage(port: chrome.runtime.Port, message: PortMessage): Promise<void> {
    const correlationId = message.id;
    try {
      // Cast to Message for handleMessage - the type field ensures compatibility
      const response = await this.handleMessage(message as unknown as Message, port.sender!);
      port.postMessage({ id: correlationId, response });
    } catch (error) {
      Logger.error('[MessageRouter] Port message handling failed', { error, type: message.type });
      port.postMessage({
        id: correlationId,
        response: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  /**
   * Handle incoming message
   * @param message - Message to handle
   * @param sender - Message sender
   * @returns Response data
   */
  async handleMessage(message: Message, sender: chrome.runtime.MessageSender): Promise<unknown> {
    Logger.debug('[MessageRouter] Handling message', {
      type: message.type,
    });

    const context: HandlerContext = {
      taskManager: this.taskManager,
      aiService: this.aiService,
      storageManager: this.storageManager,
      sender,
    };

    try {
      switch (message.type) {
        case MESSAGES.PING:
          return miscHandlers.handlePing(message, context);

        case MESSAGES.ENSURE_CONTENT_SCRIPT:
          return await miscHandlers.handleEnsureContentScript(message, context);

        case MESSAGES.START_EXTRACTION:
          return await extractionHandlers.handleStartExtraction(message, context);

        case MESSAGES.AI_ANALYZE_STRUCTURE:
          return await extractionHandlers.handleAIAnalyzeStructure(message, context);

        case MESSAGES.AI_EXTRACT_CONTENT:
          return await extractionHandlers.handleAIExtractContent(message, context);

        case MESSAGES.EXTRACTION_COMPLETED:
          return await extractionHandlers.handleExtractionCompleted(message, context);

        case MESSAGES.EXTRACTION_PROGRESS:
          return extractionHandlers.handleExtractionProgress(message, context);

        case MESSAGES.START_ANALYSIS:
          return await extractionHandlers.handleStartAnalysis(message, context);

        case MESSAGES.GET_TASK_STATUS:
          return taskHandlers.handleGetTaskStatus(message, context);

        case MESSAGES.CANCEL_TASK:
          return taskHandlers.handleCancelTask(message, context);

        case MESSAGES.GET_SETTINGS:
          return await settingsHandlers.handleGetSettings(message, context);

        case MESSAGES.SAVE_SETTINGS:
          return await settingsHandlers.handleSaveSettings(message, context);

        case MESSAGES.GET_HISTORY:
          return await historyHandlers.handleGetHistory(message, context);

        case MESSAGES.GET_HISTORY_BY_URL:
          return await historyHandlers.handleGetHistoryByUrl(message, context);

        case MESSAGES.EXPORT_DATA:
          return await historyHandlers.handleExportData(message, context);

        case MESSAGES.DELETE_HISTORY:
          return await historyHandlers.handleDeleteHistory(message, context);

        case MESSAGES.CLEAR_ALL_HISTORY:
          return await historyHandlers.handleClearAllHistory(message, context);

        case MESSAGES.GET_AVAILABLE_MODELS:
          return await miscHandlers.handleGetAvailableModels(message, context);

        case MESSAGES.TEST_MODEL:
          return await miscHandlers.handleTestModel(message, context);

        // Messages handled by content script, ignored by background
        case MESSAGES.GET_PLATFORM_INFO:
        case MESSAGES.GET_DOM_STRUCTURE:
        case MESSAGES.CANCEL_EXTRACTION:
          return;

        default:
          throw new ExtensionError(
            ErrorCode.VALIDATION_ERROR,
            `Unknown message type: ${(message as { type: string }).type}`,
            { type: (message as { type: string }).type },
          );
      }
    } catch (error) {
      await ErrorHandler.handleError(
        error as Error,
        `MessageRouter.handleMessage(${message.type})`,
      );
      throw error;
    }
  }
}
