import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRouter } from '../src/background/MessageRouter';
import { MESSAGES } from '../src/config/constants';
import { ErrorCode } from '../src/utils/errors';
import type { Message, PortMessage } from '../src/types';

// Mock Logger
vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock ErrorHandler
vi.mock('../src/utils/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/errors')>();
  return {
    ...actual,
    ErrorHandler: {
      handleError: vi.fn(),
    },
  };
});

// Mock handlers
vi.mock('../src/background/handlers/extraction', () => ({
  handleStartExtraction: vi.fn().mockResolvedValue({ taskId: 'test-task' }),
  handleExtractionCompleted: vi.fn().mockResolvedValue({ success: true }),
  handleExtractionProgress: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../src/background/handlers/analysis', () => ({
  handleStartAnalysis: vi.fn().mockResolvedValue({ result: 'analysis' }),
  handleGenerateDynamicReport: vi.fn().mockResolvedValue({ success: true }),
  handleAIAnalyzeStructure: vi.fn().mockResolvedValue({ selector: '.comments' }),
  handleAIExtractContent: vi.fn().mockResolvedValue({ comments: [] }),
}));

vi.mock('../src/background/handlers/config-generation', () => ({
  handleStartConfigGeneration: vi.fn().mockResolvedValue({ taskId: 'config-task' }),
  handleConfigGenerationCompleted: vi.fn().mockResolvedValue({ success: true }),
  handleGenerateCrawlingConfig: vi.fn().mockResolvedValue({ config: null }),
}));

vi.mock('../src/background/handlers/settings', () => ({
  handleGetSettings: vi.fn().mockResolvedValue({ maxComments: 100 }),
  handleSaveSettings: vi.fn().mockResolvedValue({ success: true }),
  handleImportSettings: vi.fn().mockResolvedValue({ success: true }),
  handleCacheSelector: vi.fn().mockResolvedValue({ success: true }),
  handleGetCrawlingConfig: vi.fn().mockResolvedValue({ config: null }),
  handleSaveCrawlingConfig: vi.fn().mockResolvedValue({ success: true }),
  handleSyncCrawlingConfigs: vi.fn().mockResolvedValue({ success: true }),
  handleUpdateFieldValidation: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../src/background/handlers/history', () => ({
  handleGetHistory: vi.fn().mockResolvedValue({ history: [] }),
  handleGetHistoryByUrl: vi.fn().mockResolvedValue(null),
  handleExportData: vi.fn().mockResolvedValue({ data: '' }),
  handleDeleteHistory: vi.fn().mockResolvedValue({ success: true }),
  handleClearAllHistory: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../src/background/handlers/task', () => ({
  handleGetTaskStatus: vi.fn().mockReturnValue({ status: 'pending' }),
  handleCancelTask: vi.fn().mockReturnValue({ success: true }),
}));

vi.mock('../src/background/handlers/misc', () => ({
  handlePing: vi.fn().mockReturnValue({ pong: true }),
  handleEnsureContentScript: vi.fn().mockResolvedValue({ injected: true }),
  handleGetAvailableModels: vi.fn().mockResolvedValue({ models: ['gpt-4'] }),
  handleTestModel: vi.fn().mockResolvedValue({ success: true }),
  handleTestSelector: vi.fn().mockResolvedValue({ found: true }),
}));

// Mock services
const mockTaskManager = {
  createTask: vi.fn(),
  getTask: vi.fn(),
  startTask: vi.fn(),
};

const mockAIService = {
  callAI: vi.fn(),
};

const mockCommentAnalyzer = {
  analyzeComments: vi.fn(),
};

const mockTimestampNormalizer = {
  normalizeCommentTimestamps: vi.fn(),
  normalizeSingleTimestamp: vi.fn(),
};

const mockSettingsStore = {
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
};

const mockHistoryStore = {};
const mockEncryptionService = {};
const mockLogStore = {};
const mockTokenStatsStore = {};
const mockCrawlingConfigStore = {};
const mockNotificationService = {};

