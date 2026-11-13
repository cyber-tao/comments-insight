/**
 * Structured logging system for Comments Insight Extension.
 *
 * Provides:
 * - Multiple log levels (DEBUG, INFO, WARN, ERROR)
 * - Environment-aware logging (development vs production)
 * - Optional storage persistence for debugging
 *
 * @example
 * ```typescript
 * Logger.info('[MyModule] Operation completed', { count: 10 });
 * Logger.error('[MyModule] Operation failed', { error });
 * ```
 */

import { STORAGE, LOG_DEFAULTS, LOG_LEVELS, MESSAGES } from '@/config/constants';
import { sanitizeLogObject, sanitizeLogText } from './log-sanitize';

interface StoredSettings {
  developerMode?: boolean;
}

/**
 * Log level enumeration for filtering and categorization.
 */
export enum LogLevel {
  /** Detailed debugging information */
  DEBUG = 'DEBUG',
  /** General informational messages */
  INFO = 'INFO',
  /** Warning messages for potential issues */
  WARN = 'WARN',
  /** Error messages for failures */
  ERROR = 'ERROR',
}

/**
 * Structure of a stored log entry.
 */
export interface LogEntry {
  /** Log level */
  level: LogLevel;
  /** Unix timestamp when log was created */
  timestamp: number;
  /** Log message */
  message: string;
  /** Optional context identifier (e.g., module name) */
  context?: string;
  /** Optional structured data */
  data?: Record<string, unknown>;
  /** Optional stack trace for errors */
  stack?: string;
}

/**
 * Logger configuration options.
 */
export interface LoggerConfig {
  /** Minimum level to log (logs below this are ignored) */
  minLevel: LogLevel;
  /** Whether to output to console */
  enableConsole: boolean;
  /** Whether to persist logs to storage */
  enableStorage: boolean;
  /** Maximum number of logs to store */
  maxStoredLogs: number;
}

/**
 * Static logger class for application-wide logging.
 *
 * The logger automatically adjusts behavior based on environment:
 * - Development: DEBUG level, console + storage enabled
 * - Production: ERROR level only, console enabled
 *
 * @example
 * ```typescript
 * Logger.debug('[Module] Debug message');
 * Logger.info('[Module] Info message', { key: 'value' });
 * Logger.warn('[Module] Warning message');
 * Logger.error('[Module] Error message', { error });
 * ```
 */
export class Logger {
  private static config: LoggerConfig = {
    minLevel: LogLevel.INFO,
    enableConsole: true,
    enableStorage: false,
    maxStoredLogs: LOG_DEFAULTS.LOGS_MAX_STORED,
  };

  private static isDevelopment = false;
  private static initialized = false;
  private static storageConfigLoaded = false;
  private static storageWriter?: (entry: LogEntry) => Promise<void>;

  static setStorageWriter(writer: (entry: LogEntry) => Promise<void>): void {
    this.storageWriter = writer;
  }

