/**
 * Structured logging system for Comments Insight Extension
 * Provides different log levels and environment-aware logging
 */

import { LOG_PREFIX, STORAGE, DEFAULTS, LOG_LEVELS } from '@/config/constants';

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Log entry structure
 */
export interface LogEntry {
  level: LogLevel;
  timestamp: number;
  message: string;
  context?: string;
  data?: any;
  stack?: string;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  minLevel: LogLevel;
  enableConsole: boolean;
  enableStorage: boolean;
  maxStoredLogs: number;
}

/**
 * Logger class for structured logging
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

  /**
   * Initialize logger with environment detection
   */
  static async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Detect environment - in development, manifest will have a specific version pattern
    try {
      const manifest = chrome.runtime.getManifest();
      // Development builds typically have version like "0.0.0" or include "dev"
      this.isDevelopment =
        manifest.version === '0.0.0' ||
        manifest.version.includes('dev') ||
        !('update_url' in manifest); // No update_url means not from store
    } catch (error) {
      // If we can't detect, assume production for safety
      this.isDevelopment = false;
    }

    // Configure based on environment
    if (this.isDevelopment) {
      this.config.minLevel = LogLevel.DEBUG;
      this.config.enableConsole = true;
      this.config.enableStorage = true;
    } else {
      this.config.minLevel = LogLevel.ERROR;
      this.config.enableConsole = true;
      this.config.enableStorage = true;
    }
    try {
      const stored = await chrome.storage.local.get(STORAGE.LOG_LEVEL_KEY);
      const val = stored[STORAGE.LOG_LEVEL_KEY];
      if (val && (LOG_LEVELS as readonly string[]).includes(val)) {
        this.config.minLevel = val as LogLevel;
      }
    } catch {}
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE.LOG_LEVEL_KEY]) {
          const nv = changes[STORAGE.LOG_LEVEL_KEY].newValue;
          if (nv && (LOG_LEVELS as readonly string[]).includes(nv)) {
            this.config.minLevel = nv as LogLevel;
          }
        }
      });
    } catch {}
    this.initialized = true;
    this.info('[Logger] Initialized', {
      environment: this.isDevelopment ? 'development' : 'production',
      config: this.config,
    });
  }

  /**
   * Configure logger
   * @param config - Partial configuration to merge
   */
  static configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  static getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * Check if development mode
   */
  static isDev(): boolean {
    return this.isDevelopment;
  }

  /**
   * Log debug message
   * @param message - Log message
   * @param data - Additional data
   */
  static debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log info message
   * @param message - Log message
   * @param data - Additional data
   */
  static info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log warning message
   * @param message - Log message
   * @param data - Additional data
   */
  static warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Log error message
   * @param message - Log message
   * @param data - Additional data (can include error object)
   */
  static error(message: string, data?: any): void {
    this.log(LogLevel.ERROR, message, data);
  }

  static async setMinLevel(level: LogLevel): Promise<void> {
    this.config.minLevel = level;
    try {
      await chrome.storage.local.set({ [STORAGE.LOG_LEVEL_KEY]: level });
    } catch {}
  }

  /**
   * Core logging function
   * @param level - Log level
   * @param message - Log message
   * @param data - Additional data
   */
  private static log(level: LogLevel, message: string, data?: any): void {
    // Ensure initialized
    if (!this.initialized) {
      this.initialize().catch(console.error);
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
    if (level === LogLevel.ERROR && data?.stack) {
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

  /**
   * Check if log level should be recorded
   * @param level - Log level to check
   * @returns True if should log
   */
  private static shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevelIndex = levels.indexOf(this.config.minLevel);
    const logLevelIndex = levels.indexOf(level);
    return logLevelIndex >= currentLevelIndex;
  }

  /**
   * Log to console with appropriate styling
   * @param entry - Log entry
   */
  private static logToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const prefix = `[${timestamp}] [${entry.level}]`;
    const message = `${prefix} ${entry.message}`;

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(message, entry.data || '');
        break;
      case LogLevel.INFO:
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

  /**
   * Save log to chrome.storage.local
   * @param entry - Log entry
   */
  private static async logToStorage(entry: LogEntry): Promise<void> {
    try {
      // Create storage key
      const logKey = `${LOG_PREFIX.SYSTEM}${entry.level.toLowerCase()}_${entry.timestamp}`;

      // Save log entry
      await chrome.storage.local.set({
        [logKey]: entry,
      });

      // Clean up old logs if needed
      await this.cleanupOldLogs();
    } catch (error) {
      // Don't log storage errors to avoid infinite loop
      console.error('[Logger] Storage error:', error);
    }
  }

  /**
   * Clean up old logs to maintain storage limit
   */
  private static async cleanupOldLogs(): Promise<void> {
    try {
      const storage = await chrome.storage.local.get(null);
      const logKeys = Object.keys(storage).filter((key) => key.startsWith('log_'));

      if (logKeys.length > this.config.maxStoredLogs) {
        // Sort by timestamp (embedded in key)
        logKeys.sort();

        // Remove oldest logs
        const toRemove = logKeys.slice(0, logKeys.length - this.config.maxStoredLogs);
        await chrome.storage.local.remove(toRemove);
      }
    } catch (error) {
      console.error('[Logger] Cleanup error:', error);
    }
  }

  /**
   * Get all stored logs
   * @param level - Optional filter by level
   * @param limit - Maximum number of logs to return
   * @returns Array of log entries
   */
  static async getLogs(level?: LogLevel, limit?: number): Promise<LogEntry[]> {
    try {
      const storage = await chrome.storage.local.get(null);
      let logs = Object.entries(storage)
        .filter(([key]) => key.startsWith('log_'))
        .map(([_, value]) => value as LogEntry)
        .sort((a, b) => b.timestamp - a.timestamp); // Newest first

      // Filter by level if specified
      if (level) {
        logs = logs.filter((log) => log.level === level);
      }

      // Limit results if specified
      if (limit) {
        logs = logs.slice(0, limit);
      }

      return logs;
    } catch (error) {
      console.error('[Logger] Failed to get logs:', error);
      return [];
    }
  }

  /**
   * Clear all stored logs
   */
  static async clearLogs(): Promise<void> {
    try {
      const storage = await chrome.storage.local.get(null);
      const logKeys = Object.keys(storage).filter((key) => key.startsWith('log_'));
      await chrome.storage.local.remove(logKeys);
      this.info('[Logger] All logs cleared');
    } catch (error) {
      console.error('[Logger] Failed to clear logs:', error);
      throw error;
    }
  }

  /**
   * Export logs as JSON
   * @param level - Optional filter by level
   * @returns JSON string of logs
   */
  static async exportLogs(level?: LogLevel): Promise<string> {
    const logs = await this.getLogs(level);
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Get log statistics
   * @returns Statistics about stored logs
   */
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

// Auto-initialize logger
Logger.initialize().catch(console.error);
