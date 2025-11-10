/**
 * Error handling utilities for Comments Insight Extension
 * Provides unified error types, error handling, and retry mechanisms
 */

/**
 * Error codes for different types of errors
 */
export enum ErrorCode {
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  
  // AI related errors
  AI_TIMEOUT = 'AI_TIMEOUT',
  AI_RATE_LIMIT = 'AI_RATE_LIMIT',
  AI_INVALID_RESPONSE = 'AI_INVALID_RESPONSE',
  AI_QUOTA_EXCEEDED = 'AI_QUOTA_EXCEEDED',
  AI_MODEL_NOT_FOUND = 'AI_MODEL_NOT_FOUND',
  
  // Extraction errors
  PLATFORM_NOT_SUPPORTED = 'PLATFORM_NOT_SUPPORTED',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  NO_COMMENTS_FOUND = 'NO_COMMENTS_FOUND',
  DOM_ANALYSIS_FAILED = 'DOM_ANALYSIS_FAILED',
  
  // Storage errors
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',
  STORAGE_ERROR = 'STORAGE_ERROR',
  STORAGE_READ_ERROR = 'STORAGE_READ_ERROR',
  STORAGE_WRITE_ERROR = 'STORAGE_WRITE_ERROR',
  
  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_API_KEY = 'MISSING_API_KEY',
  INVALID_API_URL = 'INVALID_API_URL',
  INVALID_MODEL = 'INVALID_MODEL',
  
  // Task errors
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  TASK_ALREADY_RUNNING = 'TASK_ALREADY_RUNNING',
  TASK_CANCELLED = 'TASK_CANCELLED',
  
  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
}

/**
 * Custom error class for extension-specific errors
 */
export class ExtensionError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: any;
  public readonly timestamp: number;
  public readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    details?: any,
    retryable: boolean = false
  ) {
    super(message);
    this.name = 'ExtensionError';
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();
    this.retryable = retryable;

    // Maintains proper stack trace for where our error was thrown (only available on V8)
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
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
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
  static async handleError(
    error: Error | ExtensionError,
    context: string
  ): Promise<void> {
    const extensionError = this.normalizeError(error);
    
    // Log error - use dynamic import to avoid circular dependency
    try {
      const { Logger } = await import('./logger.js');
      Logger.error(`[${context}] ${extensionError.code}: ${extensionError.message}`, {
        code: extensionError.code,
        details: extensionError.details,
        stack: extensionError.stack,
      });
    } catch (importError) {
      // Fallback to console if logger import fails
      console.error(`[${context}] ${extensionError.code}: ${extensionError.message}`, extensionError);
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
    config: Partial<RetryConfig> = {}
  ): Promise<T> {
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    let lastError: ExtensionError | null = null;
    let delay = retryConfig.initialDelay;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        // Use dynamic import to avoid circular dependency
        try {
          const { Logger } = await import('./logger.js');
          Logger.debug(`[${context}] Attempt ${attempt}/${retryConfig.maxAttempts}`);
        } catch {}
        
        return await fn();
      } catch (error) {
        lastError = this.normalizeError(error as Error);
        
        // Use dynamic import to avoid circular dependency
        try {
          const { Logger } = await import('./logger.js');
          Logger.warn(`[${context}] Attempt ${attempt} failed: ${lastError.message}`, {
            code: lastError.code,
            attempt,
            maxAttempts: retryConfig.maxAttempts,
          });

          // Check if error is retryable
          if (!this.isRetryable(lastError, retryConfig)) {
            Logger.error(`[${context}] Error is not retryable, giving up`, {
              code: lastError.code,
            });
            throw lastError;
          }

          // If this was the last attempt, throw the error
          if (attempt === retryConfig.maxAttempts) {
            Logger.error(`[${context}] Max retry attempts reached, giving up`, {
              attempts: attempt,
            });
            throw lastError;
          }

          // Wait before retrying with exponential backoff
          Logger.debug(`[${context}] Waiting ${delay}ms before retry...`);
        } catch (importError) {
          // Fallback to console if logger import fails
          console.warn(`[${context}] Attempt ${attempt} failed:`, lastError);
          
          if (!this.isRetryable(lastError, retryConfig) || attempt === retryConfig.maxAttempts) {
            throw lastError;
          }
        }
        
        await this.sleep(delay);
        delay = Math.min(delay * retryConfig.backoffMultiplier, retryConfig.maxDelay);
      }
    }

    // This should never be reached, but TypeScript needs it
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
      retryable
    );
  }

  /**
   * Infer error code from error message or type
   * @param error - Error to analyze
   * @returns Inferred error code
   */
  private static inferErrorCode(error: Error): ErrorCode {
    const message = error.message.toLowerCase();

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
      ErrorCode.PERMISSION_DENIED,
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
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: 'Comments Insight Error',
        message: message,
        priority: 2,
      });
    } catch (notificationError) {
      // Silently fail if notifications are not available
      console.error('[ErrorHandler] Failed to show notification:', notificationError);
    }
  }

  /**
   * Sleep for specified milliseconds
   * @param ms - Milliseconds to sleep
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Get user-friendly error message
 * @param code - Error code
 * @param technicalMessage - Technical error message
 * @returns User-friendly message
 */
