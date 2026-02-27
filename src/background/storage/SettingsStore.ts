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
import { Logger } from '../../utils/logger';
import { ErrorHandler, ExtensionError, ErrorCode } from '../../utils/errors';
import type { EncryptionService } from './EncryptionService';

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
    lastUpdated: Date.now(),
  })) as CrawlingConfig[],
  domAnalysisConfig: DOM_ANALYSIS_DEFAULTS,
  developerMode: false,
};

export class SettingsStore {
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
    const storedConfigs = stored.crawlingConfigs || [];
    const configMap = new Map<string, CrawlingConfig>();
    for (const config of defaultConfigs) {
      configMap.set(this.normalizeCrawlingDomain(config.domain), {
        ...config,
        domain: this.normalizeCrawlingDomain(config.domain),
      });
    }
    for (const config of storedConfigs) {
      configMap.set(this.normalizeCrawlingDomain(config.domain), {
        ...config,
        domain: this.normalizeCrawlingDomain(config.domain),
      });
    }
    merged.crawlingConfigs = Array.from(configMap.values());

    return merged;
  }

  async saveSettings(settings: Partial<Settings>): Promise<void> {
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

      await this.saveSettings({ selectorCache: filtered });
      Logger.info('[SettingsStore] Selector cache updated', { hostname, selector });
    } catch (error) {
      Logger.error('[SettingsStore] Failed to update selector cache', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to update selector cache');
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
          lastUpdated: Date.now(),
        };

        const indexByDomain = merged.findIndex(
          (c) => this.normalizeCrawlingDomain(c.domain) === normalizedRemoteDomain,
        );
        const indexById = merged.findIndex((c) => c.id === remote.id);
        const index = indexByDomain >= 0 ? indexByDomain : indexById;

        if (index >= 0) {
          merged[index] = {
            ...merged[index],
            ...normalizedRemoteConfig,
          };
          updated++;
        } else {
          merged.push(normalizedRemoteConfig);
          added++;
        }
      }

      await this.saveSettings({ crawlingConfigs: merged });
      Logger.info('[SettingsStore] Crawling configs synced successfully', { added, updated });
      return { added, updated };
    } catch (error) {
      Logger.error('[SettingsStore] Failed to sync crawling configs', { error });
      throw error;
    }
  }

  async saveCrawlingConfig(config: CrawlingConfig): Promise<void> {
    try {
      await this.encryptionService.ensureEncryptionReady();
      const settings = await this.getSettings();
      const configs = settings.crawlingConfigs || [];
      const normalizedDomain = this.normalizeCrawlingDomain(config.domain);
      const normalizedConfig: CrawlingConfig = {
        ...config,
        domain: normalizedDomain,
      };

      const index = configs.findIndex(
        (c) => this.normalizeCrawlingDomain(c.domain) === normalizedDomain,
      );
      if (index >= 0) {
        configs[index] = normalizedConfig;
      } else {
        configs.push(normalizedConfig);
      }

      await this.saveSettings({ crawlingConfigs: configs });
      Logger.info('[SettingsStore] Crawling config saved', { domain: normalizedDomain });
    } catch (error) {
      Logger.error('[SettingsStore] Failed to save crawling config', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save crawling config');
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
      await this.saveSettings(merged);
      Logger.info('[SettingsStore] Settings imported successfully');
    } catch (error) {
      Logger.error('[SettingsStore] Failed to import settings', { error });
      if (error instanceof ExtensionError) {
        throw error;
      }
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to import settings', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async recordTokenUsage(tokens: number): Promise<void> {
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
