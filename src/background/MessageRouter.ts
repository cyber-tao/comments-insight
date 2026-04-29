import { Message, PortMessage } from '../types';
import { TaskManager } from './TaskManager';
import { AIService } from './AIService';
import { StorageManager } from './StorageManager';
import { Logger } from '../utils/logger';
import { ErrorHandler, ExtensionError, ErrorCode } from '../utils/errors';
import { MESSAGES } from '@/config/constants';
import { HandlerContext } from './handlers/types';
import { validateMessagePayload } from '@/utils/message-validation';

import * as extractionHandlers from './handlers/extraction';
import * as settingsHandlers from './handlers/settings';
import * as historyHandlers from './handlers/history';
import * as taskHandlers from './handlers/task';
import * as miscHandlers from './handlers/misc';

const KNOWN_MESSAGE_TYPES = new Set<string>(Object.values(MESSAGES));

function isKnownMessageType(type: unknown): type is Message['type'] {
  return typeof type === 'string' && KNOWN_MESSAGE_TYPES.has(type);
}

function ensurePortSender(
  sender: chrome.runtime.MessageSender | undefined,
): chrome.runtime.MessageSender {
  if (!sender) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Port sender is required');
  }
  return sender;
}

function toMessage(message: PortMessage): Message {
  if (
    typeof message.id !== 'string' ||
    message.id.length === 0 ||
    !isKnownMessageType(message.type)
  ) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Invalid port message received', {
      id: message.id,
      type: message.type,
    });
  }

  if (typeof message.payload === 'undefined') {
    return { type: message.type } as Message;
  }

  return {
    type: message.type,
    payload: message.payload,
  } as Message;
}

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
      const response = await this.handleMessage(toMessage(message), ensurePortSender(port.sender));
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
    const validatedMessage = validateMessagePayload(message);

    Logger.debug('[MessageRouter] Handling message', {
      type: validatedMessage.type,
    });

    const context: HandlerContext = {
      taskManager: this.taskManager,
      aiService: this.aiService,
      storageManager: this.storageManager,
      sender,
    };

    try {
      switch (validatedMessage.type) {
        case MESSAGES.PING:
          return miscHandlers.handlePing(validatedMessage, context);

        case MESSAGES.ENSURE_CONTENT_SCRIPT:
          return await miscHandlers.handleEnsureContentScript(validatedMessage, context);

        case MESSAGES.START_EXTRACTION:
          return await extractionHandlers.handleStartExtraction(validatedMessage, context);

        case MESSAGES.START_CONFIG_GENERATION:
          return await extractionHandlers.handleStartConfigGeneration(validatedMessage, context);

        case MESSAGES.AI_ANALYZE_STRUCTURE:
          return await extractionHandlers.handleAIAnalyzeStructure(validatedMessage, context);

        case MESSAGES.AI_EXTRACT_CONTENT:
          return await extractionHandlers.handleAIExtractContent(validatedMessage, context);

        case MESSAGES.GENERATE_CRAWLING_CONFIG:
          return await extractionHandlers.handleGenerateCrawlingConfig(validatedMessage, context);

        case MESSAGES.EXTRACTION_COMPLETED:
          return await extractionHandlers.handleExtractionCompleted(validatedMessage, context);

        case MESSAGES.CONFIG_GENERATION_COMPLETED:
          return await extractionHandlers.handleConfigGenerationCompleted(
            validatedMessage,
            context,
          );

        case MESSAGES.EXTRACTION_PROGRESS:
          return extractionHandlers.handleExtractionProgress(validatedMessage, context);

        case MESSAGES.START_ANALYSIS:
          return await extractionHandlers.handleStartAnalysis(validatedMessage, context);

        case MESSAGES.GET_TASK_STATUS:
          return taskHandlers.handleGetTaskStatus(validatedMessage, context);

        case MESSAGES.CANCEL_TASK:
          return taskHandlers.handleCancelTask(validatedMessage, context);

        case MESSAGES.GET_SETTINGS:
          return await settingsHandlers.handleGetSettings(validatedMessage, context);

        case MESSAGES.SAVE_SETTINGS:
          return await settingsHandlers.handleSaveSettings(validatedMessage, context);

        case MESSAGES.IMPORT_SETTINGS:
          return await settingsHandlers.handleImportSettings(validatedMessage, context);

        case MESSAGES.CACHE_SELECTOR:
          return await settingsHandlers.handleCacheSelector(validatedMessage, context);

        case MESSAGES.GET_CRAWLING_CONFIG:
          return await settingsHandlers.handleGetCrawlingConfig(validatedMessage, context);

        case MESSAGES.SAVE_CRAWLING_CONFIG:
          return await settingsHandlers.handleSaveCrawlingConfig(validatedMessage, context);

        case MESSAGES.SYNC_CRAWLING_CONFIGS:
          return await settingsHandlers.handleSyncCrawlingConfigs(validatedMessage, context);

        case MESSAGES.UPDATE_FIELD_VALIDATION:
          return await settingsHandlers.handleUpdateFieldValidation(validatedMessage, context);

        case MESSAGES.GET_HISTORY:
          return await historyHandlers.handleGetHistory(validatedMessage, context);

        case MESSAGES.GET_HISTORY_BY_URL:
          return await historyHandlers.handleGetHistoryByUrl(validatedMessage, context);

        case MESSAGES.EXPORT_DATA:
          return await historyHandlers.handleExportData(validatedMessage, context);

        case MESSAGES.DELETE_HISTORY:
          return await historyHandlers.handleDeleteHistory(validatedMessage, context);

        case MESSAGES.CLEAR_ALL_HISTORY:
          return await historyHandlers.handleClearAllHistory(validatedMessage, context);

        case MESSAGES.GET_AVAILABLE_MODELS:
          return await miscHandlers.handleGetAvailableModels(validatedMessage, context);

        case MESSAGES.TEST_MODEL:
          return await miscHandlers.handleTestModel(validatedMessage, context);

        case MESSAGES.TEST_SELECTOR:
          return await miscHandlers.handleTestSelector(validatedMessage, context);

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
        `MessageRouter.handleMessage(${validatedMessage.type})`,
      );
      throw error;
    }
  }
}
