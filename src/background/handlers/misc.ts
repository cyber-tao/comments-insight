import { Message } from '../../types';
import { HandlerContext, PingResponse } from './types';
import { Logger } from '../../utils/logger';
import { ERRORS, LIMITS } from '@/config/constants';
import { ensureContentScriptInjected } from '../ContentScriptInjector';

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
    let tabId = message.payload?.tabId ?? context.sender?.tab?.id;

    if (!tabId) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = activeTab?.id;
    }

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
    throw new Error(ERRORS.API_CONFIG_REQUIRED);
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
    throw new Error(ERRORS.COMPLETE_MODEL_CONFIG_REQUIRED);
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
      throw new Error(ERRORS.NO_RESPONSE_FROM_MODEL);
    }
  } catch (error) {
    Logger.error('[MiscHandler] Model test failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
