import { Settings, HistoryItem, AIConfig } from '../types';
import { SECURITY, API, STORAGE, AI, LANGUAGES, ERRORS, HISTORY } from '@/config/constants';
import LZString from 'lz-string';
import { Logger } from '../utils/logger';
import { ErrorHandler } from '../utils/errors';

/**
 * Default settings for the extension
 */
const DEFAULT_SETTINGS: Settings = {
  maxComments: 500,
  aiModel: {
    apiUrl: API.DEFAULT_URL,
    apiKey: '',
    model: 'gpt-4',
    maxTokens: AI.DEFAULT_MAX_TOKENS,
    temperature: AI.DEFAULT_TEMPERATURE,
    topP: AI.DEFAULT_TOP_P,
  },
  analyzerPromptTemplate: `You are a professional social media analyst. Analyze the following comments and provide insights.

## Post Information:
- **Title**: {title}
- **Platform**: {platform}
- **URL**: {url}
- **Published**: {video_time}

## Comments Data (Dense Format):
{comments_data}

## Analysis Requirements:
1. Sentiment Analysis: Categorize comments as positive, negative, or neutral
2. Hot Comments: Identify top comments by engagement and explain why they're popular
3. Key Insights: Extract main themes, concerns, and trends
4. Summary Statistics: Provide overall metrics

## Output Format:
Generate a comprehensive analysis report in Markdown format.`,
  language: LANGUAGES.DEFAULT,
  selectorRetryAttempts: 3,
  selectorCache: [],
  domAnalysisConfig: {
    initialDepth: 3,
    expandDepth: 2,
    maxDepth: 10,
  },
  developerMode: false,
};

/**
 * StorageManager handles all data persistence operations
 * using Chrome's storage API
 */
export class StorageManager {
  private static readonly SETTINGS_KEY = STORAGE.SETTINGS_KEY;
  private static readonly HISTORY_KEY = STORAGE.HISTORY_KEY;
  private static readonly HISTORY_INDEX_KEY = STORAGE.HISTORY_INDEX_KEY;
  private static readonly HISTORY_URL_INDEX_KEY = STORAGE.HISTORY_URL_INDEX_KEY;
  private static readonly ENCRYPTION_SALT_KEY = STORAGE.ENCRYPTION_SALT_KEY;
  private static readonly ENCRYPTION_SECRET_KEY = STORAGE.ENCRYPTION_SECRET_KEY;
  private static readonly TOKEN_STATS_KEY = STORAGE.TOKEN_STATS_KEY;
  private encryptionKey?: CryptoKey;
  private encryptionEnabled = false;
  private encryptionInitPromise?: Promise<void>;

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
      { name: 'AES-GCM', length: 256 },
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
    return `enc:${base64}`;
  }

  private async decrypt(text: string): Promise<string> {
    if (!text.startsWith('enc:')) return text;
    if (!this.encryptionKey) return '';
    try {
      const base64 = text.slice(4);
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
      const result = await chrome.storage.local.get(StorageManager.SETTINGS_KEY);
      const settings = result[StorageManager.SETTINGS_KEY];

      if (!settings) {
        Logger.info('[StorageManager] No settings found, using defaults');
        // Return default settings if none exist
        await this.saveSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
      }

      // Merge with defaults to ensure all fields exist
      const merged = {
        ...DEFAULT_SETTINGS,
        ...settings,
      } as Settings & { extractorModel?: AIConfig; analyzerModel?: AIConfig };

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
      throw new Error(ERRORS.FAILED_TO_SAVE_SETTINGS);
    }
  }

  /**
   * Export settings as JSON string
   * @returns JSON string of settings
   */
  async exportSettings(): Promise<string> {
    try {
      const settings = await this.getSettings();
      return JSON.stringify(settings, null, 2);
    } catch (error) {
      Logger.error('[StorageManager] Failed to export settings', { error });
      throw new Error(ERRORS.FAILED_TO_EXPORT_SETTINGS);
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
        throw new Error(ERRORS.INVALID_SETTINGS_FORMAT);
      }

      await this.saveSettings(settings);
      Logger.info('[StorageManager] Settings imported successfully');
    } catch (error) {
      Logger.error('[StorageManager] Failed to import settings', { error });
      throw new Error(ERRORS.FAILED_TO_IMPORT_SETTINGS);
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

      // Update history index
      await this.updateHistoryIndex(item.id);

      // Update URL index
      if (typeof item.url === 'string' && item.url.length > 0) {
        await this.addToHistoryUrlIndex(item.url, item.id);
      }

      Logger.info('[StorageManager] History item saved', { id: item.id });
    } catch (error) {
      Logger.error('[StorageManager] Failed to save history', { error });
      throw new Error(ERRORS.FAILED_TO_SAVE_HISTORY);
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

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }

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
      const items: HistoryItem[] = [];

      for (const id of index) {
        const item = await this.getHistoryItem(id);
        if (item) {
          items.push(item);
        }
      }

      // Sort by extractedAt (newest first)
      return items.sort((a, b) => b.extractedAt - a.extractedAt);
    } catch (error) {
      Logger.error('[StorageManager] Failed to get history', { error });
      return [];
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
      await this.removeFromHistoryIndex(id);

      if (storedItem?.url) {
        await this.removeFromHistoryUrlIndex(storedItem.url, id);
      }
      Logger.info('[StorageManager] History item deleted', { id });
    } catch (error) {
      Logger.error('[StorageManager] Failed to delete history item', { id, error });
      throw new Error(ERRORS.FAILED_TO_DELETE_HISTORY);
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
      const result = await chrome.storage.local.get(StorageManager.HISTORY_INDEX_KEY);
      return (result[StorageManager.HISTORY_INDEX_KEY] as string[] | undefined) || [];
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
      const result = await chrome.storage.local.get(StorageManager.HISTORY_URL_INDEX_KEY);
      const index = result[StorageManager.HISTORY_URL_INDEX_KEY] as
        | Record<string, string[]>
        | undefined;
      return index || {};
    } catch (error) {
      Logger.error('[StorageManager] Failed to get history url index', { error });
      return {};
    }
  }

  private async setHistoryUrlIndex(index: Record<string, string[]>): Promise<void> {
    try {
      await chrome.storage.local.set({ [StorageManager.HISTORY_URL_INDEX_KEY]: index });
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
    return (
      typeof c.apiUrl === 'string' &&
      typeof c.apiKey === 'string' &&
      typeof c.model === 'string' &&
      typeof c.maxTokens === 'number' &&
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
