/* eslint-disable no-console */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger, LogLevel } from '../src/utils/logger';

// Mock chrome API
const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
const mockStorageRemove = vi.fn();
const mockStorageOnChanged = { addListener: vi.fn() };
const mockSendMessage = vi.fn();

const mockChrome = {
  runtime: {
    getManifest: vi.fn(),
    sendMessage: mockSendMessage,
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
    mockSendMessage.mockResolvedValue({ success: true });
    (Logger as unknown as { storageWriter?: unknown }).storageWriter = undefined;
    (Logger as unknown as { initialized: boolean }).initialized = false;
    (Logger as unknown as { isDevelopment: boolean }).isDevelopment = false;
    (Logger as unknown as { storageConfigLoaded: boolean }).storageConfigLoaded = false;
    (
      Logger as unknown as {
        config: {
          minLevel: LogLevel;
          enableConsole: boolean;
          enableStorage: boolean;
          maxStoredLogs: number;
        };
      }
    ).config = {
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
        update_url: 'https://clients2.google.com/service/update2/crx',
      });
      mockStorageGet.mockResolvedValue({});

      await Logger.initialize();

      expect(Logger.isDev()).toBe(false);
      expect(Logger.getConfig().minLevel).toBe(LogLevel.ERROR);
    });

    it('should load log level from storage', async () => {
      mockChrome.runtime.getManifest.mockReturnValue({ version: '1.0.0', update_url: '...' });
      mockStorageGet.mockResolvedValue({ log_min_level: 'WARN' });

      await Logger.initialize();

      expect(Logger.getConfig().minLevel).toBe(LogLevel.WARN);
    });
  });

  describe('logging', () => {
    beforeEach(async () => {
      mockChrome.runtime.getManifest.mockReturnValue({ version: '0.0.0' });
      mockStorageGet.mockResolvedValue({ settings: { developerMode: true } });
      await Logger.initialize();

      vi.clearAllMocks();
    });

    it('delegates UI and content logs through the background transport', () => {
      Logger.info('Test info');
      expect(console.info).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'APPEND_SYSTEM_LOG',
        payload: { entry: expect.objectContaining({ level: 'INFO', message: 'Test info' }) },
      });
      expect(mockStorageSet).not.toHaveBeenCalled();
    });

    it('writes background logs through the registered writer without sending itself messages', async () => {
      const writer = vi.fn().mockResolvedValue(undefined);
      Logger.setStorageWriter(writer);

      Logger.info('Background request sk-abcdefghijklmnopqrstuvwx', {
        apiKey: 'plain-secret-value',
        nested: { password: 'another-secret-value', safe: 42 },
      });

      expect(writer).toHaveBeenCalledOnce();
      expect(writer).toHaveBeenCalledWith({
        level: LogLevel.INFO,
        timestamp: expect.any(Number),
        message: 'Background request sk-a********uvwx',
        data: {
          apiKey: 'plai********alue',
          nested: { password: 'anot********alue', safe: 42 },
        },
      });
      await expect(writer.mock.results[0]?.value).resolves.toBeUndefined();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockStorageGet).not.toHaveBeenCalled();
      expect(mockStorageSet).not.toHaveBeenCalled();
      expect(mockStorageRemove).not.toHaveBeenCalled();
    });

    it('does not recursively transport logs when the background writer rejects', async () => {
      const writer = vi
        .fn()
        .mockRejectedValue(new Error('storage failed sk-abcdefghijklmnopqrstuvwx'));
      Logger.setStorageWriter(writer);

      Logger.error('Background failure');

      await vi.waitFor(() => {
        expect(console.error).toHaveBeenCalledWith(
          '[Logger] Storage error:',
          'Error: storage failed sk-a********uvwx',
        );
      });
      expect(writer).toHaveBeenCalledOnce();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockStorageSet).not.toHaveBeenCalled();
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
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Test with data'), data);

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'APPEND_SYSTEM_LOG',
        payload: {
          entry: expect.objectContaining({
            message: 'Test with data',
            data,
          }),
        },
      });
      expect(mockStorageSet).not.toHaveBeenCalled();
    });
  });

  it.each([false, true])(
    'does not persist logs with developer mode disabled (background writer: %s)',
    async (useBackgroundWriter) => {
      const writer = vi.fn().mockResolvedValue(undefined);
      if (useBackgroundWriter) Logger.setStorageWriter(writer);
      mockChrome.runtime.getManifest.mockReturnValue({ version: '0.0.0' });
      mockStorageGet.mockResolvedValue({ settings: { developerMode: false } });
      await Logger.initialize();
      vi.clearAllMocks();

      Logger.error('Console-only error');

      expect(console.error).toHaveBeenCalled();
      expect(Logger.getConfig().enableStorage).toBe(false);
      expect(writer).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockStorageGet).not.toHaveBeenCalled();
      expect(mockStorageSet).not.toHaveBeenCalled();
      expect(mockStorageRemove).not.toHaveBeenCalled();
    },
  );

  describe('storage operations', () => {
    it('should get logs', async () => {
      const mockLogs = {
        log_system_info_1: { level: 'INFO', timestamp: 1000, message: 'Log 1' },
        log_system_error_2: { level: 'ERROR', timestamp: 2000, message: 'Log 2' },
        other_key: 'value',
      };

      mockStorageGet.mockImplementation((keys) => {
        if (keys === 'system_log_index') {
          return Promise.resolve({
            system_log_index: ['log_system_info_1', 'log_system_error_2'],
          });
        }
        return Promise.resolve({
          log_system_info_1: mockLogs.log_system_info_1,
          log_system_error_2: mockLogs.log_system_error_2,
        });
      });

      const logs = await Logger.getLogs();

      expect(logs).toHaveLength(2);
      expect(logs[0].message).toBe('Log 2'); // Sorted by timestamp descending
    });

    it('should clear logs', async () => {
      mockStorageGet.mockImplementation((keys) => {
        if (keys === 'system_log_index') {
          return Promise.resolve({ system_log_index: ['log_system_1', 'log_system_2'] });
        }
        return Promise.resolve({});
      });

      await Logger.clearLogs();

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'CLEAR_LOGS',
        payload: { kind: 'system' },
      });
      expect(mockStorageRemove).not.toHaveBeenCalled();
    });
  });
});
