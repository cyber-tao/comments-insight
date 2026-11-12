import { STORAGE } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { Mutex } from '@/utils/promise';
import { sanitizeTokenStats } from '@/utils/storage-validation';

export interface TokenStats {
  today: number;
  total: number;
  lastReset: number;
}

export class TokenStatsStore {
  private tokenMutex = new Mutex();

  async recordTokenUsage(tokens: number): Promise<void> {
    return this.tokenMutex.withLock(async () => {
      try {
        const stats = await this.getTokenStats();
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

        if (stats.lastReset < todayStart) {
          stats.today = 0;
          stats.lastReset = todayStart;
        }

        stats.today += tokens;
        stats.total += tokens;

        await chrome.storage.local.set({ [STORAGE.TOKEN_STATS_KEY]: stats });
        Logger.debug('[TokenStatsStore] Token usage recorded', { tokens, stats });
      } catch (error) {
        Logger.error('[TokenStatsStore] Failed to record token usage', { error });
      }
    });
  }

  async getTokenStats(): Promise<TokenStats> {
    // A missing record can start at zero; a failed read must never reset an
    // existing total in recordTokenUsage's read-modify-write operation.
    const result = await chrome.storage.local.get(STORAGE.TOKEN_STATS_KEY);
    return sanitizeTokenStats(result[STORAGE.TOKEN_STATS_KEY]);
  }
}
