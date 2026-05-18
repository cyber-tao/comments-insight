import { Message, PortMessage, MessageType } from '../types';
import { TaskManager } from './TaskManager';
import { AIService } from './AIService';
import { CommentAnalyzer } from './ai/CommentAnalyzer';
import { TimestampNormalizer } from './ai/TimestampNormalizer';
import { SettingsStore } from './storage/SettingsStore';
import { HistoryStore } from './storage/HistoryStore';
import { EncryptionService } from './storage/EncryptionService';
import { LogStore } from './storage/LogStore';
import { TokenStatsStore } from './storage/TokenStatsStore';
import { CrawlingConfigStore } from './storage/CrawlingConfigStore';
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

type HandlerFunction<T extends Message = Message> = {
  bivarianceHack: (message: T, context: HandlerContext) => Promise<unknown> | unknown;
}['bivarianceHack'];

/**
 * MessageRouter handles all incoming messages and routes them
 * to the appropriate service using a registry pattern
 */
export class MessageRouter {
  private handlers = new Map<MessageType, HandlerFunction>();

  private context: Omit<HandlerContext, 'sender'>;

  constructor(
    taskManager: TaskManager,
    aiService: AIService,
    commentAnalyzer: CommentAnalyzer,
    timestampNormalizer: TimestampNormalizer,
    settingsStore: SettingsStore,
    historyStore: HistoryStore,
    encryptionService: EncryptionService,
    logStore: LogStore,
    tokenStatsStore: TokenStatsStore,
    crawlingConfigStore: CrawlingConfigStore,
  ) {
    this.context = {
      taskManager,
      aiService,
      commentAnalyzer,
      timestampNormalizer,
      settingsStore,
      historyStore,
      encryptionService,
      logStore,
      tokenStatsStore,
      crawlingConfigStore,
    };
    this.registerHandlers();
  }

  /**
   * Register all message handlers in the registry
   */
  private registerHandlers(): void {
    this.register(MESSAGES.PING, miscHandlers.handlePing);
    this.register(MESSAGES.ENSURE_CONTENT_SCRIPT, miscHandlers.handleEnsureContentScript);
    this.register(MESSAGES.START_EXTRACTION, extractionHandlers.handleStartExtraction);
    this.register(MESSAGES.START_CONFIG_GENERATION, extractionHandlers.handleStartConfigGeneration);
    this.register(MESSAGES.AI_ANALYZE_STRUCTURE, extractionHandlers.handleAIAnalyzeStructure);
    this.register(MESSAGES.AI_EXTRACT_CONTENT, extractionHandlers.handleAIExtractContent);
    this.register(
      MESSAGES.GENERATE_CRAWLING_CONFIG,
      extractionHandlers.handleGenerateCrawlingConfig,
    );
    this.register(MESSAGES.EXTRACTION_COMPLETED, extractionHandlers.handleExtractionCompleted);
    this.register(
      MESSAGES.CONFIG_GENERATION_COMPLETED,
      extractionHandlers.handleConfigGenerationCompleted,
    );
    this.register(MESSAGES.EXTRACTION_PROGRESS, extractionHandlers.handleExtractionProgress);
    this.register(MESSAGES.START_ANALYSIS, extractionHandlers.handleStartAnalysis);
    this.register(MESSAGES.GET_TASK_STATUS, taskHandlers.handleGetTaskStatus);
    this.register(MESSAGES.CANCEL_TASK, taskHandlers.handleCancelTask);
    this.register(MESSAGES.GET_SETTINGS, settingsHandlers.handleGetSettings);
    this.register(MESSAGES.SAVE_SETTINGS, settingsHandlers.handleSaveSettings);
    this.register(MESSAGES.IMPORT_SETTINGS, settingsHandlers.handleImportSettings);
    this.register(MESSAGES.CACHE_SELECTOR, settingsHandlers.handleCacheSelector);
    this.register(MESSAGES.GET_CRAWLING_CONFIG, settingsHandlers.handleGetCrawlingConfig);
    this.register(MESSAGES.SAVE_CRAWLING_CONFIG, settingsHandlers.handleSaveCrawlingConfig);
    this.register(MESSAGES.SYNC_CRAWLING_CONFIGS, settingsHandlers.handleSyncCrawlingConfigs);
    this.register(MESSAGES.UPDATE_FIELD_VALIDATION, settingsHandlers.handleUpdateFieldValidation);
    this.register(MESSAGES.GET_HISTORY, historyHandlers.handleGetHistory);
    this.register(MESSAGES.GET_HISTORY_BY_URL, historyHandlers.handleGetHistoryByUrl);
    this.register(MESSAGES.EXPORT_DATA, historyHandlers.handleExportData);
    this.register(MESSAGES.DELETE_HISTORY, historyHandlers.handleDeleteHistory);
    this.register(MESSAGES.CLEAR_ALL_HISTORY, historyHandlers.handleClearAllHistory);
    this.register(MESSAGES.GET_AVAILABLE_MODELS, miscHandlers.handleGetAvailableModels);
    this.register(MESSAGES.TEST_MODEL, miscHandlers.handleTestModel);
    this.register(MESSAGES.TEST_SELECTOR, miscHandlers.handleTestSelector);
  }

  /**
   * Register a handler for a specific message type
   */
  private register<T extends MessageType>(
    type: T,
    handler: HandlerFunction<Extract<Message, { type: T }>>,
  ): void {
    this.handlers.set(type, handler as HandlerFunction);
  }

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
      ...this.context,
      sender,
    };

    const handler = this.handlers.get(validatedMessage.type);

    if (!handler) {
      if (this.isContentScriptMessage(validatedMessage.type)) {
        return;
      }

      throw new ExtensionError(
        ErrorCode.VALIDATION_ERROR,
        `Unknown message type: ${validatedMessage.type}`,
        { type: validatedMessage.type },
      );
    }

    try {
      return await handler(validatedMessage, context);
    } catch (error) {
      await ErrorHandler.handleError(
        error as Error,
        `MessageRouter.handleMessage(${validatedMessage.type})`,
      );
      throw error;
    }
  }

  /**
   * Check if a message type is handled by content script
   */
  private isContentScriptMessage(type: MessageType): boolean {
    return (
      type === MESSAGES.GET_PLATFORM_INFO ||
      type === MESSAGES.GET_DOM_STRUCTURE ||
      type === MESSAGES.CANCEL_EXTRACTION
    );
  }
}
