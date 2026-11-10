import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentsInsightDatabase, HistoryStore } from '../src/background/storage/HistoryStore';
import { DEFAULT_SETTINGS, SettingsStore } from '../src/background/storage/SettingsStore';
import { CrawlingConfigStore } from '../src/background/storage/CrawlingConfigStore';
import { DataMigrator } from '../src/background/storage/DataMigrator';
import { crawlingConfigsFingerprint } from '../src/utils/crawling-config';
import type { EncryptionService } from '../src/background/storage/EncryptionService';
import type { AIConfig, CrawlingConfig, HistoryItem, Settings } from '../src/types';
import { ANALYSIS_FORMAT, SECURITY, STORAGE } from '../src/config/constants';
import {
  sanitizePersistedTaskState,
  sanitizeStoredSettings,
  sanitizeTokenStats,
  settingsPatchSchema,
} from '../src/utils/storage-validation';

const mockStorageGet = vi.fn();
const mockStorageSet = vi.fn();
type StorageChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;
const storageChangeListeners: StorageChangeListener[] = [];
const mockStorageOnChangedAddListener = vi.fn((listener: StorageChangeListener) => {
  storageChangeListeners.push(listener);
});

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
    },
    onChanged: {
      addListener: mockStorageOnChangedAddListener,
    },
  },
});

function createEncryptionServiceMock(overrides: Record<string, unknown> = {}) {
  return {
    ensureEncryptionReady: vi.fn().mockResolvedValue(undefined),
    encrypt: vi.fn().mockImplementation((text: string) => Promise.resolve(`enc:${text}`)),
    decrypt: vi.fn().mockResolvedValue(''),
    ...overrides,
  } as unknown as EncryptionService;
}

function useInMemorySettingsStorage(initialSettings: unknown = {}) {
  let persistedSettings = structuredClone(initialSettings);
  mockStorageGet.mockImplementation(async (key: string) =>
    key === STORAGE.SETTINGS_KEY
      ? { [STORAGE.SETTINGS_KEY]: structuredClone(persistedSettings) }
      : {},
  );
  mockStorageSet.mockImplementation(async (values: Record<string, unknown>) => {
    if (Object.prototype.hasOwnProperty.call(values, STORAGE.SETTINGS_KEY)) {
      persistedSettings = structuredClone(values[STORAGE.SETTINGS_KEY]);
    }
  });
  return {
    read: () => structuredClone(persistedSettings),
    write: (settings: unknown) => {
      persistedSettings = structuredClone(settings);
    },
  };
}

function createCrawlingConfig(domain: string): CrawlingConfig {
  return {
    ...structuredClone(DEFAULT_SETTINGS.crawlingConfigs[0]),
    id: `config_${domain}`,
    domain,
    siteName: domain,
    lastUpdated: 1,
  };
}

beforeEach(() => {
  storageChangeListeners.length = 0;
});

vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('storage compatibility with pre-refactor data', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const store = new HistoryStore();
    await store.clearAllHistory();
  });

  describe('HistoryStore', () => {
    it('reads history items saved with only the original field set (v1 shape)', async () => {
      const store = new HistoryStore();
      const legacyItem = {
        id: 'legacy_v1_item',
        url: 'https://example.com/video-1',
        title: 'Legacy Video',
        platform: 'example.com',
        extractedAt: 1_000_000,
        commentsCount: 1,
        comments: [
          {
            id: 'legacy_comment_1',
            username: 'legacy-user',
            timestamp: '2024-01-01T00:00:00Z',
            likes: 5,
            content: 'legacy content',
            replies: [],
          },
        ],
      };

      await store.createHistory(legacyItem);

      const fetched = await store.getHistoryItem(legacyItem.id);
      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(legacyItem.id);
      expect(fetched?.comments).toHaveLength(1);
    });

    it('safely reads legacy nested comments with malformed optional fields', async () => {
      const database = new CommentsInsightDatabase();
      const legacyItem = {
        id: 'legacy_malformed_comments',
        url: 'https://example.com/legacy-comments',
        title: 'Legacy Comments',
        platform: 'example.com',
        extractedAt: 1_500_000,
        commentsCount: 1,
        comments: [
          {
            id: 'legacy_parent',
            username: 'parent',
            content: 'parent content',
            likes: 'unknown',
            replies: [
              {
                id: 'legacy_reply',
                username: 'reply',
                content: 'reply content',
              },
              { malformed: true },
            ],
          },
        ],
        analysis: { markdown: '# Legacy', tokensUsed: 'unknown', generatedAt: 1000 },
      };

      try {
        await database.history.put(legacyItem as unknown as HistoryItem);
      } finally {
        database.close();
      }

      const fetched = await new HistoryStore().getHistoryItem(legacyItem.id);
      expect(fetched?.analysis).toBeUndefined();
      expect(fetched?.comments).toEqual([
        {
          id: 'legacy_parent',
          username: 'parent',
          content: 'parent content',
          timestamp: ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP,
          likes: 0,
          replies: [
            {
              id: 'legacy_reply',
              username: 'reply',
              content: 'reply content',
              timestamp: ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP,
              likes: 0,
              replies: [],
            },
          ],
        },
      ]);
    });

    it('rejects an unrecognizable persisted history row with a read error', async () => {
      const database = new CommentsInsightDatabase();
      try {
        await database.history.put({
          id: 'invalid_history_row',
          url: 42,
          title: 'Invalid',
          platform: 'example.com',
          extractedAt: 1_750_000,
          commentsCount: 0,
          comments: [],
        } as unknown as HistoryItem);
      } finally {
        database.close();
      }

      await expect(new HistoryStore().getHistoryItem('invalid_history_row')).rejects.toMatchObject({
        code: 'STORAGE_READ_ERROR',
      });
    });

    it('populates historyMetadata from history rows during upgrade', async () => {
      const store = new HistoryStore();
      await store.createHistory({
        id: 'existing_item',
        url: 'https://example.com/existing',
        title: 'Existing',
        platform: 'example.com',
        extractedAt: 2_000_000,
        commentsCount: 0,
        comments: [],
      });

      const page = await store.getHistoryMetadataPage(0, 10);
      expect(page.entries).toHaveLength(1);
      expect(page.entries[0]).toMatchObject({
        id: 'existing_item',
        url: 'https://example.com/existing',
        title: 'Existing',
      });
    });

    it('uses [url+extractedAt] index to find latest by url (v3 index)', async () => {
      const store = new HistoryStore();
      await store.createHistory({
        id: 'old_id',
        url: 'https://example.com/same',
        title: 'Old',
        platform: 'example.com',
        extractedAt: 100,
        commentsCount: 0,
        comments: [],
      });
      await store.createHistory({
        id: 'new_id',
        url: 'https://example.com/same',
        title: 'New',
        platform: 'example.com',
        extractedAt: 200,
        commentsCount: 0,
        comments: [],
      });

      const latest = await store.getLatestHistoryIdByUrl('https://example.com/same');
      expect(latest).toBe('new_id');
    });
  });

  describe('sanitizePersistedTaskState', () => {
    it('accepts pre-refactor task state shape without extra fields', () => {
      const legacyState = {
        tasks: [
          {
            id: 'task_legacy',
            type: 'extract',
            status: 'completed',
            url: 'https://example.com',
            progress: 100,
            startTime: 1_000_000,
            tokensUsed: 42,
          },
        ],
        queue: [],
        currentTaskId: null,
        savedAt: 1_000_000,
      };

      const result = sanitizePersistedTaskState(legacyState);
      expect(result).not.toBeNull();
      expect(result?.tasks).toHaveLength(1);
      expect(result?.tasks[0].id).toBe('task_legacy');
    });

    it('drops individual malformed tasks but keeps valid ones', () => {
      const state = {
        tasks: [
          { not: 'a valid task' },
          {
            id: 'ok_task',
            type: 'analyze',
            status: 'running',
            url: 'https://example.com',
            progress: 50,
            startTime: 1,
            tokensUsed: 0,
          },
        ],
        queue: ['ok_task', 42],
        currentTaskId: 'ok_task',
        savedAt: 1,
      };

      const result = sanitizePersistedTaskState(state);
      expect(result?.tasks.map((t) => t.id)).toEqual(['ok_task']);
      expect(result?.queue).toEqual(['ok_task']);
    });

    it('returns null for non-object input', () => {
      expect(sanitizePersistedTaskState('nope')).toBeNull();
      expect(sanitizePersistedTaskState(null)).toBeNull();
      expect(sanitizePersistedTaskState(42)).toBeNull();
    });
  });

  describe('sanitizeStoredSettings', () => {
    it('ignores unknown legacy fields (extractorModel, analyzerModel)', () => {
      const legacySettings = {
        maxComments: 200,
        aiModel: {
          apiUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-4o',
          contextWindowSize: 128000,
          temperature: 0.7,
          topP: 1,
        },
        extractorModel: { apiUrl: 'legacy' },
        analyzerModel: { apiUrl: 'legacy' },
      };

      const sanitized = sanitizeStoredSettings(legacySettings);
      expect(sanitized.maxComments).toBe(200);
      expect(sanitized.aiModel?.model).toBe('gpt-4o');
      expect((sanitized as Record<string, unknown>).extractorModel).toBeUndefined();
      expect((sanitized as Record<string, unknown>).analyzerModel).toBeUndefined();
    });

    it('normalizes and deduplicates disabled default config domains', () => {
      const sanitized = sanitizeStoredSettings({
        disabledDefaultConfigDomains: [' YouTube.COM ', 'youtube.com', 42, '', 'X.COM'],
      });

      expect(sanitized.disabledDefaultConfigDomains).toEqual(['youtube.com', 'x.com']);
      expect(
        settingsPatchSchema.parse({
          disabledDefaultConfigDomains: [' Reddit.COM ', 'reddit.com', null],
        }).disabledDefaultConfigDomains,
      ).toEqual(['reddit.com']);
    });

    it('returns empty object for non-object input', () => {
      expect(sanitizeStoredSettings(null)).toEqual({});
      expect(sanitizeStoredSettings([1, 2, 3])).toEqual({});
    });
  });

  describe('sanitizeTokenStats', () => {
    it('keeps valid persisted stats', () => {
      expect(sanitizeTokenStats({ today: 100, total: 5000, lastReset: 1234567890 })).toEqual({
        today: 100,
        total: 5000,
        lastReset: 1234567890,
      });
    });

    it('resets corrupted stats instead of producing NaN', () => {
      expect(sanitizeTokenStats({ today: '100', total: null, lastReset: undefined })).toEqual({
        today: 0,
        total: 0,
        lastReset: 0,
      });
      expect(sanitizeTokenStats('garbage')).toEqual({ today: 0, total: 0, lastReset: 0 });
      expect(sanitizeTokenStats(undefined)).toEqual({ today: 0, total: 0, lastReset: 0 });
    });
  });
});

