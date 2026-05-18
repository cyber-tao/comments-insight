import { CrawlingConfig } from '../../types';
import { API } from '@/config/constants';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '../../utils/errors';
import {
  hasCrawlingConfigContentChanged,
  resolveCrawlingConfigLastUpdated,
} from '@/utils/crawling-config';
import type { SettingsStore } from './SettingsStore';

export class CrawlingConfigStore {
  constructor(private readonly settingsStore: SettingsStore) {}

  private normalizeCrawlingDomain(domain: string): string {
    return domain.trim().toLowerCase();
  }

  async getCrawlingConfig(domain: string): Promise<CrawlingConfig | null> {
    try {
      const settings = await this.settingsStore.getSettings();
      const configs = settings.crawlingConfigs || [];
      const normalizedDomain = this.normalizeCrawlingDomain(domain);

      const exact = configs.find(
        (c) => this.normalizeCrawlingDomain(c.domain) === normalizedDomain,
      );
      if (exact) return exact;

      const matches = configs.filter((c) => {
        const configDomain = this.normalizeCrawlingDomain(c.domain);
        return normalizedDomain === configDomain || normalizedDomain.endsWith(`.${configDomain}`);
      });
      if (matches.length > 0) {
        return matches.sort((a, b) => b.domain.length - a.domain.length)[0];
      }

      return null;
    } catch (error) {
      Logger.warn('[CrawlingConfigStore] Failed to get crawling config', { error });
      return null;
    }
  }

  async syncCrawlingConfigs(): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;
    try {
      const response = await fetch(API.CRAWLING_CONFIGS_RAW_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch remote config: ${response.statusText}`);
      }

      const remoteConfigs = (await response.json()) as CrawlingConfig[];
      const settings = await this.settingsStore.getSettings();
      const currentConfigs = settings.crawlingConfigs || [];

      const merged = [...currentConfigs];
      for (const remote of remoteConfigs) {
        const normalizedRemoteDomain = this.normalizeCrawlingDomain(remote.domain);
        const normalizedRemoteConfig: CrawlingConfig = {
          ...remote,
          domain: normalizedRemoteDomain,
          lastUpdated: typeof remote.lastUpdated === 'number' ? remote.lastUpdated : Date.now(),
        };

        const indexByDomain = merged.findIndex(
          (c) => this.normalizeCrawlingDomain(c.domain) === normalizedRemoteDomain,
        );
        const indexById = merged.findIndex((c) => c.id === remote.id);
        const index = indexByDomain >= 0 ? indexByDomain : indexById;

        if (index >= 0) {
          const existing = merged[index];
          const mergedConfig: CrawlingConfig = {
            ...existing,
            ...normalizedRemoteConfig,
          };
          const contentChanged = hasCrawlingConfigContentChanged(existing, mergedConfig);
          merged[index] = {
            ...mergedConfig,
            lastUpdated: resolveCrawlingConfigLastUpdated({
              previous: existing,
              next: mergedConfig,
              preferredLastUpdated: normalizedRemoteConfig.lastUpdated,
            }),
          };
          if (contentChanged) {
            updated++;
          }
        } else {
          merged.push(normalizedRemoteConfig);
          added++;
        }
      }

      await this.settingsStore.saveSettings({ crawlingConfigs: merged });
      Logger.info('[CrawlingConfigStore] Crawling configs synced successfully', { added, updated });
      return { added, updated };
    } catch (error) {
      Logger.error('[CrawlingConfigStore] Failed to sync crawling configs', { error });
      throw error;
    }
  }

  async saveCrawlingConfig(config: CrawlingConfig): Promise<void> {
    try {
      const settings = await this.settingsStore.getSettings();
      const configs = settings.crawlingConfigs || [];
      const normalizedDomain = this.normalizeCrawlingDomain(config.domain);
      const index = configs.findIndex(
        (c) => this.normalizeCrawlingDomain(c.domain) === normalizedDomain,
      );
      const existing = index >= 0 ? configs[index] : undefined;
      const incomingConfig: CrawlingConfig = {
        ...config,
        domain: normalizedDomain,
      };
      const normalizedConfig: CrawlingConfig = {
        ...incomingConfig,
        lastUpdated: resolveCrawlingConfigLastUpdated({
          previous: existing,
          next: incomingConfig,
        }),
      };
      if (index >= 0) {
        configs[index] = normalizedConfig;
      } else {
        configs.push(normalizedConfig);
      }

      await this.settingsStore.saveSettings({ crawlingConfigs: configs });
      Logger.info('[CrawlingConfigStore] Crawling config saved', { domain: normalizedDomain });
    } catch (error) {
      Logger.error('[CrawlingConfigStore] Failed to save crawling config', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save crawling config');
    }
  }
}
