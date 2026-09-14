import { APP_DATA_VERSION, STORAGE } from '@/config/constants';
import DEFAULT_CRAWLING_RULES from '@/config/default_rules.json';
import type { CrawlingConfig } from '@/types';
import { hasPersistedCrawlingConfigChanged } from '@/utils/crawling-config';
import { Logger } from '@/utils/logger';

type MigrationStep = () => Promise<void>;

export class DataMigrator {
  private readonly migrations: Record<number, MigrationStep>;

  constructor(migrations?: Record<number, MigrationStep>) {
    this.migrations = migrations ?? this.buildDefaultMigrations();
  }

  async migrate(): Promise<void> {
    const from = await this.readStoredVersion();
    const target = APP_DATA_VERSION.CURRENT;

    if (from >= target) {
      Logger.debug('[DataMigrator] Data already at current version', { version: from });
      return;
    }

    Logger.info('[DataMigrator] Starting data migration', { from, target });

    for (let version = from + 1; version <= target; version += 1) {
      const step = this.migrations[version];
      if (!step) {
        throw new Error(`Missing data migration step for version ${version}`);
      }
      try {
        await step();
        Logger.info('[DataMigrator] Migration step complete', { version });
      } catch (error) {
        Logger.error('[DataMigrator] Migration step failed', {
          version,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    await this.writeStoredVersion(target);
    Logger.info('[DataMigrator] Data migration complete', { version: target });
  }

  private async readStoredVersion(): Promise<number> {
    try {
      const stored = await chrome.storage.local.get(STORAGE.APP_DATA_VERSION_KEY);
      const raw = stored[STORAGE.APP_DATA_VERSION_KEY];
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= APP_DATA_VERSION.INITIAL) {
        return Math.floor(raw);
      }
      return APP_DATA_VERSION.INITIAL;
    } catch (error) {
      Logger.warn('[DataMigrator] Failed to read stored data version, assuming initial', {
        error: error instanceof Error ? error.message : String(error),
      });
      return APP_DATA_VERSION.INITIAL;
    }
  }

  private async writeStoredVersion(version: number): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE.APP_DATA_VERSION_KEY]: version });
    } catch (error) {
      Logger.warn('[DataMigrator] Failed to persist data version', {
        version,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private buildDefaultMigrations(): Record<number, MigrationStep> {
    return {
      // Version 2: pure version marker bump. The 0.6.x refactor did not change
      // any persisted payload shape; DataMigrator only records that the current
      // installation has been touched by the refactored code path so future
      // migrations can rely on a known baseline.
      2: async () => {
        // no-op
      },
      // Version 3: Settings records persist tombstones for bundled crawling
      // configs that users explicitly removed and only store modified bundled
      // rules as overrides. Do not create Settings on a fresh install.
      3: async () => {
        const stored = await chrome.storage.local.get(STORAGE.SETTINGS_KEY);
        const settings = stored[STORAGE.SETTINGS_KEY];
        if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
          return;
        }

        const settingsRecord = settings as Record<string, unknown>;
        const disabledDomains = settingsRecord.disabledDefaultConfigDomains;
        const hasValidDisabledDomains =
          Array.isArray(disabledDomains) &&
          disabledDomains.every((domain) => typeof domain === 'string');
        const storedConfigs = settingsRecord.crawlingConfigs;
        const defaultsByDomain = new Map(
          (DEFAULT_CRAWLING_RULES as CrawlingConfig[]).map((config) => [
            config.domain.trim().toLowerCase(),
            config,
          ]),
        );
        const configOverrides = Array.isArray(storedConfigs)
          ? storedConfigs.filter((value) => {
              if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                return true;
              }
              const config = value as CrawlingConfig;
              if (typeof config.domain !== 'string') {
                return true;
              }
              const bundledConfig = defaultsByDomain.get(config.domain.trim().toLowerCase());
              return !bundledConfig || hasPersistedCrawlingConfigChanged(bundledConfig, config);
            })
          : storedConfigs;
        const configsChanged =
          Array.isArray(storedConfigs) &&
          Array.isArray(configOverrides) &&
          configOverrides.length !== storedConfigs.length;
        if (hasValidDisabledDomains && !configsChanged) {
          return;
        }

        await chrome.storage.local.set({
          [STORAGE.SETTINGS_KEY]: {
            ...settingsRecord,
            disabledDefaultConfigDomains: hasValidDisabledDomains ? disabledDomains : [],
            ...(Array.isArray(configOverrides) ? { crawlingConfigs: configOverrides } : {}),
          },
        });
      },
    };
  }
}
