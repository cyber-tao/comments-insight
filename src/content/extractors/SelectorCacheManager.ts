import { SelectorMap, SelectorCache, Settings, Platform } from '../../types';
import { MESSAGES } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { sendMessage, sendMessageVoid } from '@/utils/chrome-message';
import { getCurrentHostname } from '@/utils/url';

export class SelectorCacheManager {
  async getSettings(): Promise<Settings | null> {
    const response = await sendMessage<{ settings?: Settings }>({ type: MESSAGES.GET_SETTINGS });
    return response?.settings || null;
  }

  getDomain(): string {
    return getCurrentHostname();
  }

  async getCachedSelectors(domain: string, platform: Platform): Promise<SelectorMap | null> {
    const settings = await this.getSettings();
    if (!settings?.selectorCache) {
      return null;
    }

    const cached = settings.selectorCache.find(
      (cache: SelectorCache) => cache.domain === domain && cache.platform === platform,
    );

    return cached ? cached.selectors : null;
  }

  async saveSelectorCache(
    domain: string,
    platform: Platform,
    selectors: SelectorMap,
  ): Promise<void> {
    const settings = await this.getSettings();
    if (!settings) return;

    const selectorCache = settings.selectorCache || [];

    const existingIndex = selectorCache.findIndex(
      (cache: SelectorCache) => cache.domain === domain && cache.platform === platform,
    );

    if (existingIndex >= 0) {
      selectorCache[existingIndex] = {
        domain,
        platform,
        selectors,
        lastUsed: Date.now(),
        successCount: selectorCache[existingIndex].successCount + 1,
      };
    } else {
      selectorCache.push({
        domain,
        platform,
        selectors,
        lastUsed: Date.now(),
        successCount: 1,
      });
    }

    await sendMessageVoid({
      type: MESSAGES.SAVE_SETTINGS,
      payload: { settings: { ...settings, selectorCache } },
    });

    Logger.info('[SelectorCacheManager] Saved selector cache', { domain });
  }

  async updateSelectorCacheUsage(domain: string, platform: Platform): Promise<void> {
    const settings = await this.getSettings();
    if (!settings?.selectorCache) return;

    const selectorCache = settings.selectorCache;
    const existingIndex = selectorCache.findIndex(
      (cache: SelectorCache) => cache.domain === domain && cache.platform === platform,
    );

    if (existingIndex >= 0) {
      selectorCache[existingIndex].lastUsed = Date.now();
      selectorCache[existingIndex].successCount++;

      await sendMessageVoid({
        type: MESSAGES.SAVE_SETTINGS,
        payload: { settings: { ...settings, selectorCache } },
      });
    }
  }
}

export const selectorCacheManager = new SelectorCacheManager();
