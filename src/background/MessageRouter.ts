import {
  AIBridgeMessage,
  Message,
  PortMessage,
  MessageType,
  PORT_CANCEL_MESSAGE_TYPE,
} from '../types';
import { Logger } from '../utils/logger';
import { ErrorHandler, ExtensionError, ErrorCode, toExtensionErrorPayload } from '../utils/errors';
import { MESSAGES } from '@/config/constants';
import { HandlerContext } from './handlers/types';
import type { ServiceInstances } from './ServiceContainer';
import { validateMessagePayload } from '@/utils/message-validation';
import { PORT_ACTIVITY_MESSAGE_TYPE } from '@/types/handlers';

import * as extractionHandlers from './handlers/extraction';
import * as analysisHandlers from './handlers/analysis';
import * as configGenerationHandlers from './handlers/config-generation';
import * as settingsHandlers from './handlers/settings';
import * as historyHandlers from './handlers/history';
import * as taskHandlers from './handlers/task';
import * as miscHandlers from './handlers/misc';

const CONTENT_ONLY_MESSAGE_TYPES = new Set<string>([
  MESSAGES.RUN_EXTRACTION,
  MESSAGES.RUN_CONFIG_GENERATION,
  MESSAGES.CANCEL_EXTRACTION,
  MESSAGES.GET_PLATFORM_INFO,
  MESSAGES.GET_DOM_STRUCTURE,
]);
const KNOWN_MESSAGE_TYPES = new Set<string>(
  Object.values(MESSAGES).filter((type) => !CONTENT_ONLY_MESSAGE_TYPES.has(type)),
);
export function isLogMessageType(type: unknown): boolean {
  return (
    type === MESSAGES.APPEND_SYSTEM_LOG ||
    type === MESSAGES.DELETE_LOG ||
    type === MESSAGES.CLEAR_LOGS
  );
}

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
  private portMessageInFlight = new Map<string, Promise<unknown>>();
  private portRequestControllers = new Map<string, AbortController>();
  private portActivity = new Map<
    string,
    { ports: Set<chrome.runtime.Port>; timer: ReturnType<typeof setInterval> }
  >();
  private readyPromise?: Promise<unknown>;

  private context: Omit<HandlerContext, 'sender'>;

  constructor(services: ServiceInstances, options?: { readyPromise?: Promise<unknown> }) {
    this.context = { ...services };
    this.readyPromise = options?.readyPromise;
    this.registerHandlers();
  }

  private async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      return;
    }
    try {
      await this.readyPromise;
    } catch (error) {
      throw new ExtensionError(
        ErrorCode.INITIALIZATION_FAILED,
        'Extension initialization failed',
        { originalError: error instanceof Error ? error.message : String(error) },
        false,
      );
    }
  }

  /**
   * Register all message handlers in the registry
   */
  private registerHandlers(): void {
    this.register(MESSAGES.PING, miscHandlers.handlePing);
    this.register(MESSAGES.ENSURE_CONTENT_SCRIPT, miscHandlers.handleEnsureContentScript);
    this.register(MESSAGES.START_EXTRACTION, extractionHandlers.handleStartExtraction);
    this.register(
      MESSAGES.START_CONFIG_GENERATION,
      configGenerationHandlers.handleStartConfigGeneration,
    );
    this.register(MESSAGES.AI_ANALYZE_STRUCTURE, analysisHandlers.handleAIAnalyzeStructure);
    this.register(MESSAGES.AI_EXTRACT_CONTENT, analysisHandlers.handleAIExtractContent);
    this.register(
      MESSAGES.GENERATE_CRAWLING_CONFIG,
      configGenerationHandlers.handleGenerateCrawlingConfig,
    );
    this.register(MESSAGES.EXTRACTION_COMPLETED, extractionHandlers.handleExtractionCompleted);
    this.register(
      MESSAGES.CONFIG_GENERATION_COMPLETED,
      configGenerationHandlers.handleConfigGenerationCompleted,
    );
    this.register(MESSAGES.EXTRACTION_PROGRESS, extractionHandlers.handleExtractionProgress);
    this.register(MESSAGES.START_ANALYSIS, analysisHandlers.handleStartAnalysis);
    this.register(MESSAGES.GENERATE_DYNAMIC_REPORT, analysisHandlers.handleGenerateDynamicReport);
    this.register(MESSAGES.GET_TASK_STATUS, taskHandlers.handleGetTaskStatus);
    this.register(MESSAGES.CANCEL_TASK, taskHandlers.handleCancelTask);
    this.register(MESSAGES.GET_SETTINGS, settingsHandlers.handleGetSettings);
    this.register(MESSAGES.SAVE_SETTINGS, settingsHandlers.handleSaveSettings);
    this.register(MESSAGES.IMPORT_SETTINGS, settingsHandlers.handleImportSettings);
    this.register(MESSAGES.CACHE_SELECTOR, settingsHandlers.handleCacheSelector);
    this.register(MESSAGES.GET_CRAWLING_CONFIG, settingsHandlers.handleGetCrawlingConfig);
    this.register(MESSAGES.SAVE_CRAWLING_CONFIG, settingsHandlers.handleSaveCrawlingConfig);
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
  async handlePortMessage(port: chrome.runtime.Port, message: AIBridgeMessage): Promise<void> {
    await this.ensureReady();
    const correlationId = message.id;
    if (typeof correlationId !== 'string' || correlationId.length === 0) {
      const error = new ExtensionError(
        ErrorCode.VALIDATION_ERROR,
        'Port message correlation ID is required',
      );
      Logger.error('[MessageRouter] Port message handling failed', { error, type: message.type });
      port.postMessage({ id: correlationId, response: { error: toExtensionErrorPayload(error) } });
      return;
    }

    if (message.type === PORT_CANCEL_MESSAGE_TYPE) {
      this.portRequestControllers.get(correlationId)?.abort();
      return;
    }

    let responsePromise = this.portMessageInFlight.get(correlationId);
    let controller = this.portRequestControllers.get(correlationId);
    try {
      if (!responsePromise) {
        controller = new AbortController();
        responsePromise = this.handleMessage(toMessage(message), ensurePortSender(port.sender), {
          requestSignal: controller.signal,
        });
        this.portRequestControllers.set(correlationId, controller);
        this.portMessageInFlight.set(correlationId, responsePromise);
        const ports = new Set<chrome.runtime.Port>();
        const timer = setInterval(() => {
          for (const target of ports) {
            try {
              target.postMessage({ id: correlationId, type: PORT_ACTIVITY_MESSAGE_TYPE });
            } catch {
              ports.delete(target);
            }
          }
        }, 1000);
        this.portActivity.set(correlationId, { ports, timer });
      }
      this.portActivity.get(correlationId)?.ports.add(port);

      const response = await responsePromise;
      port.postMessage({ id: correlationId, response });
    } catch (error) {
      Logger.error('[MessageRouter] Port message handling failed', { error, type: message.type });
      const response = { error: toExtensionErrorPayload(error) };
      try {
        port.postMessage({ id: correlationId, response });
      } catch (postError) {
        Logger.debug('[MessageRouter] Port disconnected before error response', {
          error: postError,
          correlationId,
        });
      }
    } finally {
      if (this.portMessageInFlight.get(correlationId) === responsePromise) {
        const activity = this.portActivity.get(correlationId);
        if (activity) clearInterval(activity.timer);
        this.portActivity.delete(correlationId);
        this.portMessageInFlight.delete(correlationId);
      }
      if (this.portRequestControllers.get(correlationId) === controller) {
        this.portRequestControllers.delete(correlationId);
      }
    }
  }

  /**
   * Handle incoming message
   * @param message - Message to handle
   * @param sender - Message sender
   * @returns Response data
   */
  async handleMessage(
    message: Message,
    sender: chrome.runtime.MessageSender,
    options: { requestSignal?: AbortSignal } = {},
  ): Promise<unknown> {
    await this.ensureReady();
    const validatedMessage = validateMessagePayload(message);

    // Logging its own transport would enqueue another log indefinitely.
    if (validatedMessage.type === MESSAGES.APPEND_SYSTEM_LOG) {
      await this.context.logStore.saveSystemLog(validatedMessage.payload.entry);
      return { success: true };
    }
    if (validatedMessage.type === MESSAGES.DELETE_LOG) {
      await this.context.logStore.deleteLog(
        validatedMessage.payload.key,
        validatedMessage.payload.kind,
      );
      return { success: true };
    }
    if (validatedMessage.type === MESSAGES.CLEAR_LOGS) {
      await this.context.logStore.clearLogs(validatedMessage.payload.kind);
      return { success: true };
    }

    Logger.debug('[MessageRouter] Handling message', {
      type: validatedMessage.type,
    });

    const context: HandlerContext = {
      ...this.context,
      sender,
      requestSignal: options.requestSignal,
    };

    const handler = this.handlers.get(validatedMessage.type);

    if (!handler) {
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
}
