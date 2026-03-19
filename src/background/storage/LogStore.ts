import { STORAGE, DEFAULTS } from '@/config/constants';
import { Logger } from '../../utils/logger';
import { Mutex } from '@/utils/promise';

export class LogStore {
  private logMutex = new Mutex();

  async saveAiLog(
    logKey: string,
    entry: { type: 'extraction' | 'analysis'; timestamp: number; prompt: string; response: string },
  ): Promise<void> {
    try {
      await chrome.storage.local.set({
        [logKey]: entry,
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
      const index = result[STORAGE.AI_LOG_INDEX_KEY];
      return Array.isArray(index) ? index : [];
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

      if (next.length > DEFAULTS.AI_LOGS_MAX_STORED) {
        const toRemove = next.slice(0, next.length - DEFAULTS.AI_LOGS_MAX_STORED);
        const kept = next.slice(next.length - DEFAULTS.AI_LOGS_MAX_STORED);
        await chrome.storage.local.remove(toRemove);
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
