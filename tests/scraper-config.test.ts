import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScraperConfigManager } from '../src/utils/ScraperConfigManager';

// Mock Logger to avoid side effects
vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}));

// Mock Chrome API
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
const mockStorageRemove = vi.fn();

const mockChrome = {
  runtime: {
    getURL: vi.fn(),
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
      remove: mockStorageRemove,
    },
  },
};

vi.stubGlobal('chrome', mockChrome);

describe('ScraperConfigManager', () => {
  const mockConfigs = [
    {
      id: '1',
      name: 'Test Config',
      domains: ['example.com'],
      urlPatterns: ['/video/'],
      selectors: {
        commentContainer: '.container',
        commentItem: '.item',
        username: '.user',
        content: '.text',
        timestamp: '.time',
        likes: '.likes',
      },
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: '2',
      name: 'Subdomain Config',
      domains: ['sub.test.com'],
      urlPatterns: [],
      selectors: {}, // Simplified
      createdAt: 2000,
      updatedAt: 2000,
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Default storage mock
    mockStorageGet.mockResolvedValue({
      'scraperConfigsInitialized': true, // Skip default init
      'scraperConfigs': { configs: mockConfigs, version: '1.0.0' }
    });
  });

  describe('CRUD Operations', () => {
    it('getAll should return configs from storage', async () => {
      const configs = await ScraperConfigManager.getAll();
      expect(configs).toHaveLength(2);
      expect(configs[0].id).toBe('1');
    });

    it('getById should return correct config', async () => {
      const config = await ScraperConfigManager.getById('1');
      expect(config).toBeDefined();
      expect(config?.name).toBe('Test Config');
    });

    it('create should add new config and save to storage', async () => {
      const newConfigData = {
        name: 'New Config',
        domains: ['test.com'],
        selectors: mockConfigs[0].selectors,
        urlPatterns: [],
      };

      const created = await ScraperConfigManager.create(newConfigData as any);
      
      expect(created.id).toBeDefined();
      expect(created.createdAt).toBeDefined();
      
      expect(mockStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({
          scraperConfigs: expect.objectContaining({
            configs: expect.arrayContaining([
              expect.objectContaining({ name: 'New Config' })
            ])
          })
        })
      );
    });

    it('delete should remove config and update storage', async () => {
      const result = await ScraperConfigManager.delete('1');
      
      expect(result).toBe(true);
      expect(mockStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({
          scraperConfigs: expect.objectContaining({
            configs: expect.not.arrayContaining([
              expect.objectContaining({ id: '1' })
            ])
          })
        })
      );
    });
  });

  describe('findMatchingConfig', () => {
    it('should match exact domain and url pattern', async () => {
      const config = await ScraperConfigManager.findMatchingConfig('https://example.com/video/123');
      expect(config).toBeDefined();
      expect(config?.id).toBe('1');
    });

    it('should not match if url pattern does not match', async () => {
      const config = await ScraperConfigManager.findMatchingConfig('https://example.com/other/123');
      expect(config).toBeNull();
    });

    it('should match subdomain if configured', async () => {
      const config = await ScraperConfigManager.findMatchingConfig('https://sub.test.com/any/path');
      expect(config).toBeDefined();
      expect(config?.id).toBe('2');
    });

    it('should match domain without www', async () => {
      // Mock config with www
      mockStorageGet.mockResolvedValue({
        scraperConfigsInitialized: true,
        scraperConfigs: {
          configs: [{
            ...mockConfigs[0],
            domains: ['www.example.com'],
            urlPatterns: [] // Match all
          }],
          version: '1.0.0'
        }
      });

      const config = await ScraperConfigManager.findMatchingConfig('https://example.com/video');
      expect(config).toBeDefined();
    });
  });

  describe('validateConfig', () => {
    it('should return valid for complete config', () => {
      const result = ScraperConfigManager.validateConfig(mockConfigs[0]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid if name is missing', () => {
      const invalid = { ...mockConfigs[0], name: '' };
      const result = ScraperConfigManager.validateConfig(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name is required');
    });

    it('should return invalid if selectors are missing', () => {
      const invalid = { ...mockConfigs[0], selectors: {} };
      const result = ScraperConfigManager.validateConfig(invalid as any);
      expect(result.valid).toBe(false);
      // Should complain about missing required selectors
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate regex patterns', () => {
      const invalid = { ...mockConfigs[0], urlPatterns: ['['] }; // Invalid regex
      const result = ScraperConfigManager.validateConfig(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid regex pattern');
    });
  });
});

