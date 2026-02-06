import { Settings, HistoryItem, AIConfig, CrawlingConfig } from '../types';
import {
  API,
  AI,
  LANGUAGES,
  THEME,
  RETRY,
  STORAGE,
  SECURITY,
  HISTORY,
  DEFAULTS,
  DOM_ANALYSIS_DEFAULTS,
} from '@/config/constants';
import DEFAULT_CRAWLING_RULES from '@/config/default_rules.json';
import LZString from 'lz-string';
import { Logger } from '../utils/logger';
import { ErrorHandler, ExtensionError, ErrorCode } from '../utils/errors';

/**
 * History index entry for fast pagination queries
 */
interface HistoryIndexEntry {
  id: string;
  extractedAt: number;
  url: string;
  title: string;
  platform: string;
}

/**
 * Sorted history index for efficient pagination
 */
interface HistorySortedIndex {
  entries: HistoryIndexEntry[];
  lastUpdated: number;
}

/**
 * Default settings for the extension
 */
const DEFAULT_SETTINGS: Settings = {
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
  analyzerPromptTemplate: `You are a professional social media analyst. Analyze the following comments and provide insights.

## Post Information:
- **Title**: {title}
- **Platform**: {platform}
- **URL**: {url}
- **Published**: {post_time}

## Post Content (Original):
{post_content}

## Comments Data (Dense Format):
{comments_data}

## Analysis Requirements:
1. Sentiment Analysis: Categorize comments as positive, negative, or neutral
2. Hot Comments: Identify top comments by engagement and explain why they're popular
3. Key Insights: Extract main themes, concerns, and trends
4. Summary Statistics: Provide overall metrics

## Output Format:
Generate a comprehensive analysis report in Markdown format.

## Post Content Summary
[Summarize the original post content or video description to capture the author's intent]`,
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

/**
 * StorageManager handles all data persistence operations
 * using Chrome's storage API.
 *
 * Features:
 * - Settings management with defaults
 * - History storage with compression (lz-string)
 * - API key encryption for security
 * - Indexed queries for fast pagination
 * - AI log storage for debugging
 *
 * @example
 * ```typescript
 * const storageManager = new StorageManager();
 * const settings = await storageManager.getSettings();
 * await storageManager.saveHistory(historyItem);
 * ```
 */
export class StorageManager {
  private static readonly SETTINGS_KEY = STORAGE.SETTINGS_KEY;
  private static readonly HISTORY_KEY = STORAGE.HISTORY_KEY;
  private static readonly HISTORY_INDEX_KEY = STORAGE.HISTORY_INDEX_KEY;
  private static readonly HISTORY_URL_INDEX_KEY = STORAGE.HISTORY_URL_INDEX_KEY;
  private static readonly HISTORY_SORTED_INDEX_KEY = STORAGE.HISTORY_SORTED_INDEX_KEY;
  private static readonly ENCRYPTION_SALT_KEY = STORAGE.ENCRYPTION_SALT_KEY;
  private static readonly ENCRYPTION_SECRET_KEY = STORAGE.ENCRYPTION_SECRET_KEY;
  private static readonly TOKEN_STATS_KEY = STORAGE.TOKEN_STATS_KEY;
  private static readonly AI_LOG_INDEX_KEY = STORAGE.AI_LOG_INDEX_KEY;
  private encryptionKey?: CryptoKey;
  private encryptionEnabled = false;
  private encryptionInitPromise?: Promise<void>;

  /** In-memory cache for sorted index to avoid repeated storage reads */
  private sortedIndexCache: HistorySortedIndex | null = null;

  private async getFromStorage<T>(key: string): Promise<T | undefined> {
    const result = await chrome.storage.local.get(key);
    return result[key] as T | undefined;
  }

  private async setToStorage(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  private async ensureEncryptionReady(): Promise<void> {
    if (this.encryptionEnabled) {
      return;
    }

    if (!this.encryptionInitPromise) {
      this.encryptionInitPromise = (async () => {
        try {
          const secret = await this.getOrCreateSecret();
          await this.enableEncryption(secret);
        } catch (error) {
          Logger.warn('[StorageManager] Failed to initialize encryption', { error });
          this.disableEncryption();
        }
      })();
    }

    await this.encryptionInitPromise;
  }

  private async getOrCreateSecret(): Promise<string> {
    const result = await chrome.storage.local.get(StorageManager.ENCRYPTION_SECRET_KEY);
    let secretBase64 = result[StorageManager.ENCRYPTION_SECRET_KEY] as string | undefined;
    if (!secretBase64) {
      const secret = crypto.getRandomValues(new Uint8Array(SECURITY.SECRET_LENGTH));
      secretBase64 = btoa(String.fromCharCode(...secret));
      await chrome.storage.local.set({ [StorageManager.ENCRYPTION_SECRET_KEY]: secretBase64 });
    }
    return secretBase64;
  }

  async enableEncryption(passphrase: string): Promise<void> {
    const salt = await this.getOrCreateSalt();
    const keyMaterial = await this.importKeyMaterial(passphrase);
    this.encryptionKey = await this.deriveKey(keyMaterial, salt);
    this.encryptionEnabled = true;
  }

  disableEncryption(): void {
    this.encryptionKey = undefined;
    this.encryptionEnabled = false;
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

      await chrome.storage.local.set({ [StorageManager.TOKEN_STATS_KEY]: stats });
      Logger.debug('[StorageManager] Token usage recorded', { tokens, stats });
    } catch (error) {
      Logger.error('[StorageManager] Failed to record token usage', { error });
    }
  }

  async getTokenStats(): Promise<{ today: number; total: number; lastReset: number }> {
    try {
      const result = await chrome.storage.local.get(StorageManager.TOKEN_STATS_KEY);
      const stats = result[StorageManager.TOKEN_STATS_KEY] as
        | { today: number; total: number; lastReset: number }
        | undefined;
      return stats || { today: 0, total: 0, lastReset: 0 };
    } catch (error) {
      Logger.error('[StorageManager] Failed to get token stats', { error });
      return { today: 0, total: 0, lastReset: 0 };
    }
  }

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
      Logger.warn('[StorageManager] Failed to save AI log', {
        logKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async getAiLogIndex(): Promise<string[]> {
    try {
      const index = await this.getFromStorage<string[]>(StorageManager.AI_LOG_INDEX_KEY);
      return Array.isArray(index) ? index : [];
    } catch {
      return [];
    }
  }

  private async setAiLogIndex(index: string[]): Promise<void> {
    try {
      await this.setToStorage(StorageManager.AI_LOG_INDEX_KEY, index);
    } catch {
      return;
    }
  }

  private async appendAiLogKey(logKey: string): Promise<void> {
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
      Logger.warn('[StorageManager] Failed to cleanup AI logs', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async getOrCreateSalt(): Promise<ArrayBuffer> {
    const result = await chrome.storage.local.get(StorageManager.ENCRYPTION_SALT_KEY);
    let saltBase64 = result[StorageManager.ENCRYPTION_SALT_KEY] as string | undefined;
    if (!saltBase64) {
      const salt = crypto.getRandomValues(new Uint8Array(SECURITY.SALT_LENGTH));
      saltBase64 = btoa(String.fromCharCode(...salt));
      await chrome.storage.local.set({ [StorageManager.ENCRYPTION_SALT_KEY]: saltBase64 });
    }
    const bytes = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));
    return bytes.buffer;
  }

  private async importKeyMaterial(passphrase: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, [
      'deriveBits',
      'deriveKey',
    ]);
  }

  private async deriveKey(keyMaterial: CryptoKey, salt: ArrayBuffer): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: SECURITY.PBKDF2_HASH,
        salt,
        iterations: SECURITY.PBKDF2_ITERATIONS,
      },
      keyMaterial,
      { name: 'AES-GCM', length: SECURITY.AES_KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private async encrypt(text: string): Promise<string> {
    if (!this.encryptionEnabled || !this.encryptionKey) return text;
    const iv = crypto.getRandomValues(new Uint8Array(SECURITY.IV_LENGTH));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.encryptionKey,
      enc.encode(text),
    );
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.byteLength);
    const base64 = btoa(String.fromCharCode(...combined));
    return `${SECURITY.ENCRYPTION_PREFIX}${base64}`;
  }

  private async decrypt(text: string): Promise<string> {
    if (!text.startsWith(SECURITY.ENCRYPTION_PREFIX)) return text;
    if (!this.encryptionKey) return '';
    try {
      const base64 = text.slice(SECURITY.ENCRYPTION_PREFIX.length);
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const iv = bytes.slice(0, SECURITY.IV_LENGTH);
      const data = bytes.slice(SECURITY.IV_LENGTH);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.encryptionKey,
        data,
      );
      const dec = new TextDecoder();
      return dec.decode(plaintext);
    } catch (error) {
      Logger.warn('[StorageManager] Failed to decrypt value', { error });
      return '';
    }
  }

  /**
   * Get current settings
   * @returns Settings object
   */
  async getSettings(): Promise<Settings> {
    try {
      await this.ensureEncryptionReady();
      Logger.debug('[StorageManager] Getting settings from storage');
      const settings = await this.getFromStorage<Settings>(StorageManager.SETTINGS_KEY);

      if (!settings) {
        Logger.info('[StorageManager] No settings found, using defaults');
        await this.saveSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
      }

      const merged = this.mergeSettingsWithDefaults(settings as Partial<Settings>);

      const normalizedModel = this.normalizeAIModel(merged);
      merged.aiModel = {
        ...normalizedModel,
        apiKey: await this.decrypt(normalizedModel.apiKey || ''),
      };

      delete (merged as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig })
        .extractorModel;
      delete (merged as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig })
        .analyzerModel;
      Logger.debug('[StorageManager] Settings retrieved successfully');
      return merged;
    } catch (error) {
      Logger.error('[StorageManager] Failed to get settings', { error });
      await ErrorHandler.handleError(error as Error, 'StorageManager.getSettings');
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
      configMap.set(config.domain, config);
    }
    for (const config of storedConfigs) {
      configMap.set(config.domain, config);
    }
    merged.crawlingConfigs = Array.from(configMap.values());

    return merged;
  }

  /**
   * Save settings (partial update supported)
   * @param settings - Settings to save (can be partial)
   */
  async saveSettings(settings: Partial<Settings>): Promise<void> {
    try {
      await this.ensureEncryptionReady();
      Logger.debug('[StorageManager] Saving settings');

      // Get current settings directly from storage to avoid recursion
      const result = await chrome.storage.local.get(StorageManager.SETTINGS_KEY);
      const currentSettings = result[StorageManager.SETTINGS_KEY] || DEFAULT_SETTINGS;
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
          apiKey: await this.encrypt(updatedSettings.aiModel.apiKey),
        } as AIConfig;
      }

      delete (updatedSettings as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig })
        .extractorModel;
      delete (updatedSettings as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig })
        .analyzerModel;

      await chrome.storage.local.set({
        [StorageManager.SETTINGS_KEY]: updatedSettings,
      });

      Logger.info('[StorageManager] Settings saved successfully');
    } catch (error) {
      Logger.error('[StorageManager] Failed to save settings', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save settings', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Update selector cache for a specific hostname
   * @param hostname - Hostname to cache selector for
   * @param selector - Selector string
   */
  async updateSelectorCache(hostname: string, selector: string): Promise<void> {
    try {
      await this.ensureEncryptionReady();
      const settings = await this.getSettings();
      const currentCache = settings.selectorCache || [];

      // Remove existing entry for this hostname if exists
      // Remove existing entry for this hostname if exists
      const filtered = currentCache.filter((item) => item.domain !== hostname);

      // Add new entry
      filtered.push({
        domain: hostname,
        selectors: {
          commentContainer: selector,
        },
        lastUsed: Date.now(),
        successCount: 1,
      });

      await this.saveSettings({ selectorCache: filtered });
      Logger.info('[StorageManager] Selector cache updated', { hostname, selector });
    } catch (error) {
      Logger.error('[StorageManager] Failed to update selector cache', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to update selector cache');
    }
  }

  /**
   * Get crawling config for a specific domain
   * @param domain - Domain to get config for (exact match or subdomain match)
   */
  async getCrawlingConfig(domain: string): Promise<CrawlingConfig | null> {
    try {
      await this.ensureEncryptionReady();
      const settings = await this.getSettings();
      const configs = settings.crawlingConfigs || [];

      // 1. Exact match
      const exact = configs.find((c) => c.domain === domain);
      if (exact) return exact;

      // 2. Suffix match (e.g. m.youtube.com -> youtube.com)
      // Sort keys by length desc to match longest suffix (most specific)
      const matches = configs.filter((c) => domain.endsWith(c.domain));
      if (matches.length > 0) {
        // Return the one with the longest domain string (best match)
        return matches.sort((a, b) => b.domain.length - a.domain.length)[0];
      }

      return null;
    } catch (error) {
      Logger.warn('[StorageManager] Failed to get crawling config', { error });
      return null;
    }
  }

  /**
   * Sync crawling configs from remote GitHub repository
   */
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
        const index = merged.findIndex((c) => c.id === remote.id);
        if (index >= 0) {
          merged[index] = { ...merged[index], ...remote, lastUpdated: Date.now() };
          updated++;
        } else {
          merged.push({ ...remote, lastUpdated: Date.now() });
          added++;
        }
      }

      await this.saveSettings({ crawlingConfigs: merged });
      Logger.info('[StorageManager] Crawling configs synced successfully', { added, updated });
      return { added, updated };
    } catch (error) {
      Logger.error('[StorageManager] Failed to sync crawling configs', { error });
      throw error;
    }
  }

  /**
   * Save or update a crawling config
   */
  async saveCrawlingConfig(config: CrawlingConfig): Promise<void> {
    try {
      await this.ensureEncryptionReady();
      const settings = await this.getSettings();
      const configs = settings.crawlingConfigs || [];

      const index = configs.findIndex((c) => c.domain === config.domain);
      if (index >= 0) {
        configs[index] = config;
      } else {
        configs.push(config);
      }

      await this.saveSettings({ crawlingConfigs: configs });
      Logger.info('[StorageManager] Crawling config saved', { domain: config.domain });
    } catch (error) {
      Logger.error('[StorageManager] Failed to save crawling config', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save crawling config');
    }
  }

  /**
   * Export settings as JSON string
   * @returns JSON string of settings
   */
  async exportSettings(): Promise<string> {
    try {
      const settings = await this.getSettings();
      const { crawlingConfigs: _crawlingConfigs, ...settingsToExport } = settings;
      return JSON.stringify(settingsToExport, null, 2);
    } catch (error) {
      Logger.error('[StorageManager] Failed to export settings', { error });
      throw new ExtensionError(ErrorCode.STORAGE_READ_ERROR, 'Failed to export settings', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Import settings from JSON string
   * @param data - JSON string of settings
   */
  async importSettings(data: string): Promise<void> {
    try {
      const settings = JSON.parse(data) as Settings;

      // Validate settings structure
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
      Logger.info('[StorageManager] Settings imported successfully');
    } catch (error) {
      Logger.error('[StorageManager] Failed to import settings', { error });
      if (error instanceof ExtensionError) {
        throw error;
      }
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to import settings', {
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Save a history item
   * @param item - History item to save
   */
  async saveHistory(item: HistoryItem): Promise<void> {
    try {
      const baseKey = `${StorageManager.HISTORY_KEY}_${item.id}`;

      // Compress comments data to save space
      const compressedComments = LZString.compressToUTF16(JSON.stringify(item.comments));

      const chunks: string[] = [];
      for (let i = 0; i < compressedComments.length; i += HISTORY.COMMENTS_CHUNK_SIZE) {
        chunks.push(compressedComments.slice(i, i + HISTORY.COMMENTS_CHUNK_SIZE));
      }

      const toSet: Record<string, unknown> = {};

      if (chunks.length <= 1) {
        toSet[baseKey] = {
          ...item,
          comments: compressedComments,
        };
      } else {
        for (let i = 0; i < chunks.length; i++) {
          toSet[`${baseKey}_comments_${i}`] = chunks[i];
        }

        toSet[baseKey] = {
          ...item,
          comments: '',
          commentsChunks: chunks.length,
        };
      }

      await chrome.storage.local.set(toSet);

      await this.updateHistoryIndex(item.id);

      const indexUpdates: Promise<void>[] = [this.addToSortedIndex(item)];
      if (typeof item.url === 'string' && item.url.length > 0) {
        indexUpdates.push(this.addToHistoryUrlIndex(item.url, item.id));
      }
      await Promise.all(indexUpdates);

      Logger.info('[StorageManager] History item saved', { id: item.id });
    } catch (error) {
      this.sortedIndexCache = null;
      Logger.error('[StorageManager] Failed to save history', { error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to save history', {
        historyId: item.id,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getLatestHistoryIdByUrl(url: string): Promise<string | null> {
    try {
      if (!url) {
        return null;
      }

      const index = await this.getHistoryUrlIndex();
      const ids = index[url];
      if (!ids || ids.length === 0) {
        return null;
      }
      return ids[ids.length - 1] || null;
    } catch (error) {
      Logger.error('[StorageManager] Failed to get history id by url', { url, error });
      return null;
    }
  }

  async clearAllHistory(): Promise<number> {
    try {
      const ids = await this.getHistoryIndex();
      const keysToRemove: string[] = [];

      for (const id of ids) {
        const baseKey = `${StorageManager.HISTORY_KEY}_${id}`;
        keysToRemove.push(baseKey);

        try {
          const meta = await chrome.storage.local.get(baseKey);
          const storedItem = meta[baseKey] as { commentsChunks?: number } | undefined;
          const chunks = storedItem?.commentsChunks || 0;
          for (let i = 0; i < chunks; i++) {
            keysToRemove.push(`${baseKey}_comments_${i}`);
          }
        } catch {
          // ignore
        }
      }

      keysToRemove.push(StorageManager.HISTORY_INDEX_KEY);
      keysToRemove.push(StorageManager.HISTORY_URL_INDEX_KEY);
      keysToRemove.push(StorageManager.HISTORY_SORTED_INDEX_KEY);

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }

      // Invalidate cache
      this.sortedIndexCache = null;

      return ids.length;
    } catch (error) {
      Logger.error('[StorageManager] Failed to clear all history', { error });
      return 0;
    }
  }

  /**
   * Get all history items
   * @returns Array of history items
   */
  async getHistory(): Promise<HistoryItem[]> {
    try {
      const index = await this.getHistoryIndex();
      const results = await Promise.all(index.map((id) => this.getHistoryItem(id)));
      const items = results.filter((item): item is HistoryItem => item !== null);

      return items.sort((a, b) => b.extractedAt - a.extractedAt);
    } catch (error) {
      Logger.error('[StorageManager] Failed to get history', { error });
      return [];
    }
  }

  /**
   * Get a page of history items using the sorted index for efficient pagination
   * @param page - Page number (0-indexed)
   * @param pageSize - Number of items per page
   * @returns Object containing items and pagination metadata
   */
  async getHistoryPage(
    page: number = 0,
    pageSize: number = 20,
  ): Promise<{
    items: HistoryItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    try {
      const sortedIndex = await this.getOrBuildSortedIndex();
      const total = sortedIndex.entries.length;
      const totalPages = Math.ceil(total / pageSize);

      // Calculate slice bounds
      const start = page * pageSize;
      const end = Math.min(start + pageSize, total);

      const pageEntries = sortedIndex.entries.slice(start, end);
      const results = await Promise.all(pageEntries.map((entry) => this.getHistoryItem(entry.id)));
      const items = results.filter((item): item is HistoryItem => item !== null);

      Logger.debug('[StorageManager] History page retrieved', {
        page,
        pageSize,
        itemCount: items.length,
        total,
      });

      return {
        items,
        total,
        page,
        pageSize,
        totalPages,
      };
    } catch (error) {
      Logger.error('[StorageManager] Failed to get history page', { error });
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
      };
    }
  }

  /**
   * Get history metadata without loading full items (for fast listing)
   * @param page - Page number (0-indexed)
   * @param pageSize - Number of items per page
   * @returns Object containing metadata entries and pagination info
   */
  async getHistoryMetadataPage(
    page: number = 0,
    pageSize: number = 20,
  ): Promise<{
    entries: HistoryIndexEntry[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    try {
      const sortedIndex = await this.getOrBuildSortedIndex();
      const total = sortedIndex.entries.length;
      const totalPages = Math.ceil(total / pageSize);

      const start = page * pageSize;
      const end = Math.min(start + pageSize, total);
      const entries = sortedIndex.entries.slice(start, end);

      return {
        entries,
        total,
        page,
        pageSize,
        totalPages,
      };
    } catch (error) {
      Logger.error('[StorageManager] Failed to get history metadata page', { error });
      return {
        entries: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
      };
    }
  }

  /**
   * Search history with pagination using the sorted index
   * @param query - Search query
   * @param page - Page number (0-indexed)
   * @param pageSize - Number of items per page
   * @returns Object containing filtered items and pagination metadata
   */
  async searchHistoryPaginated(
    query: string,
    page: number = 0,
    pageSize: number = 20,
  ): Promise<{
    items: HistoryItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    try {
      const sortedIndex = await this.getOrBuildSortedIndex();
      const lowerQuery = query.toLowerCase();

      // Filter entries using index metadata (fast, no full item load)
      const matchingEntries = sortedIndex.entries.filter(
        (entry) =>
          entry.title.toLowerCase().includes(lowerQuery) ||
          entry.url.toLowerCase().includes(lowerQuery) ||
          entry.platform.toLowerCase().includes(lowerQuery),
      );

      const total = matchingEntries.length;
      const totalPages = Math.ceil(total / pageSize);

      const start = page * pageSize;
      const end = Math.min(start + pageSize, total);
      const pageEntries = matchingEntries.slice(start, end);

      // Load full items only for the current page
      const items: HistoryItem[] = [];
      for (const entry of pageEntries) {
        const item = await this.getHistoryItem(entry.id);
        if (item) {
          items.push(item);
        }
      }

      return {
        items,
        total,
        page,
        pageSize,
        totalPages,
      };
    } catch (error) {
      Logger.error('[StorageManager] Failed to search history paginated', { error });
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
      };
    }
  }

  /**
   * Get a specific history item by ID
   * @param id - History item ID
   * @returns History item or undefined
   */
  async getHistoryItem(id: string): Promise<HistoryItem | undefined> {
    try {
      const baseKey = `${StorageManager.HISTORY_KEY}_${id}`;
      const result = await chrome.storage.local.get(baseKey);
      const compressedItem = result[baseKey] as
        | (Omit<HistoryItem, 'comments'> & { comments: string; commentsChunks?: number })
        | undefined;

      if (!compressedItem) {
        return undefined;
      }

      let compressedComments = compressedItem.comments;

      if (!compressedComments && typeof compressedItem.commentsChunks === 'number') {
        const chunks: string[] = [];
        for (let i = 0; i < compressedItem.commentsChunks; i++) {
          const chunkKey = `${baseKey}_comments_${i}`;
          const chunkResult = await chrome.storage.local.get(chunkKey);
          const chunk = chunkResult[chunkKey] as string | undefined;
          if (typeof chunk === 'string') {
            chunks.push(chunk);
          }
        }
        compressedComments = chunks.join('');
      }

      const decompressed = compressedComments
        ? LZString.decompressFromUTF16(compressedComments)
        : null;
      const comments = decompressed ? JSON.parse(decompressed) : [];

      return {
        ...compressedItem,
        comments,
      } as HistoryItem;
    } catch (error) {
      Logger.error('[StorageManager] Failed to get history item', { id, error });
      return undefined;
    }
  }

  /**
   * Delete a history item
   * @param id - History item ID
   */
  async deleteHistoryItem(id: string): Promise<void> {
    try {
      const baseKey = `${StorageManager.HISTORY_KEY}_${id}`;
      const meta = await chrome.storage.local.get(baseKey);
      const storedItem = meta[baseKey] as { url?: string; commentsChunks?: number } | undefined;

      const keysToRemove: string[] = [baseKey];
      const chunks = storedItem?.commentsChunks || 0;
      for (let i = 0; i < chunks; i++) {
        keysToRemove.push(`${baseKey}_comments_${i}`);
      }

      await chrome.storage.local.remove(keysToRemove);

      const indexRemovals: Promise<void>[] = [
        this.removeFromHistoryIndex(id),
        this.removeFromSortedIndex(id),
      ];
      if (storedItem?.url) {
        indexRemovals.push(this.removeFromHistoryUrlIndex(storedItem.url, id));
      }
      await Promise.all(indexRemovals);
      Logger.info('[StorageManager] History item deleted', { id });
    } catch (error) {
      this.sortedIndexCache = null;
      Logger.error('[StorageManager] Failed to delete history item', { id, error });
      throw new ExtensionError(ErrorCode.STORAGE_WRITE_ERROR, 'Failed to delete history', {
        historyId: id,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Search history by query string
   * @param query - Search query
   * @returns Filtered history items
   */
  async searchHistory(query: string): Promise<HistoryItem[]> {
    try {
      const allHistory = await this.getHistory();
      const lowerQuery = query.toLowerCase();

      return allHistory.filter(
        (item) =>
          item.title.toLowerCase().includes(lowerQuery) ||
          item.url.toLowerCase().includes(lowerQuery) ||
          item.platform.toLowerCase().includes(lowerQuery),
      );
    } catch (error) {
      Logger.error('[StorageManager] Failed to search history', { error });
      return [];
    }
  }

  /**
   * Get history index (list of IDs)
   * @returns Array of history item IDs
   */
  private async getHistoryIndex(): Promise<string[]> {
    try {
      return (await this.getFromStorage<string[]>(StorageManager.HISTORY_INDEX_KEY)) || [];
    } catch (error) {
      Logger.error('[StorageManager] Failed to get history index', { error });
      return [];
    }
  }

  /**
   * Update history index with new ID
   * @param id - History item ID to add
   */
  private async updateHistoryIndex(id: string): Promise<void> {
    try {
      const index = await this.getHistoryIndex();

      if (!index.includes(id)) {
        index.push(id);
      }

      if (index.length > HISTORY.MAX_ITEMS) {
        const toRemove = index.slice(0, index.length - HISTORY.MAX_ITEMS);
        const kept = index.slice(index.length - HISTORY.MAX_ITEMS);

        await chrome.storage.local.set({
          [StorageManager.HISTORY_INDEX_KEY]: kept,
        });

        for (const oldId of toRemove) {
          try {
            await this.deleteHistoryItem(oldId);
          } catch (e) {
            Logger.warn('[StorageManager] Failed to prune history item', { id: oldId, error: e });
          }
        }

        return;
      }

      await chrome.storage.local.set({
        [StorageManager.HISTORY_INDEX_KEY]: index,
      });
    } catch (error) {
      Logger.error('[StorageManager] Failed to update history index', { error });
    }
  }

  /**
   * Remove ID from history index
   * @param id - History item ID to remove
   */
  private async removeFromHistoryIndex(id: string): Promise<void> {
    try {
      const index = await this.getHistoryIndex();
      const filteredIndex = index.filter((itemId) => itemId !== id);

      await chrome.storage.local.set({
        [StorageManager.HISTORY_INDEX_KEY]: filteredIndex,
      });
    } catch (error) {
      Logger.error('[StorageManager] Failed to remove from history index', { error });
    }
  }

  private async getHistoryUrlIndex(): Promise<Record<string, string[]>> {
    try {
      return (
        (await this.getFromStorage<Record<string, string[]>>(
          StorageManager.HISTORY_URL_INDEX_KEY,
        )) || {}
      );
    } catch (error) {
      Logger.error('[StorageManager] Failed to get history url index', { error });
      return {};
    }
  }

  private async setHistoryUrlIndex(index: Record<string, string[]>): Promise<void> {
    try {
      await this.setToStorage(StorageManager.HISTORY_URL_INDEX_KEY, index);
    } catch (error) {
      Logger.error('[StorageManager] Failed to set history url index', { error });
    }
  }

  private async addToHistoryUrlIndex(url: string, id: string): Promise<void> {
    const index = await this.getHistoryUrlIndex();
    const existing = index[url] || [];
    const next = existing.includes(id) ? existing : [...existing, id];
    index[url] = next;
    await this.setHistoryUrlIndex(index);
  }

  private async removeFromHistoryUrlIndex(url: string, id: string): Promise<void> {
    const index = await this.getHistoryUrlIndex();
    const existing = index[url];
    if (!existing || existing.length === 0) {
      return;
    }
    const next = existing.filter((x) => x !== id);
    if (next.length === 0) {
      delete index[url];
    } else {
      index[url] = next;
    }
    await this.setHistoryUrlIndex(index);
  }

  /**
   * Get or build the sorted history index for efficient pagination
   * @returns Sorted history index
   */
  private async getOrBuildSortedIndex(): Promise<HistorySortedIndex> {
    // Return cached index if available
    if (this.sortedIndexCache) {
      return this.sortedIndexCache;
    }

    try {
      // Try to load from storage
      const result = await chrome.storage.local.get(StorageManager.HISTORY_SORTED_INDEX_KEY);
      const storedIndex = result[StorageManager.HISTORY_SORTED_INDEX_KEY] as
        | HistorySortedIndex
        | undefined;

      if (storedIndex && storedIndex.entries) {
        this.sortedIndexCache = storedIndex;
        return storedIndex;
      }

      // Build index from scratch
      return await this.rebuildSortedIndex();
    } catch (error) {
      Logger.error('[StorageManager] Failed to get sorted index', { error });
      return { entries: [], lastUpdated: Date.now() };
    }
  }

  /**
   * Rebuild the sorted index from all history items
   * @returns Newly built sorted index
   */
  private async rebuildSortedIndex(): Promise<HistorySortedIndex> {
    try {
      const ids = await this.getHistoryIndex();
      const entries: HistoryIndexEntry[] = [];

      for (const id of ids) {
        const baseKey = `${StorageManager.HISTORY_KEY}_${id}`;
        const result = await chrome.storage.local.get(baseKey);
        const item = result[baseKey] as
          | {
              id: string;
              extractedAt: number;
              url: string;
              title: string;
              platform: string;
            }
          | undefined;

        if (item) {
          entries.push({
            id: item.id,
            extractedAt: item.extractedAt,
            url: item.url,
            title: item.title,
            platform: item.platform,
          });
        }
      }

      // Sort by extractedAt descending (newest first)
      entries.sort((a, b) => b.extractedAt - a.extractedAt);

      const sortedIndex: HistorySortedIndex = {
        entries,
        lastUpdated: Date.now(),
      };

      // Save to storage and cache
      await chrome.storage.local.set({ [StorageManager.HISTORY_SORTED_INDEX_KEY]: sortedIndex });
      this.sortedIndexCache = sortedIndex;

      Logger.debug('[StorageManager] Sorted index rebuilt', { count: entries.length });
      return sortedIndex;
    } catch (error) {
      Logger.error('[StorageManager] Failed to rebuild sorted index', { error });
      return { entries: [], lastUpdated: Date.now() };
    }
  }

  /**
   * Update sorted index when a history item is added
   * @param item - History item to add to index
   */
  private async addToSortedIndex(item: HistoryItem): Promise<void> {
    try {
      const index = await this.getOrBuildSortedIndex();

      // Remove existing entry if present (for updates)
      const existingIdx = index.entries.findIndex((e) => e.id === item.id);
      if (existingIdx !== -1) {
        index.entries.splice(existingIdx, 1);
      }

      // Create new entry
      const entry: HistoryIndexEntry = {
        id: item.id,
        extractedAt: item.extractedAt,
        url: item.url,
        title: item.title,
        platform: item.platform,
      };

      // Insert in sorted position (binary search for efficiency)
      let left = 0;
      let right = index.entries.length;
      while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (index.entries[mid].extractedAt > entry.extractedAt) {
          left = mid + 1;
        } else {
          right = mid;
        }
      }
      index.entries.splice(left, 0, entry);

      index.lastUpdated = Date.now();

      // Save to storage and update cache
      await chrome.storage.local.set({ [StorageManager.HISTORY_SORTED_INDEX_KEY]: index });
      this.sortedIndexCache = index;
    } catch (error) {
      Logger.error('[StorageManager] Failed to add to sorted index', { error });
      // Invalidate cache on error
      this.sortedIndexCache = null;
    }
  }

  /**
   * Remove an item from the sorted index
   * @param id - History item ID to remove
   */
  private async removeFromSortedIndex(id: string): Promise<void> {
    try {
      const index = await this.getOrBuildSortedIndex();
      const idx = index.entries.findIndex((e) => e.id === id);

      if (idx !== -1) {
        index.entries.splice(idx, 1);
        index.lastUpdated = Date.now();

        await chrome.storage.local.set({ [StorageManager.HISTORY_SORTED_INDEX_KEY]: index });
        this.sortedIndexCache = index;
      }
    } catch (error) {
      Logger.error('[StorageManager] Failed to remove from sorted index', { error });
      this.sortedIndexCache = null;
    }
  }

  /**
   * Invalidate the sorted index cache
   */
  invalidateSortedIndexCache(): void {
    this.sortedIndexCache = null;
  }

  /**
   * Validate settings structure
   * @param settings - Settings to validate
   * @returns True if valid
   */
  private validateSettings(settings: unknown): settings is Settings {
    if (typeof settings !== 'object' || settings === null) {
      return false;
    }
    const s = settings as Record<string, unknown>;
    return (
      typeof s.maxComments === 'number' &&
      (this.validateAIConfig(s.aiModel) ||
        (this.validateAIConfig(s.extractorModel) && this.validateAIConfig(s.analyzerModel))) &&
      typeof s.analyzerPromptTemplate === 'string' &&
      typeof s.language === 'string'
    );
  }

  /**
   * Validate AI config structure
   * @param config - AI config to validate
   * @returns True if valid
   */
  private validateAIConfig(config: unknown): config is AIConfig {
    if (typeof config !== 'object' || config === null) {
      return false;
    }
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