describe('SettingsStore crawling config persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockReset();
    mockStorageSet.mockReset();
  });

  it('rejects stale rule replacement while preserving unrelated field patches', async () => {
    useInMemorySettingsStorage();
    const store = new SettingsStore(createEncryptionServiceMock());
    const snapshot = await store.getSettings();
    await new CrawlingConfigStore(store).saveCrawlingConfig(
      createCrawlingConfig('new.example.com'),
    );
    await store.saveSettings({ theme: 'dark', aiModel: { model: 'new-model' } });
    await store.saveSettings({ aiModel: { temperature: 0.5 } });
    await expect(
      store.saveSettings(
        { crawlingConfigs: snapshot.crawlingConfigs },
        crawlingConfigsFingerprint(snapshot.crawlingConfigs),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const latest = await store.getSettings();
    expect(latest.crawlingConfigs.some((config) => config.domain === 'new.example.com')).toBe(true);
    expect(latest.aiModel).toMatchObject({ model: 'new-model', temperature: 0.5 });
    expect(latest.theme).toBe('dark');
  });

  it('stores validation independently so later bundled selector updates remain visible', async () => {
    const storage = useInMemorySettingsStorage();
    const store = new SettingsStore(createEncryptionServiceMock());
    const bundled = DEFAULT_SETTINGS.crawlingConfigs[0];
    await store.updateFieldValidation(bundled.domain, { item: 'success' });
    expect((storage.read() as Settings).crawlingConfigs).toEqual([]);
    const original = bundled.item.selector;
    try {
      bundled.item.selector = '.updated-bundled-selector';
      const latest = await new SettingsStore(createEncryptionServiceMock()).getSettings();
      expect(latest.crawlingConfigs[0]).toMatchObject({
        item: { selector: '.updated-bundled-selector' },
        fieldValidation: { item: 'success' },
      });
    } finally {
      bundled.item.selector = original;
    }
  });

  it('migrates v3 validation-only snapshots without losing custom rules or credentials', async () => {
    const validated = {
      ...structuredClone(DEFAULT_SETTINGS.crawlingConfigs[0]),
      fieldValidation: { item: 'success' },
    };
    const custom = {
      ...createCrawlingConfig('custom.example.com'),
      fieldValidation: { item: 'failed' },
    };
    const data: Record<string, unknown> = {
      [STORAGE.APP_DATA_VERSION_KEY]: 3,
      [STORAGE.SETTINGS_KEY]: {
        aiModel: { apiKey: 'enc:untouched' },
        crawlingConfigs: [validated, custom],
        disabledDefaultConfigDomains: ['disabled.example.com'],
      },
    };
    mockStorageGet.mockImplementation(async (key: string) => ({
      [key]: structuredClone(data[key]),
    }));
    mockStorageSet.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(data, structuredClone(values));
    });
    await new DataMigrator().migrate();
    const migrated = data[STORAGE.SETTINGS_KEY] as Settings;
    expect(migrated.crawlingConfigs).toHaveLength(1);
    expect(migrated.crawlingConfigs[0].domain).toBe(custom.domain);
    expect(migrated.crawlingConfigs[0]).not.toHaveProperty('fieldValidation');
    expect(migrated.crawlingConfigValidationByDomain).toEqual({
      [validated.domain]: { item: 'success' },
      [custom.domain]: { item: 'failed' },
    });
    expect(migrated.aiModel.apiKey).toBe('enc:untouched');
    expect(migrated.disabledDefaultConfigDomains).toEqual(['disabled.example.com']);
    data[STORAGE.APP_DATA_VERSION_KEY] = 3;
    mockStorageSet.mockClear();
    await new DataMigrator().migrate();
    expect(mockStorageSet).toHaveBeenCalledTimes(1);
  });

  it('reads a legacy Settings object without tombstones', async () => {
    useInMemorySettingsStorage({ language: 'en-US' });
    const store = new SettingsStore(createEncryptionServiceMock());

    const settings = await store.getSettings();

    expect(settings.disabledDefaultConfigDomains).toEqual([]);
    expect(settings.crawlingConfigs).toHaveLength(DEFAULT_SETTINGS.crawlingConfigs.length);
  });

  it('does not snapshot unchanged bundled configs when saving other settings', async () => {
    const storage = useInMemorySettingsStorage();
    const store = new SettingsStore(createEncryptionServiceMock());

    await store.saveSettings({ theme: 'dark' });

    expect((storage.read() as Settings).crawlingConfigs).toEqual([]);
    expect((await store.getSettings()).crawlingConfigs).toHaveLength(
      DEFAULT_SETTINGS.crawlingConfigs.length,
    );
  });

  it('persists a modified bundled config as a sparse override', async () => {
    const storage = useInMemorySettingsStorage();
    const store = new SettingsStore(createEncryptionServiceMock());
    const settings = await store.getSettings();
    const modified = { ...settings.crawlingConfigs[0], siteName: 'Custom site name' };

    await store.saveSettings({
      crawlingConfigs: [modified, ...settings.crawlingConfigs.slice(1)],
    });

    expect((storage.read() as Settings).crawlingConfigs).toEqual([modified]);
    expect((await store.getSettings()).crawlingConfigs[0].siteName).toBe('Custom site name');
  });

  it('keeps a deleted bundled config removed after save and reload', async () => {
    const storage = useInMemorySettingsStorage();
    const store = new SettingsStore(createEncryptionServiceMock());
    const initial = await store.getSettings();
    const removed = initial.crawlingConfigs[0];
    const removedDomain = removed.domain.toLowerCase();

    await store.saveSettings({
      crawlingConfigs: initial.crawlingConfigs.filter(
        (config) => config.domain.toLowerCase() !== removedDomain,
      ),
    });

    const persisted = storage.read() as Settings;
    expect(persisted.disabledDefaultConfigDomains).toContain(removedDomain);
    const reloaded = await new SettingsStore(createEncryptionServiceMock()).getSettings();
    expect(reloaded.crawlingConfigs.some((config) => config.domain === removedDomain)).toBe(false);
  });

  it('clears a bundled config tombstone when the config explicitly reappears', async () => {
    const storage = useInMemorySettingsStorage();
    const store = new SettingsStore(createEncryptionServiceMock());
    const initial = await store.getSettings();
    const restoredConfig = structuredClone(initial.crawlingConfigs[0]);
    const restoredDomain = restoredConfig.domain.toLowerCase();

    await store.saveSettings({
      crawlingConfigs: initial.crawlingConfigs.filter(
        (config) => config.domain.toLowerCase() !== restoredDomain,
      ),
    });
    const withoutConfig = await store.getSettings();
    await store.saveSettings({
      crawlingConfigs: [...withoutConfig.crawlingConfigs, restoredConfig],
    });

    const persisted = storage.read() as Settings;
    expect(persisted.disabledDefaultConfigDomains).not.toContain(restoredDomain);
    const reloaded = await new SettingsStore(createEncryptionServiceMock()).getSettings();
    expect(reloaded.crawlingConfigs.some((config) => config.domain === restoredDomain)).toBe(true);
  });

  it('does not change config tombstones for a settings patch without crawling configs', async () => {
    const storage = useInMemorySettingsStorage();
    const store = new SettingsStore(createEncryptionServiceMock());
    const initial = await store.getSettings();
    const removedDomain = initial.crawlingConfigs[0].domain.toLowerCase();

    await store.saveSettings({
      crawlingConfigs: initial.crawlingConfigs.filter(
        (config) => config.domain.toLowerCase() !== removedDomain,
      ),
    });
    await store.saveSettings({ theme: 'dark' });

    const persisted = storage.read() as Settings;
    expect(persisted.disabledDefaultConfigDomains).toContain(removedDomain);
    const reloaded = await new SettingsStore(createEncryptionServiceMock()).getSettings();
    expect(reloaded.crawlingConfigs.some((config) => config.domain === removedDomain)).toBe(false);
  });

  it('excludes crawling state from settings export and ignores it on import', async () => {
    const removedDomain = DEFAULT_SETTINGS.crawlingConfigs[0].domain.toLowerCase();
    const storage = useInMemorySettingsStorage({
      disabledDefaultConfigDomains: [removedDomain],
      crawlingConfigs: [],
      selectorCache: [],
    });
    const store = new SettingsStore(createEncryptionServiceMock());

    const exported = JSON.parse(await store.exportSettings()) as Record<string, unknown>;
    expect(exported).not.toHaveProperty('crawlingConfigs');
    expect(exported).not.toHaveProperty('selectorCache');
    expect(exported).not.toHaveProperty('disabledDefaultConfigDomains');

    await store.importSettings(
      JSON.stringify({
        theme: 'dark',
        crawlingConfigs: [DEFAULT_SETTINGS.crawlingConfigs[0]],
        selectorCache: [],
        disabledDefaultConfigDomains: [],
      }),
    );

    const persisted = storage.read() as Settings;
    expect(persisted.disabledDefaultConfigDomains).toEqual([removedDomain]);
    expect(persisted.crawlingConfigs.some((config) => config.domain === removedDomain)).toBe(false);
  });

  it('preserves both crawling configs saved concurrently', async () => {
    useInMemorySettingsStorage();
    const settingsStore = new SettingsStore(createEncryptionServiceMock());
    const configStore = new CrawlingConfigStore(settingsStore);

    await Promise.all([
      configStore.saveCrawlingConfig(createCrawlingConfig('alpha.example.com')),
      configStore.saveCrawlingConfig(createCrawlingConfig('beta.example.com')),
    ]);

    const reloaded = await new SettingsStore(createEncryptionServiceMock()).getSettings();
    expect(reloaded.crawlingConfigs.map((config) => config.domain)).toEqual(
      expect.arrayContaining(['alpha.example.com', 'beta.example.com']),
    );
  });

  it('does not treat settings read failures as a missing crawling config', async () => {
    const configStore = new CrawlingConfigStore({
      getSettings: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    } as unknown as SettingsStore);

    await expect(configStore.getCrawlingConfig('example.com')).rejects.toMatchObject({
      code: 'STORAGE_READ_ERROR',
    });
  });

  it('does not cache a stale read that finishes after a save', async () => {
    useInMemorySettingsStorage({ language: 'old-language' });
    let resolveDecrypt!: (value: string) => void;
    let markDecryptStarted!: () => void;
    const decryptStarted = new Promise<void>((resolve) => {
      markDecryptStarted = resolve;
    });
    const delayedDecrypt = new Promise<string>((resolve) => {
      resolveDecrypt = resolve;
    });
    const decrypt = vi
      .fn()
      .mockImplementationOnce(() => {
        markDecryptStarted();
        return delayedDecrypt;
      })
      .mockResolvedValue('');
    const store = new SettingsStore(createEncryptionServiceMock({ decrypt }));

    const staleRead = store.getSettings();
    await decryptStarted;
    await store.saveSettings({ language: 'new-language' });
    resolveDecrypt('');

    expect((await staleRead).language).toBe('old-language');
    expect((await store.getSettings()).language).toBe('new-language');
  });

  it('does not cache a stale read that finishes after a storage change event', async () => {
    const storage = useInMemorySettingsStorage({ language: 'old-language' });
    let resolveDecrypt!: (value: string) => void;
    let markDecryptStarted!: () => void;
    const decryptStarted = new Promise<void>((resolve) => {
      markDecryptStarted = resolve;
    });
    const delayedDecrypt = new Promise<string>((resolve) => {
      resolveDecrypt = resolve;
    });
    const decrypt = vi
      .fn()
      .mockImplementationOnce(() => {
        markDecryptStarted();
        return delayedDecrypt;
      })
      .mockResolvedValue('');
    const store = new SettingsStore(createEncryptionServiceMock({ decrypt }));

    const staleRead = store.getSettings();
    await decryptStarted;
    storage.write({ language: 'external-language' });
    storageChangeListeners[0](
      {
        [STORAGE.SETTINGS_KEY]: {
          oldValue: { language: 'old-language' },
          newValue: { language: 'external-language' },
        },
      },
      'local',
    );
    resolveDecrypt('');

    expect((await staleRead).language).toBe('old-language');
    expect((await store.getSettings()).language).toBe('external-language');
  });
});

