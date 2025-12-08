import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleCheckScraperConfig,
  handleDeleteScraperConfig,
} from '../../src/background/handlers/scraper';
import { HandlerContext } from '../../src/background/handlers/types';
import { ScraperConfig } from '../../src/types/scraper';

vi.mock('../../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/utils/ScraperConfigManager', () => ({
  ScraperConfigManager: {
    findMatchingConfig: vi.fn().mockResolvedValue(null),
    getAllConfigs: vi.fn().mockResolvedValue([]),
    saveConfig: vi.fn().mockResolvedValue({ id: 'config_1', name: 'Test' }),
    deleteConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockConfig: ScraperConfig = {
  id: 'config_1',
  name: 'Test Config',
  domains: ['example.com'],
  urlPatterns: [],
  selectors: {
    commentContainer: '.comments',
    commentItem: '.comment',
    username: '.user',
    content: '.text',
    timestamp: '.time',
    likes: '.likes',
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

vi.stubGlobal('chrome', {
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 1 }]),
    sendMessage: vi.fn().mockResolvedValue({ domStructure: '<div></div>' }),
  },
  runtime: {
    sendMessage: vi.fn(),
  },
});

function createMockContext(): HandlerContext {
  return {
    taskManager: {
      createTask: vi.fn(),
      startTask: vi.fn(),
      updateProgress: vi.fn(),
      updateTaskProgress: vi.fn(),
      completeTask: vi.fn(),
      failTask: vi.fn(),
      getTask: vi.fn(),
      getAllTasks: vi.fn().mockReturnValue([]),
      cancelTask: vi.fn(),
      incrementTokens: vi.fn(),
    },
    storageManager: {
      getSettings: vi.fn().mockResolvedValue({ maxComments: 100 }),
      saveSettings: vi.fn(),
      getHistory: vi.fn().mockResolvedValue([]),
      saveHistory: vi.fn(),
    },
    aiService: {
      callAI: vi.fn(),
      analyzeComments: vi.fn(),
    },
    sender: {
      tab: { id: 1 },
    },
  } as unknown as HandlerContext;
}

describe('scraper handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleCheckScraperConfig', () => {
    it('should return hasConfig true when config exists', async () => {
      const { ScraperConfigManager } = await import('../../src/utils/ScraperConfigManager');
      vi.mocked(ScraperConfigManager.findMatchingConfig).mockResolvedValue(mockConfig);

      const context = createMockContext();
      const message = {
        type: 'CHECK_SCRAPER_CONFIG' as const,
        payload: { url: 'https://example.com/page' },
      };

      const result = await handleCheckScraperConfig(message, context);

      expect(result.hasConfig).toBe(true);
      expect(result.config).toBeDefined();
    });

    it('should return hasConfig false when no config exists', async () => {
      const { ScraperConfigManager } = await import('../../src/utils/ScraperConfigManager');
      vi.mocked(ScraperConfigManager.findMatchingConfig).mockResolvedValue(null);

      const context = createMockContext();
      const message = {
        type: 'CHECK_SCRAPER_CONFIG' as const,
        payload: { url: 'https://unknown.com/page' },
      };

      const result = await handleCheckScraperConfig(message, context);

      expect(result.hasConfig).toBe(false);
    });

    it('should throw error when URL is missing', async () => {
      const context = createMockContext();
      const message = {
        type: 'CHECK_SCRAPER_CONFIG' as const,
        payload: {},
      };

      await expect(
        handleCheckScraperConfig(
          message as Extract<import('../../src/types').Message, { type: 'CHECK_SCRAPER_CONFIG' }>,
          context,
        ),
      ).rejects.toThrow();
    });
  });

  describe('handleDeleteScraperConfig', () => {
    it('should throw error when id is missing', async () => {
      const context = createMockContext();
      const message = {
        type: 'DELETE_SCRAPER_CONFIG' as const,
        payload: {},
      };

      await expect(
        handleDeleteScraperConfig(
          message as Extract<import('../../src/types').Message, { type: 'DELETE_SCRAPER_CONFIG' }>,
          context,
        ),
      ).rejects.toThrow();
    });
  });
});
