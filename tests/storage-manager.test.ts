import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageManager } from '../src/background/StorageManager';
import { Settings } from '../src/types';

// Mock chrome API
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
const mockStorageRemove = vi.fn();

const mockChrome = {
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
      remove: mockStorageRemove,
    },
  },
};

vi.stubGlobal('chrome', mockChrome);

// Mock Logger
vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Web Crypto API
const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();
const mockDeriveKey = vi.fn();
const mockImportKey = vi.fn();
const mockGetRandomValues = vi.fn((arr) => {
  // Fill with random values
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
});

vi.stubGlobal('crypto', {
  getRandomValues: mockGetRandomValues,
  subtle: {
    encrypt: mockEncrypt,
    decrypt: mockDecrypt,
    deriveKey: mockDeriveKey,
    importKey: mockImportKey,
  },
});

// Mock TextEncoder/Decoder
vi.stubGlobal(
  'TextEncoder',
  class {
    encode(str: string) {
      return new Uint8Array(Buffer.from(str));
    }
  },
);
vi.stubGlobal(
  'TextDecoder',
  class {
    decode(arr: Uint8Array) {
      return Buffer.from(arr).toString();
    }
  },
);

describe('StorageManager', () => {
  let storageManager: StorageManager;

  beforeEach(() => {
    vi.clearAllMocks();
    storageManager = new StorageManager();
  });

  describe('getSettings', () => {
    it('should return default settings if storage is empty', async () => {
      mockStorageGet.mockResolvedValue({});

      const settings = await storageManager.getSettings();

      expect(settings.maxComments).toBeDefined();
      expect(mockStorageSet).toHaveBeenCalled(); // Should save defaults
    });

    it('should merge stored settings with defaults', async () => {
      const storedSettings: Partial<Settings> = { maxComments: 100 };
      mockStorageGet.mockResolvedValue({ settings: storedSettings });

      const settings = await storageManager.getSettings();

      expect(settings.maxComments).toBe(100);
      expect(settings.aiModel).toBeDefined(); // Default merged
    });
  });

  describe('saveSettings', () => {
    it('should save settings to storage', async () => {
      const newSettings: Partial<Settings> = { maxComments: 200 };
      mockStorageGet.mockResolvedValue({}); // Allow getting current settings

      await storageManager.saveSettings(newSettings);

      expect(mockStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ maxComments: 200 }),
        }),
      );
    });
  });

  describe('History Operations', () => {
    const mockHistoryItem = {
      id: 'test-id',
      title: 'Test',
      url: 'http://test.com',
      platform: 'Test',
      extractedAt: 1000,
      commentsCount: 0,
      comments: [],
    };

    it('should save history item', async () => {
      await storageManager.saveHistory(mockHistoryItem as any);

      expect(mockStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({
          'history_test-id': expect.anything(),
        }),
      );

      // Should update index
      expect(mockStorageSet).toHaveBeenCalledWith(
        expect.objectContaining({
          history_index: expect.arrayContaining(['test-id']),
        }),
      );
    });

    it('should get history items', async () => {
      mockStorageGet.mockImplementation((key) => {
        if (key === 'history_index') return { history_index: ['1'] };
        if (key === 'history_1')
          return {
            history_1: {
              ...mockHistoryItem,
              id: '1',
              comments: '', // LZString mock handled implicitly or empty
            },
          };
        return {};
      });

      const history = await storageManager.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('1');
    });

    it('should delete history item', async () => {
      mockStorageGet.mockResolvedValue({ history_index: ['1', '2'] });

      await storageManager.deleteHistoryItem('1');

      expect(mockStorageRemove).toHaveBeenCalledWith(expect.arrayContaining(['history_1']));
      expect(mockStorageSet).toHaveBeenCalledWith({
        history_index: ['2'],
      });
    });
  });
});