export function getUserFriendlyMessage(code: ErrorCode, technicalMessage: string): string {
  const messages: Record<ErrorCode, string> = {
    [ErrorCode.NETWORK_ERROR]: 'Network connection failed. Please check your internet connection and try again.',
    [ErrorCode.API_ERROR]: 'API request failed. Please check your API configuration.',
    [ErrorCode.TIMEOUT_ERROR]: 'Request timed out. Please try again.',
    
    [ErrorCode.AI_TIMEOUT]: 'AI request timed out. The model may be overloaded. Please try again.',
    [ErrorCode.AI_RATE_LIMIT]: 'Rate limit exceeded. Please wait a moment before trying again.',
    [ErrorCode.AI_INVALID_RESPONSE]: 'AI returned an invalid response. Please try again or use a different model.',
    [ErrorCode.AI_QUOTA_EXCEEDED]: 'API quota exceeded. Please check your API account or try again later.',
    [ErrorCode.AI_MODEL_NOT_FOUND]: 'The selected AI model was not found. Please check your model configuration.',
    
    [ErrorCode.PLATFORM_NOT_SUPPORTED]: 'This platform is not supported yet.',
    [ErrorCode.EXTRACTION_FAILED]: 'Failed to extract comments. The page structure may have changed.',
    [ErrorCode.NO_COMMENTS_FOUND]: 'No comments found on this page.',
    [ErrorCode.DOM_ANALYSIS_FAILED]: 'Failed to analyze page structure. Please try again.',
    
    [ErrorCode.STORAGE_QUOTA_EXCEEDED]: 'Storage quota exceeded. Please delete some history items to free up space.',
    [ErrorCode.STORAGE_ERROR]: 'Storage operation failed. Please try again.',
    [ErrorCode.STORAGE_READ_ERROR]: 'Failed to read from storage. Please try again.',
    [ErrorCode.STORAGE_WRITE_ERROR]: 'Failed to write to storage. Please try again.',
    
    [ErrorCode.INVALID_CONFIG]: 'Invalid configuration. Please check your settings.',
    [ErrorCode.MISSING_API_KEY]: 'API key is missing. Please configure your API key in settings.',
    [ErrorCode.INVALID_API_URL]: 'Invalid API URL. Please check your API configuration.',
    [ErrorCode.INVALID_MODEL]: 'Invalid model configuration. Please check your model settings.',
    
    [ErrorCode.TASK_NOT_FOUND]: 'Task not found. It may have been cancelled or completed.',
    [ErrorCode.TASK_ALREADY_RUNNING]: 'A task is already running. Please wait for it to complete.',
    [ErrorCode.TASK_CANCELLED]: 'Task was cancelled.',
    
    [ErrorCode.UNKNOWN_ERROR]: technicalMessage || 'An unknown error occurred. Please try again.',
    [ErrorCode.VALIDATION_ERROR]: 'Validation failed. Please check your input.',
    [ErrorCode.PERMISSION_DENIED]: 'Permission denied. Please check extension permissions.',
  };

  return messages[code] || technicalMessage || 'An error occurred.';
}

/**
 * Create a network error
 */
export function createNetworkError(message: string, details?: any): ExtensionError {
  return new ExtensionError(ErrorCode.NETWORK_ERROR, message, details, true);
}

/**
 * Create an AI error
 */
export function createAIError(code: ErrorCode, message: string, details?: any): ExtensionError {
  const retryable = [ErrorCode.AI_TIMEOUT, ErrorCode.AI_RATE_LIMIT].includes(code);
  return new ExtensionError(code, message, details, retryable);
}

/**
 * Create a storage error
 */
export function createStorageError(message: string, details?: any): ExtensionError {
  return new ExtensionError(ErrorCode.STORAGE_ERROR, message, details, false);
}

/**
 * Create a configuration error
 */
export function createConfigError(code: ErrorCode, message: string, details?: any): ExtensionError {
  return new ExtensionError(code, message, details, false);
}

/**
 * Create an extraction error
 */
export function createExtractionError(code: ErrorCode, message: string, details?: any): ExtensionError {
  return new ExtensionError(code, message, details, false);
}
