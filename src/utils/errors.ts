import { ICONS, TEXT, RETRY } from '@/config/constants';
import i18n from './i18n';

// interface ErrorConstructorWithCapture removed

/**
 * Error codes for categorizing different types of errors in the extension.
 *
 * These codes are used to:
 * - Identify error types for handling and recovery
 * - Map to localized error messages
 * - Determine if an error is retryable
 */
export enum ErrorCode {
  // Network errors
  /** General network connectivity failure */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** API returned an error response */
  API_ERROR = 'API_ERROR',
  /** Request timed out */
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',

  // AI related errors
  /** AI request timed out */
  AI_TIMEOUT = 'AI_TIMEOUT',
  /** AI API rate limit exceeded */
  AI_RATE_LIMIT = 'AI_RATE_LIMIT',
  /** AI returned invalid/unparseable response */
  AI_INVALID_RESPONSE = 'AI_INVALID_RESPONSE',
  /** AI API quota/credits exhausted */
  AI_QUOTA_EXCEEDED = 'AI_QUOTA_EXCEEDED',
  /** Specified AI model not found */
  AI_MODEL_NOT_FOUND = 'AI_MODEL_NOT_FOUND',

  // Extraction errors
  /** Platform/website not supported */
  PLATFORM_NOT_SUPPORTED = 'PLATFORM_NOT_SUPPORTED',
  /** Comment extraction failed */
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  /** No comments found on page */
  NO_COMMENTS_FOUND = 'NO_COMMENTS_FOUND',
  /** DOM structure analysis failed */
  DOM_ANALYSIS_FAILED = 'DOM_ANALYSIS_FAILED',

  // Storage errors
  /** Chrome storage quota exceeded */
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',
  /** General storage operation error */
  STORAGE_ERROR = 'STORAGE_ERROR',
  /** Failed to read from storage */
  STORAGE_READ_ERROR = 'STORAGE_READ_ERROR',
  /** Failed to write to storage */
  STORAGE_WRITE_ERROR = 'STORAGE_WRITE_ERROR',

  // Configuration errors
  /** Invalid configuration provided */
  INVALID_CONFIG = 'INVALID_CONFIG',
  /** API key is missing or empty */
  MISSING_API_KEY = 'MISSING_API_KEY',
  /** API URL is invalid or missing */
  INVALID_API_URL = 'INVALID_API_URL',
  /** Model configuration is invalid */
  INVALID_MODEL = 'INVALID_MODEL',

  // Task errors
  /** Task with given ID not found */
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  /** A task is already running */
  TASK_ALREADY_RUNNING = 'TASK_ALREADY_RUNNING',
  /** Task was cancelled by user */
  TASK_CANCELLED = 'TASK_CANCELLED',

  // General errors
  /** Unknown/unexpected error */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  /** Input validation failed */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

/**
 * Custom error class for extension-specific errors with additional context.
 *
 * ExtensionError provides:
 * - Error code for categorization
 * - Additional details for debugging
 * - Timestamp for logging
 * - Retryable flag for error handling
 * - JSON serialization for storage/transmission
 *
 * @example
 * ```typescript
 * throw new ExtensionError(
 *   ErrorCode.AI_RATE_LIMIT,
 *   'Rate limit exceeded',
 *   { status: 429, retryAfter: 60 },
 *   true // retryable
 * );
 * ```
 */
export class ExtensionError extends Error {
  /** Error code for categorization */
  public readonly code: ErrorCode;
  /** Additional context details */
  public readonly details?: Record<string, unknown>;
  /** Timestamp when error occurred */
  public readonly timestamp: number;
  /** Whether the operation can be retried */
  public readonly retryable: boolean;

  /**
   * Creates a new ExtensionError.
   * @param code - Error code from ErrorCode enum
   * @param message - Human-readable error message
   * @param details - Optional additional context
   * @param retryable - Whether the operation can be retried (default: false)
   */
  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    retryable: boolean = false,
  ) {
    super(message);
    this.name = 'ExtensionError';
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();
    this.retryable = retryable;

    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, ExtensionError);
    }
  }

  /**
   * Convert error to JSON for logging
   */
  toJSON(): object {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      retryable: this.retryable,
      stack: this.stack,
    };
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    return getUserFriendlyMessage(this.code, this.message);
  }
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: ErrorCode[];
  onRetry?: (attempt: number, error: ExtensionError) => void;
  fallback?: () => Promise<unknown>;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: RETRY.INITIAL_DELAY_MS,
  maxDelay: RETRY.MAX_DELAY_MS,
  backoffMultiplier: 2,
  retryableErrors: [
    ErrorCode.NETWORK_ERROR,
    ErrorCode.AI_TIMEOUT,
    ErrorCode.TIMEOUT_ERROR,
    ErrorCode.API_ERROR,
  ],
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

    // Log error - use dynamic import to avoid circular dependency
    try {
      const { Logger } = await import('./logger.js');
      Logger.error(`[${context}] ${extensionError.code}: ${extensionError.message}`, {
        code: extensionError.code,
        details: extensionError.details,
        stack: extensionError.stack,
      });
    } catch (_importError) {
      // Fallback to console if logger import fails
      // Should be rare, but safe to leave console here as last resort
      console.error(
        `[${context}] ${extensionError.code}: ${extensionError.message}`,
        extensionError,
      );
    }

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

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        try {
          const { Logger } = await import('./logger.js');
          Logger.debug(`[${context}] Attempt ${attempt}/${retryConfig.maxAttempts}`);
        } catch {}

        return await fn();
      } catch (error) {
        lastError = this.normalizeError(error as Error);

        try {
          const { Logger } = await import('./logger.js');
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
        } catch (_importError) {
          console.warn(`[${context}] Attempt ${attempt} failed:`, lastError);

          if (!this.isRetryable(lastError, retryConfig) || attempt === retryConfig.maxAttempts) {
            if (retryConfig.fallback) {
              return (await retryConfig.fallback()) as T;
            }
            throw lastError;
          }
          retryConfig.onRetry?.(attempt, lastError);
        }

        await this.sleep(delay);
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
    if (message.includes('quota') && message.includes('storage')) {
      return ErrorCode.STORAGE_QUOTA_EXCEEDED;
    }
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
    return error.retryable || config.retryableErrors.includes(error.code);
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
      const message = error.getUserMessage();

      await chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL(ICONS.ICON_128),
        title: TEXT.ERROR_TITLE,
        message: message,
        priority: 2,
      });
    } catch (notificationError) {
      try {
        const { Logger } = await import('./logger.js');
        Logger.error('[ErrorHandler] Failed to show notification:', { error: notificationError });
      } catch {
        console.error('[ErrorHandler] Failed to show notification:', notificationError);
      }
    }
  }

  /**
   * Sleep for specified milliseconds
   * @param ms - Milliseconds to sleep
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
  const isRetryable =
    retryable !== undefined
      ? retryable
      : [ErrorCode.AI_TIMEOUT, ErrorCode.AI_RATE_LIMIT].includes(code);
  return new ExtensionError(code, message, details, isRetryable);
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
