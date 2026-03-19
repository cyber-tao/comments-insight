import { Settings, AIConfig, CrawlingConfig } from '../../types';
import {
  API,
  AI,
  LANGUAGES,
  THEME,
  RETRY,
  STORAGE,
  DEFAULTS,
  DOM_ANALYSIS_DEFAULTS,
} from '@/config/constants';
import DEFAULT_CRAWLING_RULES from '@/config/default_rules.json';
import { DEFAULT_ANALYSIS_PROMPT_TEMPLATE } from '@/utils/prompts';
import {
  hasCrawlingConfigContentChanged,
  resolveCrawlingConfigLastUpdated,
} from '@/utils/crawling-config';
import { Logger } from '../../utils/logger';
import { ErrorHandler, ExtensionError, ErrorCode } from '../../utils/errors';
import type { EncryptionService } from './EncryptionService';
import { Mutex } from '@/utils/promise';

export const DEFAULT_SETTINGS: Settings = {
  maxComments: DEFAULTS.MAX_COMMENTS,
  aiModel: {
    apiUrl: '',
    apiKey: '',
    model: '',
    contextWindowSize: AI.DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: AI.DEFAULT_MAX_OUTPUT_TOKENS,
    temperature: AI.DEFAULT_TEMPERATURE,
    topP: AI.DEFAULT_TOP_P,
  },
  aiTimeout: AI.DEFAULT_TIMEOUT,
  normalizeTimestamps: false,
  exportPostContentInMarkdown: false,
  analyzerPromptTemplate: DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
  language: LANGUAGES.DEFAULT,
  theme: THEME.DEFAULT,
  selectorRetryAttempts: RETRY.SELECTOR_ATTEMPTS,
  selectorCache: [],
  crawlingConfigs: DEFAULT_CRAWLING_RULES.map((config) => ({
    ...config,
    lastUpdated: typeof config.lastUpdated === 'number' ? config.lastUpdated : Date.now(),
  })) as CrawlingConfig[],
  domAnalysisConfig: DOM_ANALYSIS_DEFAULTS,
  developerMode: false,
};

export class SettingsStore {
  private saveMutex = new Mutex();
  private tokenMutex = new Mutex();

  constructor(private readonly encryptionService: EncryptionService) {}

  private normalizeCrawlingDomain(domain: string): string {
    return domain.trim().toLowerCase();
  }

