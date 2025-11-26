import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel } from '../src/utils/logger';

// Mock chrome API
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
const mockStorageRemove = vi.fn();
const mockStorageOnChanged = { addListener: vi.fn() };

const mockChrome = {
  runtime: {
    getManifest: vi.fn(),
  },
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
      remove: mockStorageRemove,
    },
    onChanged: mockStorageOnChanged,
  },
};

vi.stubGlobal('chrome', mockChrome);

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (Logger as unknown as { initialized: boolean }).initialized = false;
    (Logger as unknown as { isDevelopment: boolean }).isDevelopment = false;
    (Logger as unknown as { storageConfigLoaded: boolean }).storageConfigLoaded = false;
    (Logger as unknown as { config: { minLevel: LogLevel; enableConsole: boolean; enableStorage: boolean; maxStoredLogs: number } }).config = {
      minLevel: LogLevel.INFO,
      enableConsole: true,
      enableStorage: false,
      maxStoredLogs: 100,
    };
    
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize', () => {
    it('should detect development environment', async () => {
      mockChrome.runtime.getManifest.mockReturnValue({ version: '0.0.0' });
      mockStorageGet.mockResolvedValue({}); // No stored log level

      await Logger.initialize();

      expect(Logger.isDev()).toBe(true);
      expect(Logger.getConfig().minLevel).toBe(LogLevel.DEBUG);
    });

    it('should detect production environment', async () => {
      mockChrome.runtime.getManifest.mockReturnValue({ 
        version: '1.0.0',
        update_url: 'https://clients2.google.com/service/update2/crx'
      });
      mockStorageGet.mockResolvedValue({});

      await Logger.initialize();

      expect(Logger.isDev()).toBe(false);
      expect(Logger.getConfig().minLevel).toBe(LogLevel.ERROR);
    });

    it('should load log level from storage', async () => {
      mockChrome.runtime.getManifest.mockReturnValue({ version: '1.0.0', update_url: '...' });
      mockStorageGet.mockResolvedValue({ 'log_min_level': 'WARN' });

      await Logger.initialize();

      expect(Logger.getConfig().minLevel).toBe(LogLevel.WARN);
    });
  });

  describe('logging', () => {
    beforeEach(async () => {
      // Initialize as dev to enable all logs and storage
      mockChrome.runtime.getManifest.mockReturnValue({ version: '0.0.0' });
      mockStorageGet.mockResolvedValue({});
      await Logger.initialize();
      
      // Clear mocks to remove initialization logs
      vi.clearAllMocks();
    });

    it('should log info message', () => {
      Logger.info('Test info');
      expect(console.info).toHaveBeenCalled();
      expect(mockStorageSet).toHaveBeenCalled();
    });

    it('should respect log levels', () => {
      Logger.configure({ minLevel: LogLevel.WARN });
      
      Logger.info('Should be ignored');
      Logger.warn('Should be logged');
      
      expect(console.info).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
    });

    it('should include data in logs', () => {
      const data = { foo: 'bar' };
      Logger.info('Test with data', data);
      
      // Check console call
      expect(console.info).toHaveBeenCalledWith(
        expect.stringContaining('Test with data'), 
        data
      );
      
      // Check storage call
      // Since we cleared mocks in beforeEach, this should be the only call
      expect(mockStorageSet).toHaveBeenCalledTimes(1);
      
      const callArgs = mockStorageSet.mock.calls[0][0];
      const keys = Object.keys(callArgs);
      expect(keys.length).toBe(1);
      expect(keys[0]).toMatch(/^log_info_/);
      expect(callArgs[keys[0]]).toEqual(expect.objectContaining({
        message: 'Test with data',
        data: data
      }));
    });
  });

  describe('storage operations', () => {
    it('should get logs', async () => {
      const mockLogs = {
        'log_system_info_1': { level: 'INFO', timestamp: 1000, message: 'Log 1' },
        'log_system_error_2': { level: 'ERROR', timestamp: 2000, message: 'Log 2' },
        'other_key': 'value'
      };
      mockStorageGet.mockResolvedValue(mockLogs);

      const logs = await Logger.getLogs();
      
      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('Log 2'); // Sorted by timestamp descending
    });

    it('should clear logs', async () => {
      const mockLogs = {
        'log_1': {}, 'log_2': {}, 'other': {}
      };
      mockStorageGet.mockResolvedValue(mockLogs);
      
      await Logger.clearLogs();
      
      expect(mockStorageRemove).toHaveBeenCalledWith(['log_1', 'log_2']);
    });
  });
});

