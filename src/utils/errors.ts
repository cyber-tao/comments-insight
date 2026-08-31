import { ICONS, RETRY } from '@/config/constants';
import i18n from './i18n';
import { Logger } from './logger';

export {
  ErrorCode,
  ExtensionError,
  fromExtensionErrorPayload,
  isExtensionErrorPayload,
  toExtensionErrorPayload,
} from './error-types';
export type { ExtensionErrorPayload } from './error-types';
import { ErrorCode, ExtensionError } from './error-types';

// interface ErrorConstructorWithCapture removed

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: ErrorCode[];
  abortSignal?: AbortSignal;
  onRetry?: (attempt: number, error: ExtensionError) => void;
  fallback?: () => Promise<unknown>;
}

/**
 * Default retry configuration
 *
 * Note: AI_TIMEOUT is deliberately absent. AI timeouts are classified
 * explicitly by AIErrorHandler.classifyCallError with retryable: false —
 * the user-configurable aiTimeout is the intended budget, and honoring it
 * keeps worst-case analysis waits bounded instead of tripling them. Generic
 * TIMEOUT_ERROR (unclassified native timeouts) remains retryable.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: RETRY.INITIAL_DELAY_MS,
  maxDelay: RETRY.MAX_DELAY_MS,
  backoffMultiplier: 2,
  retryableErrors: [ErrorCode.NETWORK_ERROR, ErrorCode.TIMEOUT_ERROR, ErrorCode.API_ERROR],
};

/**
 * Error handler class
 */
export class ErrorHandler {
  /**
   * Handle an error with optional retry
   * @param error - Error to handle
   * @param context - Context where error occurred
   */
  static async handleError(error: Error | ExtensionError, context: string): Promise<void> {
    const extensionError = this.normalizeError(error);

    Logger.error(`[${context}] ${extensionError.code}: ${extensionError.message}`, {
      code: extensionError.code,
      details: extensionError.details,
      stack: extensionError.stack,
    });

    // Show user notification for critical errors
    if (this.isCriticalError(extensionError.code)) {
      await this.showUserNotification(extensionError);
    }
  }

  /**
   * Execute a function with retry logic
   * @param fn - Function to execute
   * @param context - Context for error logging
   * @param config - Retry configuration
   * @returns Result of the function
   */
  static async withRetry<T>(
    fn: () => Promise<T>,
    context: string,
    config: Partial<RetryConfig> = {},
  ): Promise<T> {
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    let lastError: ExtensionError | null = null;
    let delay = retryConfig.initialDelay;
    const abortSignal = retryConfig.abortSignal;

    const createCancelledError = (): ExtensionError =>
      new ExtensionError(ErrorCode.TASK_CANCELLED, 'Operation cancelled', {}, false);

    const throwIfAborted = (): void => {
      if (abortSignal?.aborted) {
        throw createCancelledError();
      }
    };

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      throwIfAborted();
      try {
        Logger.debug(`[${context}] Attempt ${attempt}/${retryConfig.maxAttempts}`);
        return await fn();
      } catch (error) {
        throwIfAborted();
        lastError = this.normalizeError(error as Error);

        Logger.warn(`[${context}] Attempt ${attempt} failed: ${lastError.message}`, {
          code: lastError.code,
          attempt,
          maxAttempts: retryConfig.maxAttempts,
        });

        if (!this.isRetryable(lastError, retryConfig)) {
          Logger.error(`[${context}] Error is not retryable, giving up`, {
            code: lastError.code,
          });
          if (retryConfig.fallback) {
            Logger.info(`[${context}] Executing fallback`);
            return (await retryConfig.fallback()) as T;
          }
          throw lastError;
        }

        if (attempt === retryConfig.maxAttempts) {
          Logger.error(`[${context}] Max retry attempts reached, giving up`, {
            attempts: attempt,
          });
          if (retryConfig.fallback) {
            Logger.info(`[${context}] Executing fallback`);
            return (await retryConfig.fallback()) as T;
          }
          throw lastError;
        }

        retryConfig.onRetry?.(attempt, lastError);

        Logger.debug(`[${context}] Waiting ${delay}ms before retry...`);

        await this.sleep(delay, abortSignal);
        delay = Math.min(delay * retryConfig.backoffMultiplier, retryConfig.maxDelay);
      }
    }