  private static initializeSync(): void {
    if (this.initialized) {
      return;
    }

    try {
      const manifest = chrome.runtime.getManifest();
      this.isDevelopment =
        manifest.version === '0.0.0' ||
        manifest.version.includes('dev') ||
        !('update_url' in manifest);
    } catch {
      this.isDevelopment = false;
    }

    if (this.isDevelopment) {
      this.config.minLevel = LogLevel.DEBUG;
      this.config.enableConsole = true;
      this.config.enableStorage = false;
    } else {
      this.config.minLevel = LogLevel.ERROR;
      this.config.enableConsole = true;
      this.config.enableStorage = false;
    }

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          if (changes[STORAGE.LOG_LEVEL_KEY]) {
            const nv = changes[STORAGE.LOG_LEVEL_KEY].newValue as string | undefined;
            if (nv && (LOG_LEVELS as readonly string[]).includes(nv)) {
              this.config.minLevel = nv as LogLevel;
            }
          }
          if (changes[STORAGE.SETTINGS_KEY]) {
            const settings = changes[STORAGE.SETTINGS_KEY].newValue as StoredSettings | undefined;
            if (settings !== undefined) {
              this.config.enableStorage = settings.developerMode === true;
            }
          }
        }
      });
    } catch {
      // Storage API not available
    }

    this.initialized = true;
  }

  private static async loadStorageConfig(): Promise<void> {
    if (this.storageConfigLoaded) {
      return;
    }

    try {
      const stored = await chrome.storage.local.get([STORAGE.LOG_LEVEL_KEY, STORAGE.SETTINGS_KEY]);
      const val = stored[STORAGE.LOG_LEVEL_KEY] as string | undefined;
      if (val && (LOG_LEVELS as readonly string[]).includes(val)) {
        this.config.minLevel = val as LogLevel;
      }
      const settings = stored[STORAGE.SETTINGS_KEY] as StoredSettings | undefined;
      if (settings !== undefined) {
        this.config.enableStorage = settings.developerMode === true;
      }
      this.storageConfigLoaded = true;
    } catch {
      // Storage not available
    }
  }

  static async initialize(): Promise<void> {
    this.initializeSync();
    await this.loadStorageConfig();
    this.info('[Logger] Initialized', {
      environment: this.isDevelopment ? 'development' : 'production',
      config: this.config,
    });
  }

  static configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  static getConfig(): LoggerConfig {
    return { ...this.config };
  }

  static isDev(): boolean {
    return this.isDevelopment;
  }

  static debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  static info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, data);
  }

  static warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, data);
  }

  static error(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, data);
  }

  static async setMinLevel(level: LogLevel): Promise<void> {
    this.config.minLevel = level;
    try {
      await chrome.storage.local.set({ [STORAGE.LOG_LEVEL_KEY]: level });
    } catch {
      // Storage not available
    }
  }

  private static log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.initialized) {
      this.initializeSync();
    }

    // Check the level before any async work so dropped logs (the common case
    // on content-script pages, where production defaults to ERROR) never
    // trigger a storage roundtrip.
    if (!this.shouldLog(level)) {
      return;
    }

    if (!this.storageConfigLoaded) {
      this.loadStorageConfig().catch((error) => {
        console.warn('[Logger] Failed to load storage config during log call:', error);
      });
    }

    const sanitizedMessage = this.sanitize(message);
    const sanitizedData = data ? this.sanitizeObject(data) : undefined;

    const entry: LogEntry = {
      level,
      timestamp: Date.now(),
      message: sanitizedMessage,
      data: sanitizedData,
    };

    // Add stack trace for errors
    if (
      level === LogLevel.ERROR &&
      sanitizedData?.stack &&
      typeof sanitizedData.stack === 'string'
    ) {
      entry.stack = sanitizedData.stack;
    }

    // Console output
    if (this.config.enableConsole) {
      this.logToConsole(entry);
    }

    // Storage output (async, don't wait)
    if (this.config.enableStorage) {
      this.logToStorage(entry).catch((err) => {
        console.error('[Logger] Failed to save log to storage:', err);
      });
    }
  }

  private static shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevelIndex = levels.indexOf(this.config.minLevel);
    const logLevelIndex = levels.indexOf(level);
    return logLevelIndex >= currentLevelIndex;
  }

  private static sanitize(text: string): string {
    return sanitizeLogText(text);
  }

  private static sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
    return sanitizeLogObject(obj);
  }

  private static logToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const prefix = `[${timestamp}] [${entry.level}]`;
    const message = `${prefix} ${entry.message}`;

    switch (entry.level) {
      case LogLevel.DEBUG:
        // eslint-disable-next-line no-console
        console.debug(message, entry.data || '');
        break;
      case LogLevel.INFO:
        // eslint-disable-next-line no-console
        console.info(message, entry.data || '');
        break;
      case LogLevel.WARN:
        console.warn(message, entry.data || '');
        break;
      case LogLevel.ERROR:
        console.error(message, entry.data || '');
        if (entry.stack) {
          console.error('Stack trace:', entry.stack);
        }
        break;
    }
  }

  private static async logToStorage(entry: LogEntry): Promise<void> {
    try {
      if (this.storageWriter) {
        await this.storageWriter(entry);
      } else {
        await chrome.runtime.sendMessage({ type: MESSAGES.APPEND_SYSTEM_LOG, payload: { entry } });
      }
    } catch (error) {
      console.error('[Logger] Storage error:', sanitizeLogText(String(error)));
    }
  }
}

Logger.initialize().catch((error) => {
  console.warn('[Logger] Failed to initialize logger:', error);
});
