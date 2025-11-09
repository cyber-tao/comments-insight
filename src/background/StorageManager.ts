import { Settings, HistoryItem, AIConfig } from '../types';
import LZString from 'lz-string';

/**
 * Default settings for the extension
 */
const DEFAULT_SETTINGS: Settings = {
  maxComments: 500,
  extractorModel: {
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4',
    maxTokens: 4000,
    temperature: 0.7,
    topP: 0.9,
  },
  analyzerModel: {
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4',
    maxTokens: 4000,
    temperature: 0.7,
    topP: 0.9,
  },
  analyzerPromptTemplate: `You are a professional social media analyst. Analyze the following comments and provide insights.

## Comments Data:
{comments_json}

## Analysis Requirements:
1. Sentiment Analysis: Categorize comments as positive, negative, or neutral
2. Hot Comments: Identify top comments by engagement and explain why they're popular
3. Key Insights: Extract main themes, concerns, and trends
4. Summary Statistics: Provide overall metrics

## Output Format:
Generate a comprehensive analysis report in Markdown format.`,
  language: 'zh-CN',
  selectorRetryAttempts: 3,
};

/**
 * StorageManager handles all data persistence operations
 * using Chrome's storage API
 */
export class StorageManager {
  private static readonly SETTINGS_KEY = 'settings';
  private static readonly HISTORY_KEY = 'history';
  private static readonly HISTORY_INDEX_KEY = 'history_index';

  /**
   * Get current settings
   * @returns Settings object
   */
  async getSettings(): Promise<Settings> {
    try {
      console.log('[StorageManager] Getting settings from storage...');
      const result = await chrome.storage.local.get(StorageManager.SETTINGS_KEY);
      console.log('[StorageManager] Storage result:', result);
      const settings = result[StorageManager.SETTINGS_KEY];
      
      if (!settings) {
        console.log('[StorageManager] No settings found, saving defaults...');
        // Return default settings if none exist
        await this.saveSettings(DEFAULT_SETTINGS);
        console.log('[StorageManager] Defaults saved, returning...');
        return DEFAULT_SETTINGS;
      }
      
      console.log('[StorageManager] Settings found, merging with defaults...');
      // Merge with defaults to ensure all fields exist
      const merged = { ...DEFAULT_SETTINGS, ...settings };
      console.log('[StorageManager] Merged settings:', merged);
      return merged;
    } catch (error) {
      console.error('[StorageManager] Failed to get settings:', error);
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Save settings (partial update supported)
   * @param settings - Settings to save (can be partial)
   */
  async saveSettings(settings: Partial<Settings>): Promise<void> {
    try {
      console.log('[StorageManager] Saving settings:', settings);
      
      // Get current settings directly from storage to avoid recursion
      const result = await chrome.storage.local.get(StorageManager.SETTINGS_KEY);
      const currentSettings = result[StorageManager.SETTINGS_KEY] || DEFAULT_SETTINGS;
      const updatedSettings = { ...currentSettings, ...settings };
      
      await chrome.storage.local.set({
        [StorageManager.SETTINGS_KEY]: updatedSettings,
      });
      
      console.log('[StorageManager] Settings saved successfully');
    } catch (error) {
      console.error('[StorageManager] Failed to save settings:', error);
      throw new Error('Failed to save settings');
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
      console.error('[StorageManager] Failed to export settings:', error);
      throw new Error('Failed to export settings');
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
        throw new Error('Invalid settings format');
      }
      
      await this.saveSettings(settings);
      console.log('[StorageManager] Settings imported successfully');
    } catch (error) {
      console.error('[StorageManager] Failed to import settings:', error);
      throw new Error('Failed to import settings: ' + (error as Error).message);
    }
  }

  /**
   * Save a history item
   * @param item - History item to save
   */
  async saveHistory(item: HistoryItem): Promise<void> {
    try {
      // Compress comments data to save space
      const compressedItem = {
        ...item,
        comments: LZString.compressToUTF16(JSON.stringify(item.comments)),
      };
      
      // Save the item with its ID as key
      await chrome.storage.local.set({
        [`${StorageManager.HISTORY_KEY}_${item.id}`]: compressedItem,
      });
      
      // Update history index
      await this.updateHistoryIndex(item.id);
      
      console.log('[StorageManager] History item saved:', item.id);
    } catch (error) {
      console.error('[StorageManager] Failed to save history:', error);
      throw new Error('Failed to save history');
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
      console.error('[StorageManager] Failed to get history:', error);
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
      const result = await chrome.storage.local.get(`${StorageManager.HISTORY_KEY}_${id}`);
      const compressedItem = result[`${StorageManager.HISTORY_KEY}_${id}`];
      
      if (!compressedItem) {
        return undefined;
      }
      
      // Decompress comments data
      const decompressed = LZString.decompressFromUTF16(compressedItem.comments);
      const comments = decompressed ? JSON.parse(decompressed) : [];
      
      return {
        ...compressedItem,
        comments,
      };
    } catch (error) {
      console.error(`[StorageManager] Failed to get history item ${id}:`, error);
      return undefined;
    }
  }

  /**
   * Delete a history item
   * @param id - History item ID
   */
  async deleteHistoryItem(id: string): Promise<void> {
    try {
      await chrome.storage.local.remove(`${StorageManager.HISTORY_KEY}_${id}`);
      await this.removeFromHistoryIndex(id);
      console.log('[StorageManager] History item deleted:', id);
    } catch (error) {
      console.error(`[StorageManager] Failed to delete history item ${id}:`, error);
      throw new Error('Failed to delete history item');
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
      
      return allHistory.filter(item => 
        item.title.toLowerCase().includes(lowerQuery) ||
        item.url.toLowerCase().includes(lowerQuery) ||
        item.platform.toLowerCase().includes(lowerQuery)
      );
    } catch (error) {
      console.error('[StorageManager] Failed to search history:', error);
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
      return result[StorageManager.HISTORY_INDEX_KEY] || [];
    } catch (error) {
      console.error('[StorageManager] Failed to get history index:', error);
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
        await chrome.storage.local.set({
          [StorageManager.HISTORY_INDEX_KEY]: index,
        });
      }
    } catch (error) {
      console.error('[StorageManager] Failed to update history index:', error);
    }
  }

