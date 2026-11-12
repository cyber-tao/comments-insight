import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode, createAIError, createNetworkError } from '../../utils/errors';
import { LIMITS, LOG_PREFIX, TEXT } from '@/config/constants';
import { redactApiKey, sanitizeLogText } from '@/utils/log-sanitize';
import type { SettingsStore } from '../storage/SettingsStore';
import type { LogStore } from '../storage/LogStore';

export class AIErrorHandler {
  static classifyHTTPError(
    status: number,
    errorText: string,
    model: string,
    apiKey: string,
  ): never {
    const safeText = redactApiKey(errorText, apiKey);
    if (status === 429) {
      throw createAIError(ErrorCode.AI_RATE_LIMIT, 'Rate limit exceeded', {
        status,
        response: safeText,
      });
    }
    if (status === 400) {
      if (
        errorText.includes('max_tokens') ||
        errorText.includes('max_output_tokens') ||
        errorText.includes('context length') ||
        errorText.includes('maximum context')
      ) {
        throw createAIError(
          ErrorCode.INVALID_CONFIG,
          `Token limit exceeded. Please check 'Context Length' and 'Max Output Tokens' in settings or use a larger model. API Error: ${safeText}`,
          { status, response: safeText },
          false,
        );
      }
      throw createAIError(
        ErrorCode.API_ERROR,
        `API Bad Request (400): ${safeText}`,
        { status, response: safeText },
        false,
      );
    }
    if (status === 404) {
      const safeModel = redactApiKey(model, apiKey);
      throw createAIError(ErrorCode.AI_MODEL_NOT_FOUND, `Model '${safeModel}' not found`, {
        status,
        model: safeModel,
      });
    }
    if (status === 401) {
      throw createAIError(ErrorCode.MISSING_API_KEY, 'Invalid API key or unauthorized', {
        status,
      });
    }

    if (status === 403) {
      const preview = safeText.substring(0, 200);
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
    throw createAIError(ErrorCode.API_ERROR, `API error (${status}): ${safeText}`, {
      status,
      response: safeText,
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
    logStore: LogStore,
    type: 'extraction' | 'analysis',
    data: { prompt: string; response: string; timestamp: number },
    settingsStore: SettingsStore,
    apiKey: string,
  ): Promise<void> {
    const sanitizedPrompt = sanitizeLogText(data.prompt, apiKey);
    const sanitizedResponse = sanitizeLogText(data.response, apiKey);

    Logger.debug(`[AI_LOG_${type.toUpperCase()}]`, {
      timestamp: data.timestamp,
      type,
      prompt: sanitizedPrompt.substring(0, LIMITS.LOG_PROMPT_PREVIEW_LENGTH) + TEXT.PREVIEW_SUFFIX,
      response:
        sanitizedResponse.substring(0, LIMITS.LOG_PROMPT_PREVIEW_LENGTH) + TEXT.PREVIEW_SUFFIX,
      promptLength: data.prompt.length,
      responseLength: data.response.length,
    });

    try {
      const settings = await settingsStore.getSettings();
      if (!settings.developerMode) return;
      // Random suffix: concurrent batches can log within the same millisecond,
      // and identical keys would silently overwrite each other.
      const uniqueSuffix = Math.random().toString(36).substring(2, 7);
      const logKey = `${LOG_PREFIX.AI}${type}_${data.timestamp}_${uniqueSuffix}`;
      await logStore.saveAiLog(logKey, {
        type,
        timestamp: data.timestamp,
        prompt: sanitizedPrompt,
        response: sanitizedResponse,
      });
    } catch (error) {
      Logger.error('[AIErrorHandler] Failed to save log', { error });
    }
  }

  static classifyCallError(
    settingsStore: SettingsStore,
    logStore: LogStore,
    error: unknown,
    signal: AbortSignal | undefined,
    effectiveTimeout: number,
    prompt: string,
    apiKey: string,
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
      this.logToFile(
        logStore,
        this.determineLogType(prompt),
        {
          prompt,
          response: error.message,
          timestamp: Date.now(),
        },
        settingsStore,
        apiKey,
      ).catch((e) => Logger.warn('Failed to log to file', { error: e }));
      throw error;
    }

    const safeMessage = redactApiKey(
      error instanceof Error ? error.message : String(error),
      apiKey,
    );
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw createNetworkError('Network request failed', {
        originalError: safeMessage,
      });
    }

    const safeError = new Error(safeMessage);
    if (error instanceof Error) safeError.name = error.name;
    Logger.error('[AIErrorHandler] AI call failed', { error: safeError });
    this.logToFile(
      logStore,
      this.determineLogType(prompt),
      {
        prompt,
        response: safeMessage,
        timestamp: Date.now(),
      },
      settingsStore,
      apiKey,
    ).catch((e) => Logger.warn('Failed to log to file', { error: e }));
    throw safeError;
  }
}
