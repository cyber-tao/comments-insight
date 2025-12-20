/**
 * Structured logging system for Comments Insight Extension.
 *
 * Provides:
 * - Multiple log levels (DEBUG, INFO, WARN, ERROR)
 * - Environment-aware logging (development vs production)
 * - Optional storage persistence for debugging
 * - Log filtering and export capabilities
 *
 * @example
 * ```typescript
 * Logger.info('[MyModule] Operation completed', { count: 10 });
 * Logger.error('[MyModule] Operation failed', { error });
 * ```
 */

import { LOG_PREFIX, STORAGE, DEFAULTS, LOG_LEVELS } from '@/config/constants';

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
 * Filter options for querying stored logs.
 */
export interface LogFilter {
  /** Filter by single level */
  level?: LogLevel;
  /** Filter by multiple levels */
  levels?: LogLevel[];
  /** Filter logs after this timestamp */
  startTime?: number;
  /** Filter logs before this timestamp */
  endTime?: number;
  /** Filter by context string */
  context?: string;
  /** Search in message text */
  search?: string;
  /** Maximum number of results */
  limit?: number;
}

/** Supported export formats for logs */
export type ExportFormat = 'json' | 'csv' | 'text';

/**
 * Static logger class for application-wide logging.
 *
 * The logger automatically adjusts behavior based on environment:
 * - Development: DEBUG level, console + storage enabled
 * - Production: ERROR level only, console enabled
 *
 * @example
 * ```typescript
 * // Basic logging
 * Logger.debug('[Module] Debug message');
 * Logger.info('[Module] Info message', { key: 'value' });
 * Logger.warn('[Module] Warning message');
 * Logger.error('[Module] Error message', { error });
 *
 * // Query stored logs
 * const logs = await Logger.getLogs({ level: LogLevel.ERROR, limit: 10 });
 *
 * // Export logs
 * const json = await Logger.exportLogs('json');
 * ```
 */
export class Logger {
  private static config: LoggerConfig = {
    minLevel: LogLevel.INFO,
    enableConsole: true,
    enableStorage: false,
    maxStoredLogs: DEFAULTS.LOGS_MAX_STORED,
  };

