/**
 * ErrorCode and ExtensionError only - intentionally free of runtime imports
 * so content scripts can use typed errors without dragging i18next (and the
 * locale bundles) into every page. User-facing messages live in errors.ts.
 */

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
  /** Extension startup or migration failed */
  INITIALIZATION_FAILED = 'INITIALIZATION_FAILED',
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
export interface ExtensionErrorPayload {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export class ExtensionError extends Error {
  /** Error code for categorization */
  public readonly code: ErrorCode;
  /** Additional context details */
  public readonly details?: Record<string, unknown>;
  /** Timestamp when error occurred */
  public readonly timestamp: number;
  /** Whether the operation can be retried */
  public readonly retryable: boolean;
  public readonly retryableWasExplicit: boolean;

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
    retryable?: boolean,
  ) {
    super(message);
    this.name = 'ExtensionError';
    this.code = code;
    this.details = details;
    this.timestamp = Date.now();
    this.retryable = retryable ?? false;
    this.retryableWasExplicit = retryable !== undefined;

    const ErrorWithStack = Error as { captureStackTrace?: (target: object, ctor: unknown) => void };
    if (typeof ErrorWithStack.captureStackTrace === 'function') {
      ErrorWithStack.captureStackTrace(this, ExtensionError);
    }
  }
}

const ERROR_CODE_VALUES = new Set<string>(Object.values(ErrorCode));

export function toExtensionErrorPayload(error: unknown): ExtensionErrorPayload {
  if (error instanceof ExtensionError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: ErrorCode.UNKNOWN_ERROR,
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

export function isExtensionErrorPayload(value: unknown): value is ExtensionErrorPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<ExtensionErrorPayload>;
  return (
    typeof candidate.code === 'string' &&
    ERROR_CODE_VALUES.has(candidate.code) &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean'
  );
}

export function fromExtensionErrorPayload(value: unknown): Error {
  if (isExtensionErrorPayload(value)) {
    return new ExtensionError(value.code, value.message, undefined, value.retryable);
  }
  return new Error(typeof value === 'string' ? value : 'Unknown extension error');
}
