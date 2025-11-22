import { Message } from '../types';
import { TaskManager } from './TaskManager';
import { AIService } from './AIService';
import { StorageManager } from './StorageManager';
import { Logger } from '../utils/logger';
import { ErrorHandler, ExtensionError, ErrorCode } from '../utils/errors';
import { HandlerContext } from './handlers/types';

import * as extractionHandlers from './handlers/extraction';
import * as settingsHandlers from './handlers/settings';
import * as historyHandlers from './handlers/history';
import * as scraperHandlers from './handlers/scraper';
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
   * Handle incoming message
   * @param message - Message to handle
   * @param sender - Message sender
   * @returns Response data
   */
  async handleMessage(message: Message, sender: chrome.runtime.MessageSender): Promise<any> {
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
        case 'PING':
          return miscHandlers.handlePing(message, context);

        case 'START_EXTRACTION':
          return await extractionHandlers.handleStartExtraction(message, context);

        case 'AI_EXTRACT_COMMENTS':
          return await extractionHandlers.handleAIExtractComments(message, context);

        // AI_EXTRACT_PROGRESSIVE removed

        case 'AI_ANALYZE_STRUCTURE':
          return await extractionHandlers.handleAIAnalyzeStructure(message, context);

        case 'EXTRACTION_PROGRESS':
          return extractionHandlers.handleExtractionProgress(message, context);

        case 'START_ANALYSIS':
          return await extractionHandlers.handleStartAnalysis(message, context);

        case 'GET_TASK_STATUS':
          return taskHandlers.handleGetTaskStatus(message, context);

        case 'CANCEL_TASK':
          return taskHandlers.handleCancelTask(message, context);

        case 'GET_SETTINGS':
          return await settingsHandlers.handleGetSettings(message, context);

        case 'SAVE_SETTINGS':
          return await settingsHandlers.handleSaveSettings(message, context);

        case 'GET_HISTORY':
          return await historyHandlers.handleGetHistory(message, context);

        case 'GET_HISTORY_BY_URL':
          return await historyHandlers.handleGetHistoryByUrl(message, context);

        case 'EXPORT_DATA':
          return await historyHandlers.handleExportData(message, context);

        case 'DELETE_HISTORY':
          return await historyHandlers.handleDeleteHistory(message, context);

        case 'CLEAR_ALL_HISTORY':
          return await historyHandlers.handleClearAllHistory(message, context);

        case 'GET_AVAILABLE_MODELS':
          return await miscHandlers.handleGetAvailableModels(message, context);

        case 'TEST_MODEL':
          return await miscHandlers.handleTestModel(message, context);

        case 'CHECK_SCRAPER_CONFIG':
          return await scraperHandlers.handleCheckScraperConfig(message, context);

        case 'GENERATE_SCRAPER_CONFIG':
          return await scraperHandlers.handleGenerateScraperConfig(message, context);

        case 'GET_SCRAPER_CONFIGS':
          return await scraperHandlers.handleGetScraperConfigs(message, context);

        case 'SAVE_SCRAPER_CONFIG':
          return await scraperHandlers.handleSaveScraperConfig(message, context);

        case 'DELETE_SCRAPER_CONFIG':
          return await scraperHandlers.handleDeleteScraperConfig(message, context);

        case 'UPDATE_SELECTOR_VALIDATION':
          return await scraperHandlers.handleUpdateSelectorValidation(message, context);

        // Messages handled by content script, ignored by background
        case 'GET_PLATFORM_INFO':
        case 'GET_DOM_STRUCTURE':
        case 'TEST_SELECTOR_QUERY':
        case 'CANCEL_EXTRACTION': // Handled by content script too?
           // Wait, CANCEL_EXTRACTION was in MessageRouter switch before but handled by handleCancelTask?
           // No, `CANCEL_TASK` was handled. `CANCEL_EXTRACTION`?
           // Router: case MESSAGES.CANCEL_TASK: return this.handleCancelTask(message);
           // It did NOT have CANCEL_EXTRACTION.
           // Content script handles CANCEL_EXTRACTION.
           // So background ignores it.
           return;

        default:
          // If we strictly type check, `message.type` here is `never` (exhaustiveness check).
          // But at runtime it might be something else.
          throw new ExtensionError(
            ErrorCode.VALIDATION_ERROR,
            `Unknown message type: ${(message as any).type}`,
            { type: (message as any).type },
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