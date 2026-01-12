import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleGetSettings,
  handleSaveSettings,
  handleCacheSelector,
  handleGetCrawlingConfig,
  handleSaveCrawlingConfig,
} from '../../src/background/handlers/settings';
import { ExtensionError } from '../../src/utils/errors';
import type { Message, Settings, CrawlingConfig } from '../../src/types';

describe('Settings Handlers', () => {
  const mockStorageManager = {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    updateSelectorCache: vi.fn(),
    getCrawlingConfig: vi.fn(),
    saveCrawlingConfig: vi.fn(),
  } as any;

  const context = {
    storageManager: mockStorageManager,
  };

  const mockSettings: Settings = {
    maxComments: 100,
    aiModel: {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'gpt-4',
    },
    aiTimeout: 120000,
    analyzerPromptTemplate: 'Analyze these comments',
    language: 'en',
    selectorRetryAttempts: 3,
    selectorCache: [],
    crawlingConfigs: [],
    domAnalysisConfig: {
      maxDepth: 10,
      maxNodes: 1000,
      ignoreSelectors: ['script', 'style'],
    },
    developerMode: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleGetSettings', () => {
    it('should return settings successfully', async () => {
      mockStorageManager.getSettings.mockResolvedValue(mockSettings);

      const message: Extract<Message, { type: 'GET_SETTINGS' }> = {
        type: 'GET_SETTINGS',
        payload: {},
      };

      const result = await handleGetSettings(message, context);

      expect(result).toEqual({ settings: mockSettings });
      expect(mockStorageManager.getSettings).toHaveBeenCalledOnce();
    });

    it('should return default settings when storage is empty', async () => {
      mockStorageManager.getSettings.mockResolvedValue(mockSettings);

      const message: Extract<Message, { type: 'GET_SETTINGS' }> = {
        type: 'GET_SETTINGS',
        payload: {},
      };

      const result = await handleGetSettings(message, context);

      expect(result.settings).toBeDefined();
      expect(result.settings.maxComments).toBe(100);
    });
  });

  describe('handleSaveSettings', () => {
    it('should save settings successfully', async () => {
      mockStorageManager.saveSettings.mockResolvedValue(undefined);

      const partialSettings = {
        maxComments: 200,
        language: 'zh',
      };

      const message: Extract<Message, { type: 'SAVE_SETTINGS' }> = {
        type: 'SAVE_SETTINGS',
        payload: { settings: partialSettings },
      };

      const result = await handleSaveSettings(message, context);

      expect(result).toEqual({ success: true });
      expect(mockStorageManager.saveSettings).toHaveBeenCalledWith(partialSettings);
    });

    it('should throw error when settings are missing', async () => {
      const message: Extract<Message, { type: 'SAVE_SETTINGS' }> = {
        type: 'SAVE_SETTINGS',
        payload: {},
      };

      await expect(handleSaveSettings(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleSaveSettings(message, context)).rejects.toThrow(
        'Settings data is required',
      );
    });

    it('should throw error when settings is null', async () => {
      const message: Extract<Message, { type: 'SAVE_SETTINGS' }> = {
        type: 'SAVE_SETTINGS',
        payload: { settings: null },
      };

      await expect(handleSaveSettings(message, context)).rejects.toThrow(
        'Settings data is required',
      );
    });

    it('should save empty settings object', async () => {
      mockStorageManager.saveSettings.mockResolvedValue(undefined);

      const message: Extract<Message, { type: 'SAVE_SETTINGS' }> = {
        type: 'SAVE_SETTINGS',
        payload: { settings: {} },
      };

      const result = await handleSaveSettings(message, context);

      expect(result).toEqual({ success: true });
      expect(mockStorageManager.saveSettings).toHaveBeenCalledWith({});
    });
  });

  describe('handleCacheSelector', () => {
    it('should cache selector successfully', async () => {
      mockStorageManager.updateSelectorCache.mockResolvedValue(undefined);

      const message: Extract<Message, { type: 'CACHE_SELECTOR' }> = {
        type: 'CACHE_SELECTOR',
        payload: {
          hostname: 'youtube.com',
          selector: '.comment-item',
        },
      };

      const result = await handleCacheSelector(message, context);

      expect(result).toEqual({ success: true });
      expect(mockStorageManager.updateSelectorCache).toHaveBeenCalledWith(
        'youtube.com',
        '.comment-item',
      );
    });

    it('should throw error when hostname is missing', async () => {
      const message: Extract<Message, { type: 'CACHE_SELECTOR' }> = {
        type: 'CACHE_SELECTOR',
        payload: {
          hostname: '',
          selector: '.comment-item',
        },
      };

      await expect(handleCacheSelector(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleCacheSelector(message, context)).rejects.toThrow(
        'Hostname and selector required',
      );
    });

    it('should throw error when selector is missing', async () => {
      const message: Extract<Message, { type: 'CACHE_SELECTOR' }> = {
        type: 'CACHE_SELECTOR',
        payload: {
          hostname: 'youtube.com',
          selector: '',
        },
      };

      await expect(handleCacheSelector(message, context)).rejects.toThrow(
        'Hostname and selector required',
      );
    });

    it('should throw error when both hostname and selector are missing', async () => {
      const message: Extract<Message, { type: 'CACHE_SELECTOR' }> = {
        type: 'CACHE_SELECTOR',
        payload: {
          hostname: '',
          selector: '',
        },
      };

      await expect(handleCacheSelector(message, context)).rejects.toThrow(
        'Hostname and selector required',
      );
    });
  });

  describe('handleGetCrawlingConfig', () => {
    it('should get crawling config successfully', async () => {
      const mockConfig: CrawlingConfig = {
        domain: 'youtube.com',
        name: 'YouTube',
        selectors: {
          container: '.comments',
          item: '.comment-item',
          author: '.author',
          content: '.content',
          timestamp: '.timestamp',
        },
        urlPattern: 'https://youtube.com/*',
      };

      mockStorageManager.getCrawlingConfig.mockResolvedValue(mockConfig);

      const message: Extract<Message, { type: 'GET_CRAWLING_CONFIG' }> = {
        type: 'GET_CRAWLING_CONFIG',
        payload: { domain: 'youtube.com' },
      };

      const result = await handleGetCrawlingConfig(message, context);

      expect(result).toEqual({ config: mockConfig });
      expect(mockStorageManager.getCrawlingConfig).toHaveBeenCalledWith('youtube.com');
    });

    it('should return null when config not found', async () => {
      mockStorageManager.getCrawlingConfig.mockResolvedValue(null);

      const message: Extract<Message, { type: 'GET_CRAWLING_CONFIG' }> = {
        type: 'GET_CRAWLING_CONFIG',
        payload: { domain: 'unknown.com' },
      };

      const result = await handleGetCrawlingConfig(message, context);

      expect(result).toEqual({ config: null });
    });

    it('should throw error when domain is missing', async () => {
      const message: Extract<Message, { type: 'GET_CRAWLING_CONFIG' }> = {
        type: 'GET_CRAWLING_CONFIG',
        payload: { domain: '' },
      };

      await expect(handleGetCrawlingConfig(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleGetCrawlingConfig(message, context)).rejects.toThrow('Domain is required');
    });
  });

  describe('handleSaveCrawlingConfig', () => {
    it('should save crawling config successfully', async () => {
      mockStorageManager.saveCrawlingConfig.mockResolvedValue(undefined);

      const config: CrawlingConfig = {
        domain: 'reddit.com',
        name: 'Reddit',
        selectors: {
          container: '.commentarea',
          item: '.comment',
          author: '.author',
          content: '.body',
          timestamp: 'time',
        },
        urlPattern: 'https://reddit.com/*',
      };

      const message: Extract<Message, { type: 'SAVE_CRAWLING_CONFIG' }> = {
        type: 'SAVE_CRAWLING_CONFIG',
        payload: { config },
      };

      const result = await handleSaveCrawlingConfig(message, context);

      expect(result).toEqual({ success: true });
      expect(mockStorageManager.saveCrawlingConfig).toHaveBeenCalledWith(config);
    });

    it('should throw error when config is missing', async () => {
      const message: Extract<Message, { type: 'SAVE_CRAWLING_CONFIG' }> = {
        type: 'SAVE_CRAWLING_CONFIG',
        payload: {},
      };

      await expect(handleSaveCrawlingConfig(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleSaveCrawlingConfig(message, context)).rejects.toThrow(
        'Valid config with domain is required',
      );
    });

    it('should throw error when config domain is missing', async () => {
      const invalidConfig = {
        name: 'Invalid',
        selectors: {},
      } as CrawlingConfig;

      const message: Extract<Message, { type: 'SAVE_CRAWLING_CONFIG' }> = {
        type: 'SAVE_CRAWLING_CONFIG',
        payload: { config: invalidConfig },
      };

      await expect(handleSaveCrawlingConfig(message, context)).rejects.toThrow(
        'Valid config with domain is required',
      );
    });

    it('should throw error when config is null', async () => {
      const message: Extract<Message, { type: 'SAVE_CRAWLING_CONFIG' }> = {
        type: 'SAVE_CRAWLING_CONFIG',
        payload: { config: null },
      };

      await expect(handleSaveCrawlingConfig(message, context)).rejects.toThrow(
        'Valid config with domain is required',
      );
    });
  });
});