const createRouter = (): MessageRouter =>
  new MessageRouter({
    taskManager: mockTaskManager as unknown as import('../src/background/TaskManager').TaskManager,
    aiService: mockAIService as unknown as import('../src/background/AIService').AIService,
    commentAnalyzer:
      mockCommentAnalyzer as unknown as import('../src/background/ai/CommentAnalyzer').CommentAnalyzer,
    timestampNormalizer:
      mockTimestampNormalizer as unknown as import('../src/background/ai/TimestampNormalizer').TimestampNormalizer,
    settingsStore:
      mockSettingsStore as unknown as import('../src/background/storage/SettingsStore').SettingsStore,
    historyStore:
      mockHistoryStore as unknown as import('../src/background/storage/HistoryStore').HistoryStore,
    encryptionService:
      mockEncryptionService as unknown as import('../src/background/storage/EncryptionService').EncryptionService,
    logStore: mockLogStore as unknown as import('../src/background/storage/LogStore').LogStore,
    tokenStatsStore:
      mockTokenStatsStore as unknown as import('../src/background/storage/TokenStatsStore').TokenStatsStore,
    crawlingConfigStore:
      mockCrawlingConfigStore as unknown as import('../src/background/storage/CrawlingConfigStore').CrawlingConfigStore,
    notificationService:
      mockNotificationService as unknown as import('../src/background/NotificationService').NotificationService,
  });

const createUnknownMessage = (type: string): Message => ({ type }) as unknown as Message;

const createMockPort = (): chrome.runtime.Port =>
  ({
    sender: mockSender,
    postMessage: vi.fn(),
  }) as unknown as chrome.runtime.Port;

const createMockPortWithoutSender = (): chrome.runtime.Port =>
  ({
    postMessage: vi.fn(),
  }) as unknown as chrome.runtime.Port;

const createUnknownPortMessage = (id: string, type: string): PortMessage =>
  ({ id, type }) as unknown as PortMessage;

const mockSender: chrome.runtime.MessageSender = {
  id: 'test-extension-id',
  tab: {
    id: 1,
    index: 0,
    windowId: 1,
    highlighted: false,
    active: true,
    pinned: false,
    incognito: false,
  } as unknown as chrome.tabs.Tab,
};