  async getSettings(): Promise<Settings> {
    try {
      await this.encryptionService.ensureEncryptionReady();
      Logger.debug('[SettingsStore] Getting settings from storage');
      const result = await chrome.storage.local.get(STORAGE.SETTINGS_KEY);
      const settings = result[STORAGE.SETTINGS_KEY] as Settings | undefined;

      if (!settings) {
        Logger.info('[SettingsStore] No settings found, using defaults');
        await this.saveSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
      }

      const merged = this.mergeSettingsWithDefaults(settings as Partial<Settings>);

      const normalizedModel = this.normalizeAIModel(merged);
      merged.aiModel = {
        ...normalizedModel,
        apiKey: await this.encryptionService.decrypt(normalizedModel.apiKey || ''),
      };

      delete (merged as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig })
        .extractorModel;
      delete (merged as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig })
        .analyzerModel;
      Logger.debug('[SettingsStore] Settings retrieved successfully');
      return merged;
    } catch (error) {
      Logger.error('[SettingsStore] Failed to get settings', { error });
      await ErrorHandler.handleError(error as Error, 'SettingsStore.getSettings');
      return DEFAULT_SETTINGS;
    }
  }

  private mergeSettingsWithDefaults(
    stored: Partial<Settings>,
  ): Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig } {
    const merged = {
      ...DEFAULT_SETTINGS,
      ...stored,
    } as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig };

    const defaultConfigs = DEFAULT_SETTINGS.crawlingConfigs || [];
    const storedConfigs = Array.isArray(stored.crawlingConfigs) ? stored.crawlingConfigs : [];
    const configMap = new Map<string, CrawlingConfig>();
    for (const config of defaultConfigs) {
      configMap.set(this.normalizeCrawlingDomain(config.domain), {
        ...config,
        domain: this.normalizeCrawlingDomain(config.domain),
      });
    }
    for (const config of storedConfigs) {
      if (!config || typeof config !== 'object') {
        continue;
      }
      const rawDomain = (config as Partial<CrawlingConfig>).domain;
      if (typeof rawDomain !== 'string' || rawDomain.trim().length === 0) {
        continue;
      }
      configMap.set(this.normalizeCrawlingDomain(rawDomain), {
        ...(config as CrawlingConfig),
        domain: this.normalizeCrawlingDomain(rawDomain),
      });
    }
    merged.crawlingConfigs = Array.from(configMap.values());
    merged.selectorCache = Array.isArray(stored.selectorCache) ? stored.selectorCache : [];
    merged.maxComments =
      typeof stored.maxComments === 'number' && Number.isFinite(stored.maxComments)
        ? stored.maxComments
        : DEFAULT_SETTINGS.maxComments;
    merged.aiTimeout =
      typeof stored.aiTimeout === 'number' && Number.isFinite(stored.aiTimeout)
        ? stored.aiTimeout
        : DEFAULT_SETTINGS.aiTimeout;
    merged.analyzerPromptTemplate =
      typeof stored.analyzerPromptTemplate === 'string'
        ? stored.analyzerPromptTemplate
        : DEFAULT_SETTINGS.analyzerPromptTemplate;
    merged.language =
      typeof stored.language === 'string' ? stored.language : DEFAULT_SETTINGS.language;
    merged.theme =
      stored.theme === 'light' || stored.theme === 'dark' || stored.theme === 'system'
        ? stored.theme
        : DEFAULT_SETTINGS.theme;
    merged.normalizeTimestamps =
      typeof stored.normalizeTimestamps === 'boolean'
        ? stored.normalizeTimestamps
        : DEFAULT_SETTINGS.normalizeTimestamps;
    merged.exportPostContentInMarkdown =
      typeof stored.exportPostContentInMarkdown === 'boolean'
        ? stored.exportPostContentInMarkdown
        : DEFAULT_SETTINGS.exportPostContentInMarkdown;
    merged.selectorRetryAttempts =
      typeof stored.selectorRetryAttempts === 'number' &&
      Number.isFinite(stored.selectorRetryAttempts)
        ? stored.selectorRetryAttempts
        : DEFAULT_SETTINGS.selectorRetryAttempts;
    merged.developerMode =
      typeof stored.developerMode === 'boolean'
        ? stored.developerMode
        : DEFAULT_SETTINGS.developerMode;

    if (
      !stored.domAnalysisConfig ||
      typeof stored.domAnalysisConfig !== 'object' ||
      Array.isArray(stored.domAnalysisConfig)
    ) {
      merged.domAnalysisConfig = DEFAULT_SETTINGS.domAnalysisConfig;
    }

    return merged;
  }

  async saveSettings(settings: Partial<Settings>): Promise<void> {
    const release = await this.saveMutex.acquire();
    try {
      await this._saveSettings(settings);
    } finally {
      release();
    }
  }

  private async _saveSettings(settings: Partial<Settings>): Promise<void> {
    try {
      await this.encryptionService.ensureEncryptionReady();
      Logger.debug('[SettingsStore] Saving settings');

      const result = await chrome.storage.local.get(STORAGE.SETTINGS_KEY);
      const currentSettings = result[STORAGE.SETTINGS_KEY] || DEFAULT_SETTINGS;
      const updatedSettings = { ...currentSettings, ...settings } as Settings & {
        extractorModel?: AIConfig;
        analyzerModel?: AIConfig;
      };

      updatedSettings.aiModel = this.normalizeAIModel(updatedSettings);

      if (
        typeof updatedSettings.aiModel.apiKey === 'string' &&
        updatedSettings.aiModel.apiKey.length > 0 &&
        !updatedSettings.aiModel.apiKey.startsWith('enc:')
      ) {
        updatedSettings.aiModel = {
          ...updatedSettings.aiModel,
          apiKey: await this.encryptionService.encrypt(updatedSettings.aiModel.apiKey),
        } as AIConfig;
      }

      delete (updatedSettings as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig })
        .extractorModel;
      delete (updatedSettings as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig })
        .analyzerModel;

      await chrome.storage.local.set({
        [STORAGE.SETTINGS_KEY]: updatedSettings,
      });

      Logger.info('[SettingsStore] Settings saved successfully');
    } catch (error) {
      Logger.error('[SettingsStore] Failed to save settings', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save settings', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async updateSelectorCache(hostname: string, selector: string): Promise<void> {
    const release = await this.saveMutex.acquire();
    try {
      await this.encryptionService.ensureEncryptionReady();
      const settings = await this.getSettings();
      const currentCache = settings.selectorCache || [];

      const filtered = currentCache.filter((item) => item.domain !== hostname);

      filtered.push({
        domain: hostname,
        selectors: {
          commentContainer: selector,
        },
        lastUsed: Date.now(),
        successCount: 1,
      });

      filtered.sort((a, b) => b.lastUsed - a.lastUsed);
      const limitedCache = filtered.slice(0, 50);

      await this._saveSettings({ selectorCache: limitedCache });
      Logger.info('[SettingsStore] Selector cache updated', { hostname, selector });
    } catch (error) {
      Logger.error('[SettingsStore] Failed to update selector cache', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to update selector cache');
    } finally {
      release();
    }
  }

  async getCrawlingConfig(domain: string): Promise<CrawlingConfig | null> {
    try {
      await this.encryptionService.ensureEncryptionReady();
      const settings = await this.getSettings();
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
      Logger.warn('[SettingsStore] Failed to get crawling config', { error });
      return null;
    }
  }

  async syncCrawlingConfigs(): Promise<{ added: number; updated: number }> {
    const release = await this.saveMutex.acquire();
    let added = 0;
    let updated = 0;
    try {
      const response = await fetch(API.CRAWLING_CONFIGS_RAW_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch remote config: ${response.statusText}`);
      }

      const remoteConfigs = (await response.json()) as CrawlingConfig[];
      const settings = await this.getSettings();
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

      await this._saveSettings({ crawlingConfigs: merged });
      Logger.info('[SettingsStore] Crawling configs synced successfully', { added, updated });
      return { added, updated };
    } catch (error) {
      Logger.error('[SettingsStore] Failed to sync crawling configs', { error });
      throw error;
    } finally {
      release();
    }
  }

  async saveCrawlingConfig(config: CrawlingConfig): Promise<void> {
    const release = await this.saveMutex.acquire();
    try {
      await this.encryptionService.ensureEncryptionReady();
      const settings = await this.getSettings();
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

      await this._saveSettings({ crawlingConfigs: configs });
      Logger.info('[SettingsStore] Crawling config saved', { domain: normalizedDomain });
    } catch (error) {
      Logger.error('[SettingsStore] Failed to save crawling config', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save crawling config');
    } finally {
      release();
    }
  }

  async exportSettings(): Promise<string> {
    try {
      const settings = await this.getSettings();
      const { crawlingConfigs: _crawlingConfigs, ...settingsToExport } = settings;
      return JSON.stringify(settingsToExport, null, 2);
    } catch (error) {
      Logger.error('[SettingsStore] Failed to export settings', { error });
      throw new ExtensionError(ErrorCode.STORAGE_READ_ERROR, 'Failed to export settings', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async importSettings(data: string): Promise<void> {
    const release = await this.saveMutex.acquire();
    try {
      const settings = JSON.parse(data) as Settings;

      if (!this.validateSettings(settings)) {
        throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Invalid settings format');
      }

      const currentSettings = await this.getSettings();
      const {
        crawlingConfigs: _crawlingConfigs,
        selectorCache: _selectorCache,
        ...rest
      } = settings;
      const merged = {
        ...currentSettings,
        ...rest,
        crawlingConfigs: currentSettings.crawlingConfigs,
        selectorCache: currentSettings.selectorCache,
      };
      await this._saveSettings(merged);
      Logger.info('[SettingsStore] Settings imported successfully');
    } catch (error) {
      Logger.error('[SettingsStore] Failed to import settings', { error });
      if (error instanceof ExtensionError) {
        throw error;
      }
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to import settings', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      release();
    }
  }

  async recordTokenUsage(tokens: number): Promise<void> {
    const release = await this.tokenMutex.acquire();
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
      Logger.debug('[SettingsStore] Token usage recorded', { tokens, stats });
    } catch (error) {
      Logger.error('[SettingsStore] Failed to record token usage', { error });
    } finally {
      release();
    }
  }

  async getTokenStats(): Promise<{ today: number; total: number; lastReset: number }> {
    try {
      const result = await chrome.storage.local.get(STORAGE.TOKEN_STATS_KEY);
      const stats = result[STORAGE.TOKEN_STATS_KEY] as
        | { today: number; total: number; lastReset: number }
        | undefined;
      return stats || { today: 0, total: 0, lastReset: 0 };
    } catch (error) {
      Logger.error('[SettingsStore] Failed to get token stats', { error });
      return { today: 0, total: 0, lastReset: 0 };
    }
  }

  private validateSettings(settings: unknown): settings is Settings {
    if (typeof settings !== 'object' || settings === null) return false;
    const s = settings as Record<string, unknown>;
    return (
      typeof s.maxComments === 'number' &&
      (this.validateAIConfig(s.aiModel) ||
        (this.validateAIConfig(s.extractorModel) && this.validateAIConfig(s.analyzerModel))) &&
      typeof s.analyzerPromptTemplate === 'string' &&
      typeof s.language === 'string'
    );
  }

  private validateAIConfig(config: unknown): config is AIConfig {
    if (typeof config !== 'object' || config === null) return false;
    const c = config as Record<string, unknown>;
    const hasMaxOutputTokens =
      c.maxOutputTokens === undefined || typeof c.maxOutputTokens === 'number';
    const hasLegacyMaxTokens = c.maxTokens === undefined || typeof c.maxTokens === 'number';

    return (
      typeof c.apiUrl === 'string' &&
      typeof c.apiKey === 'string' &&
      typeof c.model === 'string' &&
      typeof c.contextWindowSize === 'number' &&
      hasMaxOutputTokens &&
      hasLegacyMaxTokens &&
      typeof c.temperature === 'number' &&
      typeof c.topP === 'number'
    );
  }

  private normalizeAIModel(
    settings: Partial<Settings> & {
      extractorModel?: AIConfig;
      analyzerModel?: AIConfig;
    },
  ): AIConfig {
    const baseModel = settings.aiModel || settings.analyzerModel || settings.extractorModel;
    return {
      ...DEFAULT_SETTINGS.aiModel,
      ...(baseModel || {}),
    };
  }
}
