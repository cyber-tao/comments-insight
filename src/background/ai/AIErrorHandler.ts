import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode, createAIError, createNetworkError } from '../../utils/errors';
import { LIMITS, LOG_PREFIX, TEXT } from '@/config/constants';
import type { StorageManager } from '../StorageManager';

export class AIErrorHandler {
  static classifyHTTPError(status: number, errorText: string, model: string): never {
    if (status === 429) {
      throw createAIError(ErrorCode.AI_RATE_LIMIT, 'Rate limit exceeded', {
        status,
        response: errorText,
      });
    }
    if (status === 400) {
      if (
        errorText.includes('max_tokens') ||
        errorText.includes('context length') ||
        errorText.includes('maximum context')
      ) {
        throw createAIError(
          ErrorCode.INVALID_CONFIG,
          `Context limit exceeded. Please reduce 'Context Length' in settings or use a larger model. API Error: ${errorText}`,
          { status, response: errorText },
          false,
        );
      }
      throw createAIError(
        ErrorCode.API_ERROR,
        `API Bad Request (400): ${errorText}`,
        { status, response: errorText },
        false,
      );
    }
    if (status === 404) {
      throw createAIError(ErrorCode.AI_MODEL_NOT_FOUND, `Model '${model}' not found`, {
        status,
        model,
      });
    }
    if (status === 401) {
      throw createAIError(ErrorCode.MISSING_API_KEY, 'Invalid API key or unauthorized', {
        status,
      });
    }

    if (status === 403) {
      const preview = errorText.substring(0, 200);
      const isHtmlResponse = this.looksLikeHtmlResponse(errorText);
      const looksLikeAuthFailure = this.looksLikeAuthFailure(errorText);

      if (isHtmlResponse) {
        throw createAIError(
          ErrorCode.API_ERROR,
          'AI provider rejected request with HTML 403. This is usually a gateway/WAF block or endpoint mismatch, not a missing API key.',
          {
            status,
            responseType: 'html',
            responsePreview: preview,
          },
          false,
        );
      }

      if (looksLikeAuthFailure) {
        throw createAIError(ErrorCode.MISSING_API_KEY, 'Invalid API key or unauthorized', {
          status,
        });
      }

      throw createAIError(
        ErrorCode.API_ERROR,
        `AI provider rejected request (403): ${preview}`,
        {
          status,
          responsePreview: preview,
        },
        false,
      );
    }
    throw createAIError(ErrorCode.API_ERROR, `API error (${status}): ${errorText}`, {
      status,
      response: errorText,
    });
  }

  private static looksLikeHtmlResponse(errorText: string): boolean {
    const trimmed = errorText.trim().toLowerCase();
    return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html');
  }

  private static looksLikeAuthFailure(errorText: string): boolean {
    const lowered = errorText.toLowerCase();
    return (
      lowered.includes('invalid api key') ||
      lowered.includes('unauthorized') ||
      lowered.includes('authentication') ||
      lowered.includes('api key is invalid') ||
      lowered.includes('permission denied')
    );
  }

  static determineLogType(prompt: string): 'extraction' | 'analysis' {
    return prompt.includes('extract comments') ||
      prompt.includes('DOM Structure') ||
      prompt.includes('time normalization')
      ? 'extraction'
      : 'analysis';
  }

  static async logToFile(
    storageManager: StorageManager,
    type: 'extraction' | 'analysis',
    data: { prompt: string; response: string; timestamp: number },
  ): Promise<void> {
    Logger.debug(`[AI_LOG_${type.toUpperCase()}]`, {
      timestamp: data.timestamp,
      type,
      prompt: data.prompt.substring(0, LIMITS.LOG_PROMPT_PREVIEW_LENGTH) + TEXT.PREVIEW_SUFFIX,
      response: data.response.substring(0, LIMITS.LOG_PROMPT_PREVIEW_LENGTH) + TEXT.PREVIEW_SUFFIX,
      promptLength: data.prompt.length,
      responseLength: data.response.length,
    });

    try {
      const settings = await storageManager.getSettings();
      if (!settings.developerMode) return;
      const logKey = `${LOG_PREFIX.AI}${type}_${data.timestamp}`;
      await storageManager.saveAiLog(logKey, {
        type,
        timestamp: data.timestamp,
        prompt: data.prompt,
        response: data.response,
      });
    } catch (error) {
      Logger.error('[AIErrorHandler] Failed to save log', { error });
    }
  }

  static classifyCallError(
    storageManager: StorageManager,
    error: unknown,
    signal: AbortSignal | undefined,
    effectiveTimeout: number,
    prompt: string,
  ): never {
    if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Timeout')) {
      if (signal?.aborted) {
        throw createAIError(ErrorCode.TASK_CANCELLED, 'Request aborted by user', {});
      }
      throw createAIError(
        ErrorCode.AI_TIMEOUT,
        `AI Request timed out after ${effectiveTimeout}ms`,
        {},
        false,
      );
    }

    if (error instanceof ExtensionError) {
      if (
        error.retryable ||
        [ErrorCode.AI_RATE_LIMIT, ErrorCode.AI_TIMEOUT, ErrorCode.API_ERROR].includes(error.code)
      ) {
        Logger.debug(`[AIErrorHandler] Encountered retryable error: ${error.code}`, {
          message: error.message,
        });
      }
      this.logToFile(storageManager, this.determineLogType(prompt), {
        prompt,
        response: error.message,
        timestamp: Date.now(),
      }).catch((e) => Logger.warn('Failed to log to file', { error: e }));
      throw error;
    }

    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw createNetworkError('Network request failed', {
        originalError: error.message,
      });
    }

    Logger.error('[AIErrorHandler] AI call failed', { error });
    this.logToFile(storageManager, this.determineLogType(prompt), {
      prompt,
      response: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    }).catch((e) => Logger.warn('Failed to log to file', { error: e }));
    throw error;
  }
}