describe('MessageRouter', () => {
  let router: MessageRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    router = createRouter();
  });

  describe('handleMessage', () => {
    it('should handle PING message', async () => {
      const result = await router.handleMessage({ type: MESSAGES.PING }, mockSender);

      expect(result).toEqual({ pong: true });
    });

    it('should handle GET_SETTINGS message', async () => {
      const result = await router.handleMessage({ type: MESSAGES.GET_SETTINGS }, mockSender);

      expect(result).toEqual({ maxComments: 100 });
    });

    it('should handle SAVE_SETTINGS message', async () => {
      const result = await router.handleMessage(
        { type: MESSAGES.SAVE_SETTINGS, payload: { settings: { maxComments: 200 } } },
        mockSender,
      );

      expect(result).toEqual({ success: true });
    });

    it('should handle IMPORT_SETTINGS message', async () => {
      const result = await router.handleMessage(
        { type: MESSAGES.IMPORT_SETTINGS, payload: { data: '{"maxComments":200}' } },
        mockSender,
      );

      expect(result).toEqual({ success: true });
    });

    it('should handle GET_HISTORY message', async () => {
      const result = await router.handleMessage({ type: MESSAGES.GET_HISTORY }, mockSender);

      expect(result).toEqual({ history: [] });
    });

    it('should handle GET_TASK_STATUS message', async () => {
      const result = await router.handleMessage(
        { type: MESSAGES.GET_TASK_STATUS, payload: { taskId: 'test' } },
        mockSender,
      );

      expect(result).toEqual({ status: 'pending' });
    });

    it('should handle CANCEL_TASK message', async () => {
      const result = await router.handleMessage(
        { type: MESSAGES.CANCEL_TASK, payload: { taskId: 'test' } },
        mockSender,
      );

      expect(result).toEqual({ success: true });
    });

    it('should handle START_EXTRACTION message', async () => {
      const result = await router.handleMessage(
        {
          type: MESSAGES.START_EXTRACTION,
          payload: { url: 'https://example.com/post', maxComments: 100 },
        },
        mockSender,
      );

      expect(result).toEqual({ taskId: 'test-task' });
    });

    it('should handle GET_AVAILABLE_MODELS message', async () => {
      const result = await router.handleMessage(
        {
          type: MESSAGES.GET_AVAILABLE_MODELS,
          payload: { apiUrl: 'https://api.test', apiKey: '' },
        },
        mockSender,
      );

      expect(result).toEqual({ models: ['gpt-4'] });
    });

    it('should reject invalid payload before dispatching', async () => {
      await expect(
        router.handleMessage(
          { type: MESSAGES.START_EXTRACTION, payload: { maxComments: 100 } } as Message,
          mockSender,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringContaining('Invalid payload for START_EXTRACTION'),
      });
    });

    it('should reject invalid SAVE_SETTINGS payload before dispatching', async () => {
      await expect(
        router.handleMessage(
          {
            type: MESSAGES.SAVE_SETTINGS,
            payload: { settings: { aiModel: { contextWindowSize: 'bad-value' } } },
          } as unknown as Message,
          mockSender,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: expect.stringContaining('Invalid payload for SAVE_SETTINGS'),
      });
    });

    it('should throw error for unknown message type', async () => {
      await expect(
        router.handleMessage(createUnknownMessage('UNKNOWN_TYPE'), mockSender),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should ignore content script messages', async () => {
      const result1 = await router.handleMessage({ type: MESSAGES.GET_PLATFORM_INFO }, mockSender);
      const result2 = await router.handleMessage({ type: MESSAGES.GET_DOM_STRUCTURE }, mockSender);
      const result3 = await router.handleMessage(
        {
          type: MESSAGES.CANCEL_EXTRACTION,
          payload: { taskId: 'task_test' },
        } as unknown as Message,
        mockSender,
      );

      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
      expect(result3).toBeUndefined();
    });
  });

  describe('handlePortMessage', () => {
    it('should handle port message and send response', async () => {
      const mockPort = createMockPort();

      await router.handlePortMessage(mockPort, {
        id: 'correlation-123',
        type: MESSAGES.PING,
      });

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        id: 'correlation-123',
        response: { pong: true },
      });
    });

    it('should handle port message error and send error response', async () => {
      const mockPort = createMockPort();

      await router.handlePortMessage(
        mockPort,
        createUnknownPortMessage('correlation-456', 'UNKNOWN_TYPE'),
      );

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        id: 'correlation-456',
        response: expect.objectContaining({
          error: expect.any(String),
        }),
      });
    });

    it('should reject malformed port messages before routing', async () => {
      const mockPort = createMockPort();

      await router.handlePortMessage(mockPort, {
        id: '',
        type: MESSAGES.PING,
      } as PortMessage);

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        id: '',
        response: expect.objectContaining({
          error: expect.stringContaining('correlation ID is required'),
        }),
      });
    });

    it('should reject port messages without sender', async () => {
      const mockPort = createMockPortWithoutSender();

      await router.handlePortMessage(mockPort, {
        id: 'correlation-789',
        type: MESSAGES.PING,
      });

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        id: 'correlation-789',
        response: expect.objectContaining({
          error: expect.stringContaining('Port sender is required'),
        }),
      });
    });
  });

  describe('handlePortMessage', () => {
    it('deduplicates repeated AI bridge requests by correlation id', async () => {
      const analysisHandlers = await import('../src/background/handlers/analysis');
      const handleAIExtractContentMock = vi.mocked(analysisHandlers.handleAIExtractContent);
      handleAIExtractContentMock.mockImplementation(async () => {
        await Promise.resolve();
        return {
          comments: [
            { id: 'c1', username: 'u', content: 'x', likes: 0, timestamp: 't', replies: [] },
          ],
        };
      });
      const firstPort = createMockPort();
      const secondPort = createMockPort();
      const message: PortMessage = {
        id: 'shared-request-id',
        type: MESSAGES.AI_EXTRACT_CONTENT,
        payload: { chunks: ['<div>comment</div>'] },
      };

      await Promise.all([
        router.handlePortMessage(firstPort, message),
        router.handlePortMessage(secondPort, message),
      ]);

      expect(handleAIExtractContentMock).toHaveBeenCalledTimes(1);
      expect(firstPort.postMessage).toHaveBeenCalledWith({
        id: 'shared-request-id',
        response: {
          comments: [
            { id: 'c1', username: 'u', content: 'x', likes: 0, timestamp: 't', replies: [] },
          ],
        },
      });
      expect(secondPort.postMessage).toHaveBeenCalledWith({
        id: 'shared-request-id',
        response: {
          comments: [
            { id: 'c1', username: 'u', content: 'x', likes: 0, timestamp: 't', replies: [] },
          ],
        },
      });
    });
  });
});
