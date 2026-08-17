import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataMigrator } from '../src/background/storage/DataMigrator';
import { APP_DATA_VERSION, STORAGE } from '../src/config/constants';

const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
    },
  },
});

vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('DataMigrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue({});
    mockStorageSet.mockResolvedValue(undefined);
  });

  it('runs all migrations for a fresh install (no stored version)', async () => {
    const step = vi.fn().mockResolvedValue(undefined);
    const migrator = new DataMigrator({ 2: step });

    await migrator.migrate();

    expect(step).toHaveBeenCalledTimes(1);
    expect(mockStorageSet).toHaveBeenCalledWith({
      [STORAGE.APP_DATA_VERSION_KEY]: APP_DATA_VERSION.CURRENT,
    });
  });

  it('skips migration when data is already at current version', async () => {
    mockStorageGet.mockResolvedValueOnce({
      [STORAGE.APP_DATA_VERSION_KEY]: APP_DATA_VERSION.CURRENT,
    });
    const step = vi.fn().mockResolvedValue(undefined);
    const migrator = new DataMigrator({ 2: step });

    await migrator.migrate();

    expect(step).not.toHaveBeenCalled();
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('is idempotent when run twice', async () => {
    const step = vi.fn().mockResolvedValue(undefined);
    const migrator = new DataMigrator({ 2: step });

    await migrator.migrate();

    mockStorageGet.mockResolvedValueOnce({
      [STORAGE.APP_DATA_VERSION_KEY]: APP_DATA_VERSION.CURRENT,
    });
    await migrator.migrate();

    expect(step).toHaveBeenCalledTimes(1);
  });

  it('treats non-numeric stored version as initial', async () => {
    mockStorageGet.mockResolvedValueOnce({
      [STORAGE.APP_DATA_VERSION_KEY]: 'not-a-number',
    });
    const step = vi.fn().mockResolvedValue(undefined);
    const migrator = new DataMigrator({ 2: step });

    await migrator.migrate();

    expect(step).toHaveBeenCalledTimes(1);
  });

  it('runs multiple sequential migration steps in order', async () => {
    const calls: number[] = [];
    const migrator = new DataMigrator({
      2: async () => {
        calls.push(2);
      },
      3: async () => {
        calls.push(3);
      },
      4: async () => {
        calls.push(4);
      },
    });

    const originalCurrent = APP_DATA_VERSION.CURRENT;
    Object.defineProperty(APP_DATA_VERSION, 'CURRENT', {
      value: 4,
      configurable: true,
      writable: true,
    });

    try {
      await migrator.migrate();
      expect(calls).toEqual([2, 3, 4]);
    } finally {
      Object.defineProperty(APP_DATA_VERSION, 'CURRENT', {
        value: originalCurrent,
        configurable: true,
        writable: true,
      });
    }
  });

  it('propagates errors from failing migration step and does not bump version', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    const migrator = new DataMigrator({ 2: failing });

    await expect(migrator.migrate()).rejects.toThrow('boom');
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('tolerates chrome.storage.get failures and treats as initial version', async () => {
    mockStorageGet.mockRejectedValueOnce(new Error('storage unavailable'));
    const step = vi.fn().mockResolvedValue(undefined);
    const migrator = new DataMigrator({ 2: step });

    await migrator.migrate();

    expect(step).toHaveBeenCalledTimes(1);
  });

  it('default migrator has no-op step for version 2 and bumps version', async () => {
    const migrator = new DataMigrator();

    await migrator.migrate();

    expect(mockStorageSet).toHaveBeenCalledWith({
      [STORAGE.APP_DATA_VERSION_KEY]: APP_DATA_VERSION.CURRENT,
    });
  });
});
