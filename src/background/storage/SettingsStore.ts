import {
  Settings,
  SettingsPatch,
  AIConfig,
  AIProtocol,
  CrawlingConfig,
  FieldValidationStatus,
} from '@/types';
import {
  AI,
  LANGUAGES,
  THEME,
  RETRY,
  SECURITY,
  STORAGE,
  EXTRACTION_DEFAULTS,
  DOM_ANALYSIS_DEFAULTS,
} from '@/config/constants';
import DEFAULT_CRAWLING_RULES from '@/config/default_rules.json';
import { normalizeLanguageSetting } from '@/config/constants/ui';
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
import { isWithinValidationBudget } from '@/utils/validation-budget';
import {
  crawlingConfigsFingerprint,
  hasPersistedCrawlingConfigChanged,
} from '@/utils/crawling-config';

export const DEFAULT_SETTINGS: Settings = {
  maxComments: EXTRACTION_DEFAULTS.MAX_COMMENTS,
  aiModel: {
    protocol: AI.DEFAULT_PROTOCOL,
    apiUrl: '',
    apiKey: '',
    model: '',
    contextWindowSize: AI.DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: AI.DEFAULT_MAX_OUTPUT_TOKENS,
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
  disabledDefaultConfigDomains: [],
  crawlingConfigValidationByDomain: {},
  domAnalysisConfig: DOM_ANALYSIS_DEFAULTS,
  developerMode: false,
};

export class SettingsStore {
  private saveMutex = new Mutex();
  private settingsCache: Settings | null = null;
  private settingsRevision = 0;

  constructor(private readonly encryptionService: EncryptionService) {
    try {
      // Invalidate the in-process cache whenever the persisted settings
      // change (including writes from this context), so repeated getSettings
      // calls skip the storage read + PBKDF2 key derivation.
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[STORAGE.SETTINGS_KEY]) {
          this.invalidateSettingsCache();
        }
      });
    } catch {
      // Storage events unavailable (tests/non-extension hosts): cache stays
      // valid until the next save clears it.
    }
  }

  private invalidateSettingsCache(): void {
    this.settingsRevision += 1;
    this.settingsCache = null;
  }

  private normalizeCrawlingDomain(domain: string): string {
    return domain.trim().toLowerCase();
  }

  private getCrawlingConfigOverrides(configs: CrawlingConfig[]): CrawlingConfig[] {
    const defaultsByDomain = new Map(
      DEFAULT_SETTINGS.crawlingConfigs.map((config) => [
        this.normalizeCrawlingDomain(config.domain),
        config,
      ]),
    );
    return configs
      .filter((config) => {
        const bundledConfig = defaultsByDomain.get(this.normalizeCrawlingDomain(config.domain));
        return !bundledConfig || hasPersistedCrawlingConfigChanged(bundledConfig, config);
      })
      .map(({ fieldValidation: _fieldValidation, ...config }) => config);
  }

  async getSettings(): Promise<Settings> {
    try {
      if (this.settingsCache) {
        // Clone so callers can mutate the returned object freely without
        // poisoning the cache.
        return structuredClone(this.settingsCache);
      }
      const readRevision = this.settingsRevision;
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
      if (this.settingsRevision === readRevision) {
        this.settingsCache = structuredClone(merged);
      }
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
    const disabledDefaultConfigDomains = Array.from(
      new Set(
        (Array.isArray(stored.disabledDefaultConfigDomains)
          ? stored.disabledDefaultConfigDomains
          : []
        )
          .map((domain) => this.normalizeCrawlingDomain(domain))
          .filter((domain) => domain.length > 0),
      ),
    );
    const disabledDomains = new Set(disabledDefaultConfigDomains);
    const configMap = new Map<string, CrawlingConfig>();
    for (const config of defaultConfigs) {
      const normalizedDomain = this.normalizeCrawlingDomain(config.domain);
      if (disabledDomains.has(normalizedDomain)) {
        continue;
      }
      configMap.set(normalizedDomain, {
        ...config,
        domain: normalizedDomain,
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
    merged.crawlingConfigs = Array.from(configMap.values()).map((config) => ({
      ...config,
      ...(stored.crawlingConfigValidationByDomain?.[config.domain]
        ? { fieldValidation: stored.crawlingConfigValidationByDomain[config.domain] }
        : {}),
    }));
    merged.disabledDefaultConfigDomains = disabledDefaultConfigDomains;
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
    merged.language = normalizeLanguageSetting(stored.language);
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

  async saveSettings(
    settings: SettingsPatch,
    expectedCrawlingConfigsFingerprint?: string,
    expectedAiEndpoint?: string,
    expectedAiProtocol?: AIProtocol,
  ): Promise<void> {
    return this.saveMutex.withLock(async () => {
      if (
        (settings.aiModel?.apiUrl !== undefined ||
          settings.aiModel?.apiKey !== undefined ||
          settings.aiModel?.protocol !== undefined ||
          expectedAiProtocol !== undefined) &&
        expectedAiEndpoint === undefined
      ) {
        throw new ExtensionError(
          ErrorCode.VALIDATION_ERROR,
          'AI endpoint precondition is required',
          {
            messageKey: 'options.settingsConflict',
          },
        );
      }
      await this._saveSettings(
        settings,
        expectedCrawlingConfigsFingerprint,
        expectedAiEndpoint,
        expectedAiProtocol,
      );
    });
  }

  async updateFieldValidation(
    domain: string,
    validation: Record<string, FieldValidationStatus>,
  ): Promise<void> {
    return this.saveMutex.withLock(async () => {
      const settings = await this.getSettings();
      const normalized = this.normalizeCrawlingDomain(domain);
      if (!settings.crawlingConfigs.some((config) => config.domain === normalized)) return;
      await this._saveSettings({
        crawlingConfigValidationByDomain: {
          ...settings.crawlingConfigValidationByDomain,
          [normalized]: validation,
        },
      });
    });
  }

  async updateCrawlingConfigs(
    updater: (configs: CrawlingConfig[]) => CrawlingConfig[],
  ): Promise<void> {
    return this.saveMutex.withLock(async () => {
      const settings = await this.getSettings();
      const updatedConfigs = updater(structuredClone(settings.crawlingConfigs));
      await this._saveSettings({ crawlingConfigs: updatedConfigs });
    });
  }

  private async _saveSettings(
    settings: SettingsPatch,
    expectedCrawlingConfigsFingerprint?: string,
    expectedAiEndpoint?: string,
    expectedAiProtocol?: AIProtocol,
  ): Promise<void> {
    try {
      const updatesCrawlingConfigs =
        Object.prototype.hasOwnProperty.call(settings, 'crawlingConfigs') &&
        Array.isArray(settings.crawlingConfigs);
      if (!isWithinValidationBudget(settings)) {
        throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Settings data is too large');
      }
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
      if (
        sanitizedSettings.crawlingConfigs &&
        expectedCrawlingConfigsFingerprint !== undefined &&
        crawlingConfigsFingerprint(currentSettings.crawlingConfigs) !==
          expectedCrawlingConfigsFingerprint
      ) {
        throw new ExtensionError(
          ErrorCode.VALIDATION_ERROR,
          'Crawling rules changed; reload settings before saving',
          {
            messageKey: 'options.settingsConflict',
          },
        );
      }
      const currentModel = this.normalizeAIModel(currentSettings);
      if (
        expectedAiEndpoint !== undefined &&
        ((normalizeAiApiUrl(currentModel.apiUrl) ?? currentModel.apiUrl.trim()) !==
          (normalizeAiApiUrl(expectedAiEndpoint) ?? expectedAiEndpoint.trim()) ||
          currentModel.protocol !== (expectedAiProtocol ?? AI.DEFAULT_PROTOCOL))
      ) {
        throw new ExtensionError(
          ErrorCode.VALIDATION_ERROR,
          'AI endpoint or protocol changed; reload settings before saving',
          {
            messageKey: 'options.settingsConflict',
          },
        );
      }
      const updatedSettings = { ...currentSettings, ...sanitizedSettings } as Settings & {
        extractorModel?: AIConfig;
        analyzerModel?: AIConfig;
      };
      updatedSettings.language = normalizeLanguageSetting(updatedSettings.language);
      updatedSettings.aiModel = {
        ...currentModel,
        ...(sanitizedSettings.aiModel || {}),
      };

      updatedSettings.domAnalysisConfig = {
        ...currentSettings.domAnalysisConfig,
        ...(sanitizedSettings.domAnalysisConfig || {}),
      };

      if (updatesCrawlingConfigs) {
        const configuredDomains = new Set(
          (sanitizedSettings.crawlingConfigs || []).map((config) =>
            this.normalizeCrawlingDomain(config.domain),
          ),
        );
        const defaultDomains = new Set(
          DEFAULT_SETTINGS.crawlingConfigs.map((config) =>
            this.normalizeCrawlingDomain(config.domain),
          ),
        );
        const disabledDomains = new Set(
          updatedSettings.disabledDefaultConfigDomains.filter(
            (domain) => !defaultDomains.has(this.normalizeCrawlingDomain(domain)),
          ),
        );
        for (const domain of defaultDomains) {
          if (!configuredDomains.has(domain)) {
            disabledDomains.add(domain);
          }
        }
        updatedSettings.disabledDefaultConfigDomains = Array.from(disabledDomains);
      }

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

      const validation = { ...updatedSettings.crawlingConfigValidationByDomain };
      for (const config of updatedSettings.crawlingConfigs) {
        if (config.fieldValidation && !validation[this.normalizeCrawlingDomain(config.domain)]) {
          validation[this.normalizeCrawlingDomain(config.domain)] = config.fieldValidation;
        }
      }
      await chrome.storage.local.set({
        [STORAGE.SETTINGS_KEY]: {
          ...updatedSettings,
          crawlingConfigValidationByDomain: validation,
          crawlingConfigs: this.getCrawlingConfigOverrides(updatedSettings.crawlingConfigs),
        },
      });
      this.invalidateSettingsCache();

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
      // Never export the decrypted API key. Import keeps the current key only
      // for the same endpoint and clears it when an exported endpoint changes.
      const {
        crawlingConfigs: _crawlingConfigs,
        selectorCache: _selectorCache,
        disabledDefaultConfigDomains: _disabledDefaultConfigDomains,
        crawlingConfigValidationByDomain: _crawlingConfigValidationByDomain,
        ...settingsToExport
      } = settings;
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
        if (data.length > 10_000_000) {
          throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Settings import is too large');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch (parseError) {
          throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Invalid settings JSON', {
            originalError: parseError instanceof Error ? parseError.message : String(parseError),
          });
        }

        if (!isWithinValidationBudget(parsed)) {
          throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Settings import is too large');
        }
        // Reuse the same zod-driven sanitizer that protects stored settings, so
        // imported payloads cannot inject unknown fields or bypass type checks.
        const sanitized = sanitizeStoredSettings(parsed);
        const currentSettings = await this.getSettings();
        const {
          crawlingConfigs: _crawlingConfigs,
          selectorCache: _selectorCache,
          disabledDefaultConfigDomains: _disabledDefaultConfigDomains,
          crawlingConfigValidationByDomain: _crawlingConfigValidationByDomain,
          ...rest
        } = sanitized;
        // Older exports with an endpoint always described Chat Completions.
        // Keep protocol-free partial imports from changing the current protocol.
        const importedModel =
          rest.aiModel?.apiUrl !== undefined
            ? { ...rest.aiModel, protocol: rest.aiModel.protocol ?? AI.DEFAULT_PROTOCOL }
            : rest.aiModel;
        if (
          typeof importedModel?.apiKey === 'string' &&
          importedModel.apiKey.startsWith(SECURITY.ENCRYPTION_PREFIX)
        ) {
          throw new ExtensionError(
            ErrorCode.VALIDATION_ERROR,
            'Encrypted API keys cannot be imported; enter the key again',
          );
        }
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
        const settingsToImport: Partial<Settings> = {
          ...rest,
          aiModel: { ...currentSettings.aiModel, ...importedModel, apiKey } as AIConfig,
        };
        await this._saveSettings(settingsToImport);
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