    throw lastError || new ExtensionError(ErrorCode.UNKNOWN_ERROR, 'Retry failed');
  }

  /**
   * Normalize any error to ExtensionError
   * @param error - Error to normalize
   * @returns ExtensionError
   */
  static normalizeError(error: Error | ExtensionError): ExtensionError {
    if (error instanceof ExtensionError) {
      return error;
    }

    // Try to infer error code from error message
    const code = this.inferErrorCode(error);
    const retryable = this.isRetryableCode(code);

    return new ExtensionError(
      code,
      error.message || 'Unknown error occurred',
      { originalError: error.name, stack: error.stack },
      retryable,
    );
  }

  /**
   * Infer error code from error message or type
   * @param error - Error to analyze
   * @returns Inferred error code
   */
  private static inferErrorCode(error: Error): ErrorCode {
    const message = error.message.toLowerCase();

    if (error.name === 'AbortError' || message.includes('aborted')) {
      return ErrorCode.TASK_CANCELLED;
    }

    // Network errors
    if (message.includes('network') || message.includes('fetch')) {
      return ErrorCode.NETWORK_ERROR;
    }
    if (message.includes('timeout')) {
      return ErrorCode.TIMEOUT_ERROR;
    }

    // AI errors
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return ErrorCode.AI_RATE_LIMIT;
    }
    // Storage quota must be checked before generic 'quota' match
    if (message.includes('quota') && message.includes('storage')) {
      return ErrorCode.STORAGE_QUOTA_EXCEEDED;
    }
    if (message.includes('quota') || message.includes('insufficient')) {
      return ErrorCode.AI_QUOTA_EXCEEDED;
    }
    if (message.includes('model not found') || message.includes('invalid model')) {
      return ErrorCode.AI_MODEL_NOT_FOUND;
    }
    if (message.includes('invalid json') || message.includes('parse')) {
      return ErrorCode.AI_INVALID_RESPONSE;
    }

    // Storage errors
    if (message.includes('storage')) {
      return ErrorCode.STORAGE_ERROR;
    }

    // Configuration errors
    if (message.includes('api key') || message.includes('apikey')) {
      return ErrorCode.MISSING_API_KEY;
    }
    if (message.includes('api url') || message.includes('endpoint')) {
      return ErrorCode.INVALID_API_URL;
    }

    // Task errors
    if (message.includes('task not found')) {
      return ErrorCode.TASK_NOT_FOUND;
    }
    if (message.includes('cancelled')) {
      return ErrorCode.TASK_CANCELLED;
    }

    // Extraction errors
    if (message.includes('no comments')) {
      return ErrorCode.NO_COMMENTS_FOUND;
    }
    if (message.includes('platform') && message.includes('not supported')) {
      return ErrorCode.PLATFORM_NOT_SUPPORTED;
    }

    return ErrorCode.UNKNOWN_ERROR;
  }

  /**
   * Check if error code is retryable
   * @param code - Error code
   * @returns True if retryable
   */
  private static isRetryableCode(code: ErrorCode): boolean {
    return DEFAULT_RETRY_CONFIG.retryableErrors.includes(code);
  }

  /**
   * Check if error is retryable based on config
   * @param error - Error to check
   * @param config - Retry configuration
   * @returns True if retryable
   */
  private static isRetryable(error: ExtensionError, config: RetryConfig): boolean {
    if (error.retryableWasExplicit) {
      return error.retryable;
    }
    return config.retryableErrors.includes(error.code);
  }

  /**
   * Check if error is critical (should show notification)
   * @param code - Error code
   * @returns True if critical
   */
  private static isCriticalError(code: ErrorCode): boolean {
    const criticalErrors = [
      ErrorCode.STORAGE_QUOTA_EXCEEDED,
      ErrorCode.MISSING_API_KEY,
      ErrorCode.INVALID_CONFIG,
      ErrorCode.AI_QUOTA_EXCEEDED,
    ];
    return criticalErrors.includes(code);
  }

  /**
   * Show user-friendly notification
   * @param error - Error to show
   */
  private static async showUserNotification(error: ExtensionError): Promise<void> {
    try {
      const message = getUserFriendlyMessage(error.code, error.message);

      await chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL(ICONS.ICON_128),
        title: i18n.t('common.appName'),
        message: message,
        priority: 2,
      });
    } catch (notificationError) {
      Logger.error('[ErrorHandler] Failed to show notification:', { error: notificationError });
    }
  }

  /**
   * Sleep for specified milliseconds
   * @param ms - Milliseconds to sleep
   */
  private static sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new ExtensionError(ErrorCode.TASK_CANCELLED, 'Operation cancelled', {}, false));
        return;
      }

      const timeoutId = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', onAbort);
        reject(new ExtensionError(ErrorCode.TASK_CANCELLED, 'Operation cancelled', {}, false));
      };

      signal.addEventListener('abort', onAbort);
    });
  }
}

