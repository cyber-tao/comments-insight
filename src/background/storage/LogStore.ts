import { STORAGE, LOG_DEFAULTS, LIMITS, TEXT, LOG_PREFIX } from '@/config/constants';
import type { LogEntry } from '@/utils/logger';
import { Mutex } from '@/utils/promise';
import { sanitizeLogText, sanitizeLogObject } from '@/utils/log-sanitize';
import { sanitizeStringIndex, type StoredAiLogEntry } from '@/utils/storage-validation';

export class LogStore {
  private logMutex = new Mutex();

  private truncateLogField(value: string): string {
    if (value.length <= LIMITS.AI_LOG_MAX_FIELD_LENGTH) {
      return value;
    }

    const maxLengthWithoutSuffix = Math.max(
      0,
      LIMITS.AI_LOG_MAX_FIELD_LENGTH - TEXT.PREVIEW_SUFFIX.length,
    );
    return value.slice(0, maxLengthWithoutSuffix) + TEXT.PREVIEW_SUFFIX;
  }

  private sanitizeLogEntry(entry: StoredAiLogEntry): StoredAiLogEntry {
    return {
      ...entry,
      prompt: this.truncateLogField(sanitizeLogText(entry.prompt)),
      response: this.truncateLogField(sanitizeLogText(entry.response)),
    };
  }

  async saveAiLog(
    logKey: string,
    entry: { type: 'extraction' | 'analysis'; timestamp: number; prompt: string; response: string },
  ): Promise<void> {
    try {
      await this.appendLog(logKey, this.sanitizeLogEntry(entry), 'ai');
    } catch (error) {
      console.warn('[LogStore] Failed to save AI log', sanitizeLogText(String(error)));
    }
  }

  async saveSystemLog(entry: LogEntry): Promise<void> {
    const key = `${LOG_PREFIX.SYSTEM}${entry.level.toLowerCase()}_${entry.timestamp}_${crypto.randomUUID()}`;
    const sanitized = {
      ...entry,
      message: sanitizeLogText(entry.message),
      ...(entry.data ? { data: sanitizeLogObject(entry.data) } : {}),
      ...(entry.stack ? { stack: sanitizeLogText(entry.stack) } : {}),
    };
    await this.appendLog(key, sanitized, 'system');
  }

  private indexKey(kind: 'ai' | 'system'): string {
    return kind === 'ai' ? STORAGE.AI_LOG_INDEX_KEY : STORAGE.SYSTEM_LOG_INDEX_KEY;
  }

  private async appendLog(
    logKey: string,
    entry: StoredAiLogEntry | LogEntry,
    kind: 'ai' | 'system',
  ): Promise<void> {
    return this.logMutex.withLock(async () => {
      const indexKey = this.indexKey(kind);
      const stored = await chrome.storage.local.get(indexKey);
      const index = [...new Set(sanitizeStringIndex(stored[indexKey]))].filter(
        (key) => key !== logKey,
      );
      const next = [...index, logKey];
      const rows = {
        ...(index.length ? await chrome.storage.local.get(index) : {}),
        [logKey]: entry,
      };
      const maxCount =
        kind === 'ai' ? LOG_DEFAULTS.AI_LOGS_MAX_STORED : LOG_DEFAULTS.LOGS_MAX_STORED;
      let chars = next.reduce((sum, key) => sum + JSON.stringify(rows[key] ?? null).length, 0);
      const removed: string[] = [];
      while (next.length > maxCount || (kind === 'ai' && chars > LIMITS.AI_LOG_TOTAL_CHAR_BUDGET)) {
        const key = next.shift()!;
        chars -= JSON.stringify(rows[key] ?? null).length;
        removed.push(key);
      }
      await chrome.storage.local.set({ [logKey]: entry, [indexKey]: next });
      if (removed.length) await chrome.storage.local.remove(removed);
    });
  }

  async deleteLog(key: string, kind: 'ai' | 'system'): Promise<void> {
    const prefix = kind === 'ai' ? LOG_PREFIX.AI : LOG_PREFIX.SYSTEM;
    if (!key.startsWith(prefix) || key === this.indexKey(kind) || key === STORAGE.LOG_LEVEL_KEY) {
      throw new Error('Invalid log key');
    }
    return this.logMutex.withLock(async () => {
      const indexKey = this.indexKey(kind);
      const stored = await chrome.storage.local.get(indexKey);
      await chrome.storage.local.set({
        [indexKey]: sanitizeStringIndex(stored[indexKey]).filter((item) => item !== key),
      });
      await chrome.storage.local.remove([key]);
    });
  }

  async clearLogs(kind: 'ai' | 'system' | 'all' = 'all'): Promise<void> {
    return this.logMutex.withLock(async () => {
      // Explicit user cleanup also removes records orphaned by older versions.
      const stored = await chrome.storage.local.get(null);
      const keys = Object.keys(stored).filter(
        (key) =>
          (kind !== 'system' && key.startsWith(LOG_PREFIX.AI)) ||
          (kind !== 'ai' && key.startsWith(LOG_PREFIX.SYSTEM) && key !== STORAGE.LOG_LEVEL_KEY) ||
          (kind !== 'ai' && key === STORAGE.SYSTEM_LOG_INDEX_KEY),
      );
      if (keys.length) await chrome.storage.local.remove(keys);
    });
  }
}
