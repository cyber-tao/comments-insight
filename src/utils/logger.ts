/**
 * Structured logging system for Comments Insight Extension
 * Provides different log levels and environment-aware logging
 */

import { LOG_PREFIX, STORAGE, DEFAULTS, LOG_LEVELS } from '@/config/constants';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogEntry {
  level: LogLevel;
  timestamp: number;
  message: string;
  context?: string;
  data?: Record<string, unknown>;
  stack?: string;
}

export interface LoggerConfig {
  minLevel: LogLevel;
  enableConsole: boolean;
  enableStorage: boolean;
  maxStoredLogs: number;
}

export interface LogFilter {
  level?: LogLevel;
  levels?: LogLevel[];
  startTime?: number;
  endTime?: number;
  context?: string;
  search?: string;
  limit?: number;
}

export type ExportFormat = 'json' | 'csv' | 'text';

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
      this.config.enableStorage = true;
    }

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[STORAGE.LOG_LEVEL_KEY]) {
          const nv = changes[STORAGE.LOG_LEVEL_KEY].newValue as string | undefined;
          if (nv && (LOG_LEVELS as readonly string[]).includes(nv)) {
            this.config.minLevel = nv as LogLevel;
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
      const stored = await chrome.storage.local.get(STORAGE.LOG_LEVEL_KEY);
      const val = stored[STORAGE.LOG_LEVEL_KEY] as string | undefined;
      if (val && (LOG_LEVELS as readonly string[]).includes(val)) {
        this.config.minLevel = val as LogLevel;
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

  private static async logToStorage(entry: LogEntry): Promise<void> {
    try {
      const logKey = `${LOG_PREFIX.SYSTEM}${entry.level.toLowerCase()}_${entry.timestamp}`;
      await chrome.storage.local.set({
        [logKey]: entry,
      });
      await this.cleanupOldLogs();
    } catch (error) {
      console.error('[Logger] Storage error:', error);
    }
  }

  private static async cleanupOldLogs(): Promise<void> {
    try {
      const storage = await chrome.storage.local.get(null);
      const logKeys = Object.keys(storage).filter((key) => key.startsWith('log_'));

      if (logKeys.length > this.config.maxStoredLogs) {
        logKeys.sort();
        const toRemove = logKeys.slice(0, logKeys.length - this.config.maxStoredLogs);
        await chrome.storage.local.remove(toRemove);
      }
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
      const storage = await chrome.storage.local.get(null);
      const logKeys = Object.keys(storage).filter((key) => key.startsWith('log_'));
      await chrome.storage.local.remove(logKeys);
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
