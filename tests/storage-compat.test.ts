import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryStore } from '../src/background/storage/HistoryStore';
import { SettingsStore } from '../src/background/storage/SettingsStore';
import type { EncryptionService } from '../src/background/storage/EncryptionService';
import type { AIConfig } from '../src/types';
import { STORAGE } from '../src/config/constants';
import {
  sanitizePersistedTaskState,
  sanitizeStoredSettings,
  sanitizeTokenStats,
} from '../src/utils/storage-validation';

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

function createEncryptionServiceMock(overrides: Record<string, unknown> = {}) {
  return {
    ensureEncryptionReady: vi.fn().mockResolvedValue(undefined),
    encrypt: vi.fn().mockImplementation((text: string) => Promise.resolve(`enc:${text}`)),
    decrypt: vi.fn().mockResolvedValue(''),
    ...overrides,
  } as unknown as EncryptionService;
}

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

      await store.saveHistory(legacyItem);

      const fetched = await store.getHistoryItem(legacyItem.id);
      expect(fetched).toBeDefined();
      expect(fetched?.id).toBe(legacyItem.id);
      expect(fetched?.comments).toHaveLength(1);
    });

    it('populates historyMetadata from history rows during upgrade', async () => {
      const store = new HistoryStore();
      await store.saveHistory({
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
      await store.saveHistory({
        id: 'old_id',
        url: 'https://example.com/same',
        title: 'Old',
        platform: 'example.com',
        extractedAt: 100,
        commentsCount: 0,
        comments: [],
      });
      await store.saveHistory({
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
      store.saveSettings({
        aiModel: {
          apiUrl: 'http://provider.example/v1',
          apiKey: '',
          model: 'model',
          contextWindowSize: 128_000,
          temperature: 1,
          topP: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
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
