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

function buildCurrentMigrations(step2: () => Promise<void>): Record<number, () => Promise<void>> {
  return {
    2: step2,
    3: async () => undefined,
  };
}

describe('DataMigrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockResolvedValue({});
    mockStorageSet.mockResolvedValue(undefined);
  });

  it('runs all migrations for a fresh install (no stored version)', async () => {
    const step = vi.fn().mockResolvedValue(undefined);
    const migrator = new DataMigrator(buildCurrentMigrations(step));

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
    const migrator = new DataMigrator(buildCurrentMigrations(step));

    await migrator.migrate();

    expect(step).not.toHaveBeenCalled();
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('is idempotent when run twice', async () => {
    const step = vi.fn().mockResolvedValue(undefined);
    const migrator = new DataMigrator(buildCurrentMigrations(step));

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
    const migrator = new DataMigrator(buildCurrentMigrations(step));

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

  it('fails closed when a required migration step is missing', async () => {
    const migrator = new DataMigrator({});

    await expect(migrator.migrate()).rejects.toThrow('Missing data migration step for version 2');
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('propagates errors from failing migration step and does not bump version', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    const migrator = new DataMigrator({ 2: failing });

    await expect(migrator.migrate()).rejects.toThrow('boom');
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('propagates version marker write failures after migrations complete', async () => {
    const step = vi.fn().mockResolvedValue(undefined);
    const migrator = new DataMigrator(buildCurrentMigrations(step));
    mockStorageSet.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(migrator.migrate()).rejects.toThrow('storage unavailable');
    expect(step).toHaveBeenCalledOnce();
  });

  it('tolerates chrome.storage.get failures and treats as initial version', async () => {
    mockStorageGet.mockRejectedValueOnce(new Error('storage unavailable'));
    const step = vi.fn().mockResolvedValue(undefined);
    const migrator = new DataMigrator(buildCurrentMigrations(step));

    await migrator.migrate();

    expect(step).toHaveBeenCalledTimes(1);
  });

  it('migrates a v2 Settings object to the v3 tombstone shape', async () => {
    const legacySettings = { theme: 'dark', maxComments: 200 };
    mockStorageGet.mockImplementation(async (key: string) => {
      if (key === STORAGE.APP_DATA_VERSION_KEY) {
        return { [STORAGE.APP_DATA_VERSION_KEY]: 2 };
      }
      if (key === STORAGE.SETTINGS_KEY) {
        return { [STORAGE.SETTINGS_KEY]: legacySettings };
      }
      return {};
    });

    await new DataMigrator().migrate();

    expect(mockStorageSet).toHaveBeenNthCalledWith(1, {
      [STORAGE.SETTINGS_KEY]: {
        ...legacySettings,
        disabledDefaultConfigDomains: [],
      },
    });
    expect(mockStorageSet).toHaveBeenNthCalledWith(2, {
      [STORAGE.APP_DATA_VERSION_KEY]: 3,
    });
  });

  it('keeps the v3 Settings migration idempotent when the step is retried', async () => {
    const storage: Record<string, unknown> = {
      [STORAGE.APP_DATA_VERSION_KEY]: 2,
      [STORAGE.SETTINGS_KEY]: { theme: 'dark' },
    };
    mockStorageGet.mockImplementation(async (key: string) =>
      Object.prototype.hasOwnProperty.call(storage, key) ? { [key]: storage[key] } : {},
    );
    mockStorageSet.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(storage, values);
    });

    await new DataMigrator().migrate();
    storage[STORAGE.APP_DATA_VERSION_KEY] = 2;
    mockStorageSet.mockClear();
    await new DataMigrator().migrate();

    expect(storage[STORAGE.SETTINGS_KEY]).toEqual({
      theme: 'dark',
      disabledDefaultConfigDomains: [],
    });
    expect(mockStorageSet).toHaveBeenCalledTimes(1);
    expect(mockStorageSet).toHaveBeenCalledWith({
      [STORAGE.APP_DATA_VERSION_KEY]: APP_DATA_VERSION.CURRENT,
    });
  });

  it('does not create Settings during v3 migration when the key is absent', async () => {
    mockStorageGet.mockImplementation(async (key: string) =>
      key === STORAGE.APP_DATA_VERSION_KEY ? { [STORAGE.APP_DATA_VERSION_KEY]: 2 } : {},
    );

    await new DataMigrator().migrate();

    expect(mockStorageSet).toHaveBeenCalledTimes(1);
    expect(mockStorageSet).toHaveBeenCalledWith({
      [STORAGE.APP_DATA_VERSION_KEY]: APP_DATA_VERSION.CURRENT,
    });
  });

  it('default migrator keeps version 2 and v3 steps and bumps version', async () => {
    const migrator = new DataMigrator();

    await migrator.migrate();

    expect(mockStorageSet).toHaveBeenCalledWith({
      [STORAGE.APP_DATA_VERSION_KEY]: APP_DATA_VERSION.CURRENT,
    });
  });
});