  private static isDevelopment = false;
  private static initialized = false;
  private static storageConfigLoaded = false;

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
      this.config.enableStorage = true;
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
      this.loadStorageConfig().catch((error) => {
        console.warn('[Logger] Failed to load storage config during log call:', error);
      });
    }

    // Check if this log level should be recorded
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      level,
      timestamp: Date.now(),
      message,
      data,
    };

    // Add stack trace for errors
    if (level === LogLevel.ERROR && data?.stack && typeof data.stack === 'string') {
      entry.stack = data.stack;
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
      const logKey = `${LOG_PREFIX.SYSTEM}${entry.level.toLowerCase()}_${entry.timestamp}`;
      await chrome.storage.local.set({
        [logKey]: entry,
      });
      void this.appendSystemLogKey(logKey);
    } catch (error) {
      console.error('[Logger] Storage error:', error);
    }
  }

  private static async getSystemLogIndex(): Promise<string[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE.SYSTEM_LOG_INDEX_KEY);
      const index = result[STORAGE.SYSTEM_LOG_INDEX_KEY] as string[] | undefined;
      return Array.isArray(index) ? index : [];
    } catch {
      return [];
    }
  }

  private static async setSystemLogIndex(index: string[]): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE.SYSTEM_LOG_INDEX_KEY]: index });
    } catch {
      return;
    }
  }

  private static async appendSystemLogKey(logKey: string): Promise<void> {
    try {
      const index = await this.getSystemLogIndex();
      const next = index.includes(logKey) ? index : [...index, logKey];

      if (next.length > this.config.maxStoredLogs) {
        const toRemove = next.slice(0, next.length - this.config.maxStoredLogs);
        const kept = next.slice(next.length - this.config.maxStoredLogs);
        await chrome.storage.local.remove(toRemove);
        await this.setSystemLogIndex(kept);
        return;
      }

      await this.setSystemLogIndex(next);
    } catch (error) {
      console.error('[Logger] Cleanup error:', error);
    }
  }

  static async getLogs(level?: LogLevel, limit?: number): Promise<LogEntry[]> {
    return this.getLogsFiltered({ level, limit });
  }

  static async getLogsFiltered(filter: LogFilter = {}): Promise<LogEntry[]> {
    try {
      const storage = await chrome.storage.local.get(null);
      let logs = Object.entries(storage)
        .filter(([key]) => key.startsWith('log_'))
        .map(([, value]) => value as LogEntry)
        .sort((a, b) => b.timestamp - a.timestamp);

      if (filter.level) {
        logs = logs.filter((log) => log.level === filter.level);
      }

      if (filter.levels && filter.levels.length > 0) {
        logs = logs.filter((log) => filter.levels!.includes(log.level));
      }

      if (filter.startTime) {
        logs = logs.filter((log) => log.timestamp >= filter.startTime!);
      }

      if (filter.endTime) {
        logs = logs.filter((log) => log.timestamp <= filter.endTime!);
      }

      if (filter.context) {
        logs = logs.filter((log) => log.context?.includes(filter.context!));
      }

      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        logs = logs.filter(
          (log) =>
            log.message.toLowerCase().includes(searchLower) ||
            JSON.stringify(log.data || {})
              .toLowerCase()
              .includes(searchLower),
        );
      }

      if (filter.limit) {
        logs = logs.slice(0, filter.limit);
      }

      return logs;
    } catch (error) {
      console.error('[Logger] Failed to get logs:', error);
      return [];
    }
  }

  static async clearLogs(): Promise<void> {
    try {
      const index = await this.getSystemLogIndex();
      if (index.length > 0) {
        const keys = [...index];
        keys.push(STORAGE.SYSTEM_LOG_INDEX_KEY);
        await chrome.storage.local.remove(keys);
      } else {
        const storage = await chrome.storage.local.get(null);
        const logKeys = Object.keys(storage).filter((key) => key.startsWith('log_'));

        if (logKeys.length > 0) {
          await chrome.storage.local.remove(logKeys);
        }

        await chrome.storage.local.remove([STORAGE.SYSTEM_LOG_INDEX_KEY]);
      }
      this.info('[Logger] All logs cleared');
    } catch (error) {
      console.error('[Logger] Failed to clear logs:', error);
      throw error;
    }
  }

  static async exportLogs(filter?: LogFilter, format: ExportFormat = 'json'): Promise<string> {
    const logs = await this.getLogsFiltered(filter || {});

    switch (format) {
      case 'csv':
        return this.formatLogsAsCsv(logs);
      case 'text':
        return this.formatLogsAsText(logs);
      case 'json':
      default:
        return JSON.stringify(logs, null, 2);
    }
  }

  private static formatLogsAsCsv(logs: LogEntry[]): string {
    const headers = ['timestamp', 'level', 'context', 'message', 'data'];
    const rows = logs.map((log) => [
      new Date(log.timestamp).toISOString(),
      log.level,
      log.context || '',
      `"${(log.message || '').replace(/"/g, '""')}"`,
      `"${JSON.stringify(log.data || {}).replace(/"/g, '""')}"`,
    ]);
    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  }

  private static formatLogsAsText(logs: LogEntry[]): string {
    return logs
      .map((log) => {
        const time = new Date(log.timestamp).toISOString();
        const ctx = log.context ? `[${log.context}] ` : '';
        const data = log.data ? ` | ${JSON.stringify(log.data)}` : '';
        return `[${time}] [${log.level}] ${ctx}${log.message}${data}`;
      })
      .join('\n');
  }

  static async getLogStats(): Promise<{
    total: number;
    byLevel: Record<LogLevel, number>;
    oldestTimestamp: number;
    newestTimestamp: number;
  }> {
    const logs = await this.getLogs();

    const stats = {
      total: logs.length,
      byLevel: {
        [LogLevel.DEBUG]: 0,
        [LogLevel.INFO]: 0,
        [LogLevel.WARN]: 0,
        [LogLevel.ERROR]: 0,
      },
      oldestTimestamp: logs.length > 0 ? logs[logs.length - 1].timestamp : 0,
      newestTimestamp: logs.length > 0 ? logs[0].timestamp : 0,
    };

    logs.forEach((log) => {
      stats.byLevel[log.level]++;
    });

    return stats;
  }
}

Logger.initialize().catch((error) => {
  console.warn('[Logger] Failed to initialize logger:', error);
});
