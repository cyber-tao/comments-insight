import { Message } from '../../types';
import { HandlerContext } from './types';
import { Logger } from '../../utils/logger';

export function handlePing(_message: Extract<Message, { type: 'PING' }>, _context: HandlerContext): any {
  return { status: 'ok', timestamp: Date.now() };
}

export async function handleGetAvailableModels(
  message: Extract<Message, { type: 'GET_AVAILABLE_MODELS' }>,
  context: HandlerContext,
): Promise<any> {
  const { apiUrl, apiKey } = message.payload || {};

  if (!apiUrl || !apiKey) {
    throw new Error('API URL and API Key are required');
  }

  try {
    const models = await context.aiService.getAvailableModels(apiUrl, apiKey);
    return { models };
  } catch (error) {
    Logger.error('[MiscHandler] Failed to get models', { error });
    return { models: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleTestModel(
  message: Extract<Message, { type: 'TEST_MODEL' }>,
  context: HandlerContext,
): Promise<any> {
  const { config } = message.payload || {};

  if (!config || !config.apiUrl || !config.apiKey || !config.model) {
    throw new Error('Complete model configuration is required');
  }

  try {
    // Send a simple test prompt to the model
    const response = await context.aiService.callAI({
      prompt: 'Hello! Please respond with "OK" if you can read this message.',
      config: config,
    });

    if (response && response.content) {
      return {
        success: true,
        message: 'Model is working correctly',
        response: response.content.substring(0, 100), // Return first 100 chars of response
      };
    } else {
      throw new Error('No response from model');
    }
  } catch (error) {
    Logger.error('[MiscHandler] Model test failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
