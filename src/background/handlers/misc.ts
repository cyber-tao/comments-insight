import { Message } from '../../types';
import { HandlerContext, PingResponse } from './types';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '../../utils/errors';
import { LIMITS, MESSAGES, TEXT } from '@/config/constants';
import { ensureContentScriptInjected } from '../ContentScriptInjector';
import { resolveTabId } from '../../utils/tab-helpers';

export interface ModelsResponse {
  models: string[];
  error?: string;
}

export interface TestModelResponse {
  success: boolean;
  message?: string;
  response?: string;
  error?: string;
}

export interface SelectorTestResponse {
  success: boolean;
  total?: number;
  items?: string[];
  error?: string;
}

export function handlePing(
  _message: Extract<Message, { type: 'PING' }>,
  _context: HandlerContext,
): PingResponse {
  return { status: 'ok', timestamp: Date.now() };
}

export async function handleEnsureContentScript(
  message: Extract<Message, { type: 'ENSURE_CONTENT_SCRIPT' }>,
  context: HandlerContext,
): Promise<{ success: boolean; tabId?: number; error?: string }> {
  try {
    const tabId = await resolveTabId(message.payload?.tabId, context.sender?.tab?.id);
    if (!tabId) {
      return { success: false, error: 'No tab ID available' };
    }

    await ensureContentScriptInjected(tabId);
    return { success: true, tabId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleGetAvailableModels(
  message: Extract<Message, { type: 'GET_AVAILABLE_MODELS' }>,
  context: HandlerContext,
): Promise<ModelsResponse> {
  const { apiUrl, apiKey } = message.payload || {};

  if (!apiUrl) {
    throw new ExtensionError(ErrorCode.INVALID_API_URL, 'API configuration is required');
  }

  try {
    const models = await context.aiService.getAvailableModels(apiUrl, apiKey || '');
    return { models };
  } catch (error) {
    Logger.error('[MiscHandler] Failed to get models', { error });
    return { models: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleTestModel(
  message: Extract<Message, { type: 'TEST_MODEL' }>,
  context: HandlerContext,
): Promise<TestModelResponse> {
  const { config } = message.payload || {};

  if (!config || !config.apiUrl || !config.model) {
    throw new ExtensionError(ErrorCode.INVALID_CONFIG, 'Complete model configuration is required');
  }

  try {
    const response = await context.aiService.callAI({
      prompt: 'Hello! Please respond with "OK" if you can read this message.',
      config: config,
    });

    if (response && response.content) {
      return {
        success: true,
        message: 'Model is working correctly',
        response: response.content.substring(0, LIMITS.MODEL_RESPONSE_PREVIEW_LENGTH),
      };
    } else {
      throw new ExtensionError(ErrorCode.AI_INVALID_RESPONSE, 'No response from model');
    }
  } catch (error) {
    Logger.error('[MiscHandler] Model test failed', { error });
    return {
      success: false,
      error: error instanceof Error ? `${error.message} ${TEXT.MODEL_TEST_HINT}` : 'Unknown error',
    };
  }
}

export async function handleTestSelector(
  message: Extract<Message, { type: 'TEST_SELECTOR' }>,
  context: HandlerContext,
): Promise<SelectorTestResponse> {
  const { selector, selectorType, tabId: payloadTabId } = message.payload || {};

  if (!selector || !selectorType) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Selector and selectorType are required');
  }

  try {
    const tabId = await resolveTabId(payloadTabId, context.sender?.tab?.id);
    if (!tabId) {
      return { success: false, error: 'No tab ID available' };
    }

    await ensureContentScriptInjected(tabId);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: MESSAGES.TEST_SELECTOR,
      payload: { selector, selectorType },
    });
    if (response) {
      return response as SelectorTestResponse;
    }
    return { success: false, error: 'No response from content script' };
  } catch (error) {
    Logger.error('[MiscHandler] Selector test failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
