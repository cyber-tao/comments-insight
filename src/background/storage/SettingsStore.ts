import { Settings, AIConfig, CrawlingConfig } from '@/types';
import {
  AI,
  LANGUAGES,
  THEME,
  RETRY,
  STORAGE,
  EXTRACTION_DEFAULTS,
  DOM_ANALYSIS_DEFAULTS,
} from '@/config/constants';
import DEFAULT_CRAWLING_RULES from '@/config/default_rules.json';
import {
  DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
  DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE,
} from '@/utils/prompts';
import { Logger } from '@/utils/logger';
import { ErrorHandler, ExtensionError, ErrorCode } from '@/utils/errors';
import type { EncryptionService } from './EncryptionService';
import { Mutex } from '@/utils/promise';
import {
  completeAiConfigSchema,
  sanitizeStoredSettings,
  settingsPatchSchema,
} from '@/utils/storage-validation';
import { normalizeAiApiUrl } from '@/utils/url';

export const DEFAULT_SETTINGS: Settings = {
  maxComments: EXTRACTION_DEFAULTS.MAX_COMMENTS,
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
  generateDynamicReport: true,
  dynamicReportPromptTemplate: DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE,
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
  private settingsCache: Settings | null = null;

  constructor(private readonly encryptionService: EncryptionService) {
    try {
      // Invalidate the in-process cache whenever the persisted settings
      // change (including writes from this context), so repeated getSettings
      // calls skip the storage read + PBKDF2 key derivation.
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[STORAGE.SETTINGS_KEY]) {
          this.settingsCache = null;
        }
      });
    } catch {
      // Storage events unavailable (tests/non-extension hosts): cache stays
      // valid until the next save clears it.
    }
  }

  private normalizeCrawlingDomain(domain: string): string {
    return domain.trim().toLowerCase();
  }

  async getSettings(): Promise<Settings> {
    try {
      if (this.settingsCache) {
        // Clone so callers can mutate the returned object freely without
        // poisoning the cache.
        return structuredClone(this.settingsCache);
      }
      await this.encryptionService.ensureEncryptionReady();
      Logger.debug('[SettingsStore] Getting settings from storage');
      const result = await chrome.storage.local.get(STORAGE.SETTINGS_KEY);
      const settings = sanitizeStoredSettings(result[STORAGE.SETTINGS_KEY]);

      if (Object.keys(settings).length === 0) {
        Logger.info('[SettingsStore] No settings found, using defaults');
        await this._saveSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
      }

      const merged = this.mergeSettingsWithDefaults(settings);

      const normalizedModel = this.normalizeAIModel(merged);
      let apiKey = '';
      try {
        apiKey = await this.encryptionService.decrypt(normalizedModel.apiKey || '');
      } catch (decryptError) {
        // An unreadable protected field must not brick every getSettings
        // consumer; return an empty key so Options can prompt for a re-entry.
        Logger.warn('[SettingsStore] Failed to decrypt API key, returning empty', {
          error: decryptError,
        });
      }
      merged.aiModel = { ...normalizedModel, apiKey };

      delete (merged as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig })
        .extractorModel;
      delete (merged as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig })
        .analyzerModel;
      Logger.debug('[SettingsStore] Settings retrieved successfully');
      this.settingsCache = structuredClone(merged);
      return merged;
    } catch (error) {
      const wrappedError =
        error instanceof ExtensionError
          ? error
          : new ExtensionError(ErrorCode.STORAGE_READ_ERROR, 'Failed to get settings', {
              originalError: error instanceof Error ? error.message : String(error),
            });

      Logger.error('[SettingsStore] Failed to get settings', { error: wrappedError });
      await ErrorHandler.handleError(wrappedError, 'SettingsStore.getSettings');
      throw wrappedError;
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
    merged.generateDynamicReport =
      typeof stored.generateDynamicReport === 'boolean'
        ? stored.generateDynamicReport
        : DEFAULT_SETTINGS.generateDynamicReport;
    merged.dynamicReportPromptTemplate =
      typeof stored.dynamicReportPromptTemplate === 'string'
        ? stored.dynamicReportPromptTemplate
        : DEFAULT_SETTINGS.dynamicReportPromptTemplate;
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
    return this.saveMutex.withLock(() => this._saveSettings(settings));
  }

  private async _saveSettings(settings: Partial<Settings>): Promise<void> {
    try {
      const settingsResult = settingsPatchSchema.safeParse(settings);
      if (!settingsResult.success) {
        throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Invalid settings data', {
          issues: settingsResult.error.flatten(),
        });
      }

      const sanitizedSettings = settingsResult.data as Partial<Settings>;

      await this.encryptionService.ensureEncryptionReady();
      Logger.debug('[SettingsStore] Saving settings');

      const result = await chrome.storage.local.get(STORAGE.SETTINGS_KEY);
      const currentSettings = this.mergeSettingsWithDefaults(
        sanitizeStoredSettings(result[STORAGE.SETTINGS_KEY]),
      );
      const updatedSettings = { ...currentSettings, ...sanitizedSettings } as Settings & {
        extractorModel?: AIConfig;
        analyzerModel?: AIConfig;
      };
      updatedSettings.aiModel = {
        ...currentSettings.aiModel,
        ...(sanitizedSettings.aiModel || {}),
      };
      updatedSettings.domAnalysisConfig = {
        ...currentSettings.domAnalysisConfig,
        ...(sanitizedSettings.domAnalysisConfig || {}),
      };

      updatedSettings.aiModel = this.normalizeAIModel(updatedSettings);
      const aiModelResult = completeAiConfigSchema.safeParse(updatedSettings.aiModel);
      if (!aiModelResult.success) {
        throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Invalid AI model limits', {
          issues: aiModelResult.error.flatten(),
        });
      }
      updatedSettings.aiModel = aiModelResult.data;
      if (
        updatedSettings.aiModel.apiUrl.trim().length > 0 &&
        !normalizeAiApiUrl(updatedSettings.aiModel.apiUrl)
      ) {
        throw new ExtensionError(
          ErrorCode.VALIDATION_ERROR,
          'AI API URL must use HTTPS, except for loopback development endpoints',
        );
      }

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
      this.settingsCache = null;

      Logger.info('[SettingsStore] Settings saved successfully');
    } catch (error) {
      Logger.error('[SettingsStore] Failed to save settings', { error });
      if (error instanceof ExtensionError) {
        throw error;
      }
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save settings', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async updateSelectorCache(hostname: string, selector: string): Promise<void> {
    return this.saveMutex.withLock(async () => {
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
      }
    });
  }

  async exportSettings(): Promise<string> {
    try {
      const settings = await this.getSettings();
      // Never export the API key in plaintext: getSettings returns it
      // decrypted for runtime use, but an exported file may be shared or
      // attached to bug reports. importSettings merges aiModel over the
      // current one, so an absent key simply keeps the stored key.
      const { crawlingConfigs: _crawlingConfigs, ...settingsToExport } = settings;
      const { apiKey: _apiKey, ...aiModelWithoutKey } = settingsToExport.aiModel;
      return JSON.stringify({ ...settingsToExport, aiModel: aiModelWithoutKey }, null, 2);
    } catch (error) {
      Logger.error('[SettingsStore] Failed to export settings', { error });
      throw new ExtensionError(ErrorCode.STORAGE_READ_ERROR, 'Failed to export settings', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async importSettings(data: string): Promise<void> {
    return this.saveMutex.withLock(async () => {
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch (parseError) {
          throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Invalid settings JSON', {
            originalError: parseError instanceof Error ? parseError.message : String(parseError),
          });
        }

        // Reuse the same zod-driven sanitizer that protects stored settings, so
        // imported payloads cannot inject unknown fields or bypass type checks.
        const sanitized = sanitizeStoredSettings(parsed);
        const currentSettings = await this.getSettings();
        const {
          crawlingConfigs: _crawlingConfigs,
          selectorCache: _selectorCache,
          ...rest
        } = sanitized;
        const importedModel = rest.aiModel;
        const importedApiUrl = importedModel?.apiUrl;
        const currentEndpoint = normalizeAiApiUrl(currentSettings.aiModel.apiUrl);
        const importedEndpoint =
          typeof importedApiUrl === 'string' && importedApiUrl.trim().length > 0
            ? normalizeAiApiUrl(importedApiUrl)
            : null;
        if (typeof importedApiUrl === 'string' && importedApiUrl.trim() && !importedEndpoint) {
          throw new ExtensionError(
            ErrorCode.VALIDATION_ERROR,
            'AI API URL must use HTTPS, except for loopback development endpoints',
          );
        }
        const endpointChanged =
          typeof importedApiUrl === 'string' && importedEndpoint !== currentEndpoint;
        const hasImportedApiKey =
          importedModel !== undefined &&
          Object.prototype.hasOwnProperty.call(importedModel, 'apiKey');
        const apiKey =
          endpointChanged && !hasImportedApiKey
            ? ''
            : hasImportedApiKey
              ? importedModel.apiKey
              : currentSettings.aiModel.apiKey;
        const merged: Settings = {
          ...currentSettings,
          ...rest,
          aiModel: { ...currentSettings.aiModel, ...importedModel, apiKey } as AIConfig,
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
      }
    });
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