const ERROR_CODE_TO_I18N_KEY: Record<ErrorCode, string> = {
  [ErrorCode.NETWORK_ERROR]: 'errors.networkError',
  [ErrorCode.API_ERROR]: 'errors.apiError',
  [ErrorCode.TIMEOUT_ERROR]: 'errors.timeoutError',
  [ErrorCode.AI_TIMEOUT]: 'errors.aiTimeout',
  [ErrorCode.AI_RATE_LIMIT]: 'errors.aiRateLimit',
  [ErrorCode.AI_INVALID_RESPONSE]: 'errors.aiInvalidResponse',
  [ErrorCode.AI_QUOTA_EXCEEDED]: 'errors.aiQuotaExceeded',
  [ErrorCode.AI_MODEL_NOT_FOUND]: 'errors.aiModelNotFound',
  [ErrorCode.PLATFORM_NOT_SUPPORTED]: 'errors.platformNotSupported',
  [ErrorCode.EXTRACTION_FAILED]: 'errors.extractionFailed',
  [ErrorCode.NO_COMMENTS_FOUND]: 'errors.noCommentsFound',
  [ErrorCode.DOM_ANALYSIS_FAILED]: 'errors.domAnalysisFailed',
  [ErrorCode.STORAGE_QUOTA_EXCEEDED]: 'errors.storageQuotaExceeded',
  [ErrorCode.STORAGE_ERROR]: 'errors.storageError',
  [ErrorCode.STORAGE_READ_ERROR]: 'errors.storageReadError',
  [ErrorCode.STORAGE_WRITE_ERROR]: 'errors.storageWriteError',
  [ErrorCode.INVALID_CONFIG]: 'errors.invalidConfig',
  [ErrorCode.MISSING_API_KEY]: 'errors.missingApiKey',
  [ErrorCode.INVALID_API_URL]: 'errors.invalidApiUrl',
  [ErrorCode.INVALID_MODEL]: 'errors.invalidModel',
  [ErrorCode.TASK_NOT_FOUND]: 'errors.taskNotFound',
  [ErrorCode.TASK_ALREADY_RUNNING]: 'errors.taskAlreadyRunning',
  [ErrorCode.TASK_CANCELLED]: 'errors.taskCancelled',
  [ErrorCode.INITIALIZATION_FAILED]: 'errors.initializationFailed',
  [ErrorCode.UNKNOWN_ERROR]: 'errors.unknownError',
  [ErrorCode.VALIDATION_ERROR]: 'errors.validationError',
};

/**
 * Get user-friendly error message
 * @param code - Error code
 * @param technicalMessage - Technical error message
 * @returns User-friendly message
 */
export function getUserFriendlyMessage(code: ErrorCode, technicalMessage?: string): string {
  const i18nKey = ERROR_CODE_TO_I18N_KEY[code];
  if (i18nKey) {
    return i18n.t(i18nKey);
  }
  return technicalMessage || i18n.t('errors.unknownError');
}

/**
 * Create a network error
 */
export function createNetworkError(
  message: string,
  details?: Record<string, unknown>,
): ExtensionError {
  return new ExtensionError(ErrorCode.NETWORK_ERROR, message, details, true);
}

/**
 * Create an AI error
 */
export function createAIError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
  retryable?: boolean,
): ExtensionError {
  const retryDecision =
    retryable ??
    ([ErrorCode.AI_TIMEOUT, ErrorCode.AI_RATE_LIMIT].includes(code) ? true : undefined);
  return new ExtensionError(code, message, details, retryDecision);
}

/**
 * Create a storage error
 */
export function createStorageError(
  message: string,
  details?: Record<string, unknown>,
): ExtensionError {
  return new ExtensionError(ErrorCode.STORAGE_ERROR, message, details, false);
}

/**
 * Create a configuration error
 */
export function createConfigError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ExtensionError {
  return new ExtensionError(code, message, details, false);
}

/**
 * Create an extraction error
 */
export function createExtractionError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ExtensionError {
  return new ExtensionError(code, message, details, false);
}
