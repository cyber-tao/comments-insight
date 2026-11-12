import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleGetSettings,
  handleSaveSettings,
  handleImportSettings,
  handleCacheSelector,
  handleGetCrawlingConfig,
  handleSaveCrawlingConfig,
} from '../../src/background/handlers/settings';
import { ExtensionError } from '../../src/utils/errors';
import type { Message, Settings, CrawlingConfig } from '../../src/types';

describe('Settings Handlers', () => {
  const mockSettingsStore = {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    importSettings: vi.fn(),
    updateSelectorCache: vi.fn(),
  };

  const mockCrawlingConfigStore = {
    getCrawlingConfig: vi.fn(),
    saveCrawlingConfig: vi.fn(),
  };

  const mockAIService = {
    clearVerifiedConfig: vi.fn(),
  };

  const context = {
    settingsStore: mockSettingsStore,
    crawlingConfigStore: mockCrawlingConfigStore,
    aiService: mockAIService,
  } as unknown as import('../../src/background/handlers/types').HandlerContext;

  const mockSettings: Settings = {
    maxComments: 100,
    aiModel: {
      apiUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'gpt-4',
      contextWindowSize: 200000,
      maxOutputTokens: 4096,
      protocol: 'openai-chat-completions' as const,
    },
    aiTimeout: 120000,
    analyzerPromptTemplate: 'Analyze these comments',
    language: 'en',
    theme: 'system',
    normalizeTimestamps: false,
    exportPostContentInMarkdown: false,
    selectorRetryAttempts: 3,
    selectorCache: [],
    crawlingConfigs: [],
    disabledDefaultConfigDomains: [],
    domAnalysisConfig: {
      initialDepth: 5,
      expandDepth: 3,
      maxDepth: 10,
    },
    developerMode: false,
  };

  const createCrawlingConfig = (overrides: Partial<CrawlingConfig> = {}): CrawlingConfig => ({
    id: 'cfg_youtube',
    domain: 'youtube.com',
    siteName: 'YouTube',
    container: { selector: '.comments', type: 'css' },
    item: { selector: '.comment-item', type: 'css' },
    fields: [
      { name: 'username', rule: { selector: '.author', type: 'css' } },
      { name: 'content', rule: { selector: '.content', type: 'css' } },
      { name: 'timestamp', rule: { selector: '.timestamp', type: 'css' } },
    ],
    lastUpdated: 1,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleGetSettings', () => {
    it('should return settings successfully', async () => {
      mockSettingsStore.getSettings.mockResolvedValue(mockSettings);

      const message: Extract<Message, { type: 'GET_SETTINGS' }> = {
        type: 'GET_SETTINGS',
      };

      const result = await handleGetSettings(message, context);

      expect(result).toEqual({ settings: mockSettings });
      expect(mockSettingsStore.getSettings).toHaveBeenCalledOnce();
    });

    it('should return default settings when storage is empty', async () => {
      mockSettingsStore.getSettings.mockResolvedValue(mockSettings);

      const message: Extract<Message, { type: 'GET_SETTINGS' }> = {
        type: 'GET_SETTINGS',
      };

      const result = await handleGetSettings(message, context);

      expect(result.settings).toBeDefined();
      expect(result.settings.maxComments).toBe(100);
    });
  });

  describe('handleSaveSettings', () => {
    it('should save settings successfully', async () => {
      mockSettingsStore.saveSettings.mockResolvedValue(undefined);

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
      expect(mockSettingsStore.saveSettings).toHaveBeenCalledWith(
        partialSettings,
        undefined,
        undefined,
        undefined,
      );
      expect(mockAIService.clearVerifiedConfig).toHaveBeenCalledOnce();
    });

    it('should throw error when settings are missing', async () => {
      const message = {
        type: 'SAVE_SETTINGS',
        payload: {},
      } as unknown as Extract<Message, { type: 'SAVE_SETTINGS' }>;

      await expect(handleSaveSettings(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleSaveSettings(message, context)).rejects.toThrow(
        'Settings data is required',
      );
    });

    it('should throw error when settings is null', async () => {
      const message = {
        type: 'SAVE_SETTINGS',
        payload: { settings: null },
      } as unknown as Extract<Message, { type: 'SAVE_SETTINGS' }>;

      await expect(handleSaveSettings(message, context)).rejects.toThrow(
        'Settings data is required',
      );
    });

    it('should save empty settings object', async () => {
      mockSettingsStore.saveSettings.mockResolvedValue(undefined);

      const message: Extract<Message, { type: 'SAVE_SETTINGS' }> = {
        type: 'SAVE_SETTINGS',
        payload: { settings: {} },
      };

      const result = await handleSaveSettings(message, context);

      expect(result).toEqual({ success: true });
      expect(mockSettingsStore.saveSettings).toHaveBeenCalledWith(
        {},
        undefined,
        undefined,
        undefined,
      );
    });

    it('forwards the source endpoint and rules preconditions without persisting them as settings', async () => {
      mockSettingsStore.saveSettings.mockResolvedValue(undefined);
      const patch = { aiModel: { apiKey: 'edited-key' } };
      await handleSaveSettings(
        {
          type: 'SAVE_SETTINGS',
          payload: {
            settings: patch,
            expectedAiEndpoint: 'https://old.example/v1',
            expectedAiProtocol: 'anthropic-messages',
            expectedCrawlingConfigsFingerprint: 'rules-fingerprint',
          },
        },
        context,
      );
      expect(mockSettingsStore.saveSettings).toHaveBeenCalledWith(
        patch,
        'rules-fingerprint',
        'https://old.example/v1',
        'anthropic-messages',
      );
    });

    it('should retain the verified config when persistence fails', async () => {
      mockSettingsStore.saveSettings.mockRejectedValueOnce(new Error('storage unavailable'));
      const message: Extract<Message, { type: 'SAVE_SETTINGS' }> = {
        type: 'SAVE_SETTINGS',
        payload: { settings: { aiModel: { ...mockSettings.aiModel, apiKey: '' } } },
      };

      await expect(handleSaveSettings(message, context)).rejects.toThrow('storage unavailable');
      expect(mockAIService.clearVerifiedConfig).not.toHaveBeenCalled();
    });
  });

  describe('handleImportSettings', () => {
    it('should import settings successfully', async () => {
      mockSettingsStore.importSettings.mockResolvedValue(undefined);

      const message: Extract<Message, { type: 'IMPORT_SETTINGS' }> = {
        type: 'IMPORT_SETTINGS',
        payload: { data: '{"maxComments":200}' },
      };

      const result = await handleImportSettings(message, context);

      expect(result).toEqual({ success: true });
      expect(mockSettingsStore.importSettings).toHaveBeenCalledWith('{"maxComments":200}');
      expect(mockAIService.clearVerifiedConfig).toHaveBeenCalledOnce();
    });

    it('should throw error when import data is missing', async () => {
      const message: Extract<Message, { type: 'IMPORT_SETTINGS' }> = {
        type: 'IMPORT_SETTINGS',
        payload: { data: '' },
      };

      await expect(handleImportSettings(message, context)).rejects.toThrow(
        'Settings import data is required',
      );
      expect(mockSettingsStore.importSettings).not.toHaveBeenCalled();
    });

    it('should retain the verified config when import persistence fails', async () => {
      mockSettingsStore.importSettings.mockRejectedValueOnce(new Error('storage unavailable'));
      const message: Extract<Message, { type: 'IMPORT_SETTINGS' }> = {
        type: 'IMPORT_SETTINGS',
        payload: { data: '{"aiModel":{"apiKey":""}}' },
      };

      await expect(handleImportSettings(message, context)).rejects.toThrow('storage unavailable');
      expect(mockAIService.clearVerifiedConfig).not.toHaveBeenCalled();
    });
  });

  describe('handleCacheSelector', () => {
    it('should cache selector successfully', async () => {
      mockSettingsStore.updateSelectorCache.mockResolvedValue(undefined);

      const message: Extract<Message, { type: 'CACHE_SELECTOR' }> = {
        type: 'CACHE_SELECTOR',
        payload: {
          hostname: 'youtube.com',
          selector: '.comment-item',
        },
      };

      const result = await handleCacheSelector(message, context);

      expect(result).toEqual({ success: true });
      expect(mockSettingsStore.updateSelectorCache).toHaveBeenCalledWith(
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

    it('should throw error when payload is missing', async () => {
      const message = {
        type: 'CACHE_SELECTOR' as const,
        payload: undefined,
      } as unknown as Extract<Message, { type: 'CACHE_SELECTOR' }>;

      await expect(handleCacheSelector(message, context)).rejects.toThrow(
        'Hostname and selector required',
      );
    });
  });

  describe('handleGetCrawlingConfig', () => {
    it('should get crawling config successfully', async () => {
      const mockConfig = createCrawlingConfig();

      mockCrawlingConfigStore.getCrawlingConfig.mockResolvedValue(mockConfig);

      const message: Extract<Message, { type: 'GET_CRAWLING_CONFIG' }> = {
        type: 'GET_CRAWLING_CONFIG',
        payload: { domain: 'youtube.com' },
      };

      const result = await handleGetCrawlingConfig(message, context);

      expect(result).toEqual({ config: mockConfig });
      expect(mockCrawlingConfigStore.getCrawlingConfig).toHaveBeenCalledWith('youtube.com');
    });

    it('should return null when config not found', async () => {
      mockCrawlingConfigStore.getCrawlingConfig.mockResolvedValue(null);

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

    it('should throw error when payload is missing', async () => {
      const message = {
        type: 'GET_CRAWLING_CONFIG' as const,
        payload: undefined,
      } as unknown as Extract<Message, { type: 'GET_CRAWLING_CONFIG' }>;

      await expect(handleGetCrawlingConfig(message, context)).rejects.toThrow('Domain is required');
    });
  });

  describe('handleSaveCrawlingConfig', () => {
    it('should save crawling config successfully', async () => {
      mockCrawlingConfigStore.saveCrawlingConfig.mockResolvedValue(undefined);

      const config = createCrawlingConfig({
        id: 'cfg_reddit',
        domain: 'reddit.com',
        siteName: 'Reddit',
        container: { selector: '.commentarea', type: 'css' },
        item: { selector: '.comment', type: 'css' },
        fields: [
          { name: 'username', rule: { selector: '.author', type: 'css' } },
          { name: 'content', rule: { selector: '.body', type: 'css' } },
          { name: 'timestamp', rule: { selector: 'time', type: 'css' } },
        ],
      });

      const message: Extract<Message, { type: 'SAVE_CRAWLING_CONFIG' }> = {
        type: 'SAVE_CRAWLING_CONFIG',
        payload: { config },
      };

      const result = await handleSaveCrawlingConfig(message, context);

      expect(result).toEqual({ success: true });
      expect(mockCrawlingConfigStore.saveCrawlingConfig).toHaveBeenCalledWith(config);
    });

    it('should throw error when config is missing', async () => {
      const message = {
        type: 'SAVE_CRAWLING_CONFIG',
        payload: {},
      } as unknown as Extract<Message, { type: 'SAVE_CRAWLING_CONFIG' }>;

      await expect(handleSaveCrawlingConfig(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleSaveCrawlingConfig(message, context)).rejects.toThrow(
        'Valid config with domain is required',
      );
    });

    it('should throw error when config domain is missing', async () => {
      const invalidConfig = createCrawlingConfig({ domain: '' });

      const message: Extract<Message, { type: 'SAVE_CRAWLING_CONFIG' }> = {
        type: 'SAVE_CRAWLING_CONFIG',
        payload: { config: invalidConfig },
      };

      await expect(handleSaveCrawlingConfig(message, context)).rejects.toThrow(
        'Valid config with domain is required',
      );
    });

    it('should throw error when config is null', async () => {
      const message = {
        type: 'SAVE_CRAWLING_CONFIG',
        payload: { config: null },
      } as unknown as Extract<Message, { type: 'SAVE_CRAWLING_CONFIG' }>;

      await expect(handleSaveCrawlingConfig(message, context)).rejects.toThrow(
        'Valid config with domain is required',
      );
    });
  });
});