describe('SettingsStore endpoint-bound credential patches', () => {
  const firstEndpoint = 'https://provider-one.example/v1';
  const secondEndpoint = 'https://provider-two.example/v1';
  const encryption = () =>
    createEncryptionServiceMock({
      decrypt: vi.fn(async (value: string) => value.replace(/^enc:/, '')),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockReset();
    mockStorageSet.mockReset();
  });

  it('rejects a late key-only edit from an old options page after an endpoint import', async () => {
    const storage = useInMemorySettingsStorage({
      theme: 'dark',
      aiModel: { ...DEFAULT_SETTINGS.aiModel, apiUrl: firstEndpoint, apiKey: 'enc:first-key' },
    });
    const store = new SettingsStore(encryption());
    const oldPage = await store.getSettings();
    await store.importSettings(JSON.stringify({ aiModel: { apiUrl: secondEndpoint } }));
    expect((storage.read() as Settings).aiModel.apiKey).toBe('');
    mockStorageSet.mockClear();

    await expect(
      store.saveSettings(
        { aiModel: { apiKey: oldPage.aiModel.apiKey } },
        undefined,
        oldPage.aiModel.apiUrl,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { messageKey: 'options.settingsConflict' },
    });

    await expect(
      store.saveSettings(
        { aiModel: { model: 'old-page-model' } },
        undefined,
        oldPage.aiModel.apiUrl,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockStorageSet).not.toHaveBeenCalled();
    expect((storage.read() as Settings).aiModel).toMatchObject({
      apiUrl: secondEndpoint,
      apiKey: '',
    });
    expect((storage.read() as Settings).theme).toBe('dark');
  });

  it('compares endpoints inside the same save lock before merging queued credential edits', async () => {
    const storage = useInMemorySettingsStorage({
      aiModel: { ...DEFAULT_SETTINGS.aiModel, apiUrl: firstEndpoint, apiKey: 'enc:first-key' },
    });
    const store = new SettingsStore(encryption());
    const outcomes = await Promise.allSettled([
      store.saveSettings({ aiModel: { apiUrl: secondEndpoint } }, undefined, firstEndpoint),
      store.saveSettings({ aiModel: { apiKey: 'late-first-key' } }, undefined, firstEndpoint),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected']);
    expect((storage.read() as Settings).aiModel).toMatchObject({
      apiUrl: secondEndpoint,
      apiKey: '',
    });
  });

  it('requires the endpoint precondition for sensitive patches, but not ordinary partial edits', async () => {
    const storage = useInMemorySettingsStorage({
      aiModel: { ...DEFAULT_SETTINGS.aiModel, apiUrl: firstEndpoint, apiKey: 'enc:first-key' },
    });
    const store = new SettingsStore(encryption());
    await expect(store.saveSettings({ aiModel: { apiKey: 'unbound-key' } })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await store.saveSettings({ aiModel: { temperature: 0.3 } });
    expect((storage.read() as Settings).aiModel).toMatchObject({
      apiKey: 'enc:first-key',
      temperature: 0.3,
    });
  });

  it('allows initial configuration from an explicitly empty endpoint and encrypts a new key', async () => {
    const storage = useInMemorySettingsStorage({ language: 'en-US' });
    const store = new SettingsStore(encryption());
    await store.saveSettings(
      { aiModel: { apiUrl: firstEndpoint, apiKey: 'new-key' } },
      undefined,
      '',
    );
    expect((storage.read() as Settings).aiModel).toMatchObject({
      apiUrl: firstEndpoint,
      apiKey: 'enc:new-key',
    });
    await expect(
      store.saveSettings({ aiModel: { apiKey: 'stale-initial-key' } }, undefined, ''),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('keeps credentials for normalized-equivalent URLs and permits equivalent preconditions', async () => {
    const storage = useInMemorySettingsStorage({
      aiModel: {
        ...DEFAULT_SETTINGS.aiModel,
        apiUrl: 'https://API.example:443/v1/chat/completions?b=2&a=1#old',
        apiKey: 'enc:first-key',
      },
    });
    const store = new SettingsStore(encryption());
    await store.saveSettings(
      { aiModel: { apiUrl: 'https://api.example/v1/?a=1&b=2' } },
      undefined,
      ' https://api.example/v1?a=1&b=2 ',
    );
    expect((storage.read() as Settings).aiModel.apiKey).toBe('enc:first-key');
    await store.saveSettings(
      { aiModel: { apiKey: 'replacement' } },
      undefined,
      'https://api.example/v1/chat/completions?b=2&a=1',
    );
    expect((storage.read() as Settings).aiModel.apiKey).toBe('enc:replacement');
  });

  it('clears the key when a URL is removed and accepts an explicit key for a new endpoint', async () => {
    const storage = useInMemorySettingsStorage({
      aiModel: { ...DEFAULT_SETTINGS.aiModel, apiUrl: firstEndpoint, apiKey: 'enc:first-key' },
    });
    const store = new SettingsStore(encryption());
    await store.saveSettings({ aiModel: { apiUrl: '' } }, undefined, firstEndpoint);
    expect((storage.read() as Settings).aiModel.apiKey).toBe('');
    await store.saveSettings(
      { aiModel: { apiUrl: secondEndpoint, apiKey: 'second-key' } },
      undefined,
      '',
    );
    expect((storage.read() as Settings).aiModel).toMatchObject({
      apiUrl: secondEndpoint,
      apiKey: 'enc:second-key',
    });
  });
});

describe('SettingsStore decryption resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageGet.mockReset();
    mockStorageSet.mockResolvedValue(undefined);
  });

  it('resolves with an empty API key when decryption fails, keeping other settings', async () => {
    mockStorageGet.mockResolvedValue({
      [STORAGE.SETTINGS_KEY]: {
        maxComments: 100,
        language: 'en-US',
        aiModel: {
          apiUrl: 'https://api.example.com/v1',
          apiKey: 'enc:not-decryptable',
          model: 'gpt-test',
        },
      },
    });
    const encryption = createEncryptionServiceMock({
      decrypt: vi.fn().mockRejectedValue(new Error('decryption failed')),
    });
    const store = new SettingsStore(encryption);

    const settings = await store.getSettings();

    expect(settings.aiModel.apiKey).toBe('');
    expect(settings.maxComments).toBe(100);
    expect(settings.aiModel.model).toBe('gpt-test');
    expect(settings.aiModel.apiUrl).toBe('https://api.example.com/v1');
  });

  it('exports settings without the API key and re-imports without clobbering it', async () => {
    mockStorageGet.mockResolvedValue({
      [STORAGE.SETTINGS_KEY]: {
        maxComments: 100,
        aiModel: {
          apiUrl: 'https://api.example.com/v1',
          apiKey: 'enc:secret',
          model: 'gpt-test',
        },
      },
    });
    const encryption = createEncryptionServiceMock({
      decrypt: vi.fn().mockResolvedValue('sk-plaintext-secret'),
    });
    const store = new SettingsStore(encryption);

    const exported = JSON.parse(await store.exportSettings());
    expect(exported.aiModel.apiKey).toBeUndefined();
    expect(JSON.stringify(exported)).not.toContain('sk-plaintext-secret');
    expect(exported.aiModel.model).toBe('gpt-test');

    // Re-importing the export must keep the currently stored key (it is
    // decrypted for the merge and re-encrypted on save, which is value-equal).
    const importCalls = mockStorageSet.mock.calls;
    await store.importSettings(JSON.stringify(exported));
    const savedPayload = importCalls[importCalls.length - 1]?.[0] as Record<string, unknown>;
    const savedSettings = savedPayload?.[STORAGE.SETTINGS_KEY] as { aiModel: { apiKey: string } };
    expect(savedSettings.aiModel.apiKey).toBe('enc:sk-plaintext-secret');
  });

  it('clears the existing API key when an import changes the endpoint', async () => {
    mockStorageGet.mockResolvedValue({
      [STORAGE.SETTINGS_KEY]: {
        aiModel: {
          apiUrl: 'https://provider-a.example/v1',
          apiKey: 'enc:secret-a',
          model: 'model-a',
        },
      },
    });
    const encryption = createEncryptionServiceMock({
      decrypt: vi.fn().mockResolvedValue('sk-provider-a'),
    });
    const store = new SettingsStore(encryption);

    await store.importSettings(
      JSON.stringify({
        aiModel: {
          apiUrl: 'https://provider-b.example/v1',
          model: 'model-b',
        },
      }),
    );

    const savedPayload = mockStorageSet.mock.calls[
      mockStorageSet.mock.calls.length - 1
    ]?.[0] as Record<string, unknown>;
    const savedSettings = savedPayload[STORAGE.SETTINGS_KEY] as { aiModel: AIConfig };
    expect(savedSettings.aiModel.apiUrl).toBe('https://provider-b.example/v1');
    expect(savedSettings.aiModel.apiKey).toBe('');
  });

  it('rejects an imported API key protected by another browser profile', async () => {
    mockStorageGet.mockResolvedValue({
      [STORAGE.SETTINGS_KEY]: {
        aiModel: {
          apiUrl: 'https://provider.example/v1',
          apiKey: '',
          model: 'model',
        },
      },
    });
    const store = new SettingsStore(createEncryptionServiceMock());

    await expect(
      store.importSettings(
        JSON.stringify({
          aiModel: {
            apiKey: `${SECURITY.ENCRYPTION_PREFIX}opaque-ciphertext`,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('round-trips exported settings before an AI provider is configured', async () => {
    mockStorageGet.mockResolvedValue({
      [STORAGE.SETTINGS_KEY]: {
        aiModel: {
          apiUrl: '',
          apiKey: '',
          model: '',
        },
      },
    });
    const store = new SettingsStore(createEncryptionServiceMock());

    const exported = await store.exportSettings();

    await expect(store.importSettings(exported)).resolves.toBeUndefined();
  });

  it('rejects saving remote HTTP AI endpoints', async () => {
    mockStorageGet.mockResolvedValue({});
    const store = new SettingsStore(createEncryptionServiceMock());

    await expect(
      store.saveSettings(
        {
          aiModel: {
            apiUrl: 'http://provider.example/v1',
            apiKey: '',
            model: 'model',
            contextWindowSize: 128_000,
            temperature: 1,
            topP: 1,
          },
        },
        undefined,
        '',
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'AI API URL must use HTTPS, except for loopback development endpoints',
    });
  });

  it('rejects AI token budgets that exceed the configured context window', async () => {
    mockStorageGet.mockResolvedValue({});
    const store = new SettingsStore(createEncryptionServiceMock());

    await expect(
      store.saveSettings(
        {
          aiModel: {
            apiUrl: 'https://provider.example/v1',
            apiKey: '',
            model: 'model',
            contextWindowSize: 4096,
            maxOutputTokens: 3000,
            temperature: 1,
            topP: 1,
          },
        },
        undefined,
        '',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Invalid AI model limits' });
  });

  it('rejects imported remote HTTP AI endpoints', async () => {
    mockStorageGet.mockResolvedValue({
      [STORAGE.SETTINGS_KEY]: {
        aiModel: {
          apiUrl: 'https://provider.example/v1',
          apiKey: 'enc:secret',
          model: 'model',
        },
      },
    });
    const store = new SettingsStore(createEncryptionServiceMock());

    await expect(
      store.importSettings(
        JSON.stringify({ aiModel: { apiUrl: 'http://provider.example/v1', model: 'model' } }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects oversized settings writes and imports before validation or storage', async () => {
    mockStorageGet.mockResolvedValue({});
    const store = new SettingsStore(createEncryptionServiceMock());
    const oversized = new Array(10_001).fill({ invalid: true });

    await expect(store.saveSettings({ crawlingConfigs: oversized } as never)).rejects.toMatchObject(
      { code: 'VALIDATION_ERROR', message: 'Settings data is too large' },
    );
    await expect(
      store.importSettings(JSON.stringify({ crawlingConfigs: oversized })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Settings import is too large' });
    expect(mockStorageSet).not.toHaveBeenCalled();
  });

  it('creates secret and salt in a single atomic storage write', async () => {
    const { EncryptionService: RealEncryptionService } =
      await import('../src/background/storage/EncryptionService');
    mockStorageGet.mockResolvedValue({});
    const setCalls: unknown[][] = [];
    mockStorageSet.mockImplementation((payload: unknown) => {
      setCalls.push([payload]);
      return Promise.resolve();
    });

    const service = new RealEncryptionService();
    await service.ensureEncryptionReady();

    expect(setCalls).toHaveLength(1);
    const writtenKeys = Object.keys(setCalls[0][0] as Record<string, unknown>);
    expect(writtenKeys).toContain(STORAGE.ENCRYPTION_SECRET_KEY);
    expect(writtenKeys).toContain(STORAGE.ENCRYPTION_SALT_KEY);
  });
});
