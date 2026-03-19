import { STORAGE, DEFAULTS, LIMITS, TEXT } from '@/config/constants';
import { Logger } from '../../utils/logger';
import { Mutex } from '@/utils/promise';
import {
  sanitizeAiLogEntry,
  sanitizeHistoryIndex,
  type StoredAiLogEntry,
} from '@/utils/storage-validation';

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
      prompt: this.truncateLogField(entry.prompt),
      response: this.truncateLogField(entry.response),
    };
  }

  private estimateEntrySize(entry: StoredAiLogEntry): number {
    return JSON.stringify(entry).length;
  }

  async saveAiLog(
    logKey: string,
    entry: { type: 'extraction' | 'analysis'; timestamp: number; prompt: string; response: string },
  ): Promise<void> {
    try {
      const sanitizedEntry = this.sanitizeLogEntry(entry);
      await chrome.storage.local.set({
        [logKey]: sanitizedEntry,
      });
      await this.appendAiLogKey(logKey);
    } catch (error) {
      Logger.warn('[LogStore] Failed to save AI log', {
        logKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async getAiLogIndex(): Promise<string[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE.AI_LOG_INDEX_KEY);
      return sanitizeHistoryIndex(result[STORAGE.AI_LOG_INDEX_KEY]);
    } catch {
      return [];
    }
  }

  private async setAiLogIndex(index: string[]): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE.AI_LOG_INDEX_KEY]: index });
    } catch {
      return;
    }
  }

  private async appendAiLogKey(logKey: string): Promise<void> {
    const release = await this.logMutex.acquire();
    try {
      const index = await this.getAiLogIndex();
      const next = index.includes(logKey) ? index : [...index, logKey];

      const storedLogs = next.length > 0 ? await chrome.storage.local.get(next) : {};
      const keysToRemove = new Set<string>();

      while (next.length - keysToRemove.size > DEFAULTS.AI_LOGS_MAX_STORED) {
        const oldestKey = next[keysToRemove.size];
        if (typeof oldestKey === 'string') {
          keysToRemove.add(oldestKey);
        }
      }

      let totalChars = next.reduce((sum, key) => {
        if (keysToRemove.has(key)) {
          return sum;
        }

        const entry = sanitizeAiLogEntry(storedLogs[key]);
        if (!entry) {
          return sum;
        }

        return sum + this.estimateEntrySize(entry);
      }, 0);

      for (const key of next) {
        if (totalChars <= LIMITS.AI_LOG_TOTAL_CHAR_BUDGET) {
          break;
        }
        if (keysToRemove.has(key)) {
          continue;
        }

        const entry = sanitizeAiLogEntry(storedLogs[key]);
        keysToRemove.add(key);
        if (entry) {
          totalChars -= this.estimateEntrySize(entry);
        }
      }

      if (keysToRemove.size > 0) {
        const removalList = Array.from(keysToRemove);
        const kept = next.filter((key) => !keysToRemove.has(key));
        await chrome.storage.local.remove(removalList);
        await this.setAiLogIndex(kept);
        return;
      }

      await this.setAiLogIndex(next);
    } catch (error) {
      Logger.warn('[LogStore] Failed to cleanup AI logs', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      release();
    }
  }
}