  /**
   * Remove ID from history index
   * @param id - History item ID to remove
   */
  private async removeFromHistoryIndex(id: string): Promise<void> {
    try {
      const index = await this.getHistoryIndex();
      const filteredIndex = index.filter(itemId => itemId !== id);
      
      await chrome.storage.local.set({
        [StorageManager.HISTORY_INDEX_KEY]: filteredIndex,
      });
    } catch (error) {
      console.error('[StorageManager] Failed to remove from history index:', error);
    }
  }

  /**
   * Validate settings structure
   * @param settings - Settings to validate
   * @returns True if valid
   */
  private validateSettings(settings: any): settings is Settings {
    return (
      typeof settings === 'object' &&
      typeof settings.maxComments === 'number' &&
      this.validateAIConfig(settings.extractorModel) &&
      this.validateAIConfig(settings.analyzerModel) &&
      typeof settings.analyzerPromptTemplate === 'string' &&
      (settings.language === 'zh-CN' || settings.language === 'en-US')
    );
  }

  /**
   * Validate AI config structure
   * @param config - AI config to validate
   * @returns True if valid
   */
  private validateAIConfig(config: any): config is AIConfig {
    return (
      typeof config === 'object' &&
      typeof config.apiUrl === 'string' &&
      typeof config.apiKey === 'string' &&
      typeof config.model === 'string' &&
      typeof config.maxTokens === 'number' &&
      typeof config.temperature === 'number' &&
      typeof config.topP === 'number'
    );
  }
}

// Export singleton instance
export const storageManager = new StorageManager();
