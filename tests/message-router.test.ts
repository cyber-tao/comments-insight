import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRouter, isLogMessageType } from '../src/background/MessageRouter';
import { Logger } from '../src/utils/logger';
import type { LogEntry } from '../src/utils/logger';
import { MESSAGES } from '../src/config/constants';
import { ErrorCode } from '../src/utils/errors';
import { PORT_CANCEL_MESSAGE_TYPE } from '../src/types';
import type { Message, PortMessage } from '../src/types';
import type { HandlerContext } from '../src/background/handlers/types';

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
const mockLogStore = {
  saveSystemLog: vi.fn().mockResolvedValue(undefined),
  deleteLog: vi.fn().mockResolvedValue(undefined),
  clearLogs: vi.fn().mockResolvedValue(undefined),
};
const mockTokenStatsStore = {};
const mockCrawlingConfigStore = {};
const mockNotificationService = {};

const createRouter = (options?: ConstructorParameters<typeof MessageRouter>[1]): MessageRouter =>
  new MessageRouter(
    {
      taskManager:
        mockTaskManager as unknown as import('../src/background/TaskManager').TaskManager,
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
    },
    options,
  );

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

    it('should fail closed when background initialization failed', async () => {
      const readyPromise = Promise.reject(new Error('migration failed'));
      void readyPromise.catch(() => undefined);
      router = createRouter({ readyPromise });
      const miscHandlers = await import('../src/background/handlers/misc');

      await expect(router.handleMessage({ type: MESSAGES.PING }, mockSender)).rejects.toMatchObject(
        {
          code: ErrorCode.INITIALIZATION_FAILED,
          message: 'Extension initialization failed',
        },
      );
      expect(miscHandlers.handlePing).not.toHaveBeenCalled();
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

    it('should reject content-only commands at the background boundary', async () => {
      await expect(
        router.handleMessage(
          {
            type: MESSAGES.RUN_EXTRACTION,
            payload: { taskId: 'task_test', maxComments: 10 },
          } as unknown as Message,
          mockSender,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });
  });

  describe('log transport', () => {
    const entry: LogEntry = {
      level: 'INFO' as LogEntry['level'],
      timestamp: 1234,
      message: 'Background-owned log',
      data: { safe: true },
    };

    it('awaits system log persistence and acknowledges without logging its own transport', async () => {
      let resolve!: () => void;
      const persisted = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
      });
      mockLogStore.saveSystemLog.mockReturnValueOnce(persisted);
      const message: Message = { type: MESSAGES.APPEND_SYSTEM_LOG, payload: { entry } };
      const request = router.handleMessage(message, mockSender);
      let settled = false;
      void request.then(() => {
        settled = true;
      });
      await vi.waitFor(() => {
        expect(mockLogStore.saveSystemLog).toHaveBeenCalledExactlyOnceWith(entry);
      });

      expect(settled).toBe(false);
      expect(Logger.debug).not.toHaveBeenCalled();
      resolve();
      await expect(request).resolves.toEqual({ success: true });
      expect(Logger.debug).not.toHaveBeenCalled();
      expect(Logger.info).not.toHaveBeenCalled();
    });

    it.each(['ai', 'system'] as const)(
      'deletes %s logs through LogStore without recursive logs',
      async (kind) => {
        const key = kind === 'ai' ? 'ai_log_1' : 'log_info_1';
        const result = await router.handleMessage(
          {
            type: MESSAGES.DELETE_LOG,
            payload: { key, kind },
          },
          mockSender,
        );

        expect(result).toEqual({ success: true });
        expect(mockLogStore.deleteLog).toHaveBeenCalledExactlyOnceWith(key, kind);
        expect(Logger.debug).not.toHaveBeenCalled();
        expect(Logger.info).not.toHaveBeenCalled();
      },
    );

    it.each(['ai', 'system', 'all'] as const)(
      'clears %s logs through LogStore without recursive logs',
      async (kind) => {
        await expect(
          router.handleMessage(
            {
              type: MESSAGES.CLEAR_LOGS,
              payload: { kind },
            },
            mockSender,
          ),
        ).resolves.toEqual({ success: true });

        expect(mockLogStore.clearLogs).toHaveBeenCalledExactlyOnceWith(kind);
        expect(Logger.debug).not.toHaveBeenCalled();
        expect(Logger.info).not.toHaveBeenCalled();
      },
    );

    it.each([
      { type: MESSAGES.APPEND_SYSTEM_LOG, payload: { entry: { ...entry, level: 'INVALID' } } },
      { type: MESSAGES.APPEND_SYSTEM_LOG, payload: { entry: { ...entry, timestamp: Infinity } } },
      { type: MESSAGES.APPEND_SYSTEM_LOG, payload: { entry: { ...entry, message: 42 } } },
      { type: MESSAGES.DELETE_LOG, payload: { key: '', kind: 'system' } },
      { type: MESSAGES.DELETE_LOG, payload: { key: 'ai_log_1', kind: 'all' } },
      { type: MESSAGES.CLEAR_LOGS, payload: { kind: 'unknown' } },
    ])('validates log messages before touching storage ($type)', async (message) => {
      await expect(router.handleMessage(message as Message, mockSender)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });

      expect(mockLogStore.saveSystemLog).not.toHaveBeenCalled();
      expect(mockLogStore.deleteLog).not.toHaveBeenCalled();
      expect(mockLogStore.clearLogs).not.toHaveBeenCalled();
      expect(Logger.debug).not.toHaveBeenCalled();
    });

    it.each([
      {
        method: 'saveSystemLog' as const,
        message: { type: MESSAGES.APPEND_SYSTEM_LOG, payload: { entry } },
      },
      {
        method: 'deleteLog' as const,
        message: { type: MESSAGES.DELETE_LOG, payload: { key: 'ai_log_1', kind: 'ai' } },
      },
      {
        method: 'clearLogs' as const,
        message: { type: MESSAGES.CLEAR_LOGS, payload: { kind: 'all' } },
      },
    ])(
      'does not acknowledge failed $method operations or recursively log them',
      async ({ method, message }) => {
        const failure = new Error('storage unavailable');
        mockLogStore[method].mockRejectedValueOnce(failure);

        await expect(router.handleMessage(message as Message, mockSender)).rejects.toBe(failure);

        expect(Logger.debug).not.toHaveBeenCalled();
        expect(Logger.info).not.toHaveBeenCalled();
        expect(Logger.error).not.toHaveBeenCalled();
      },
    );

    it.each([
      [MESSAGES.APPEND_SYSTEM_LOG, true],
      [MESSAGES.DELETE_LOG, true],
      [MESSAGES.CLEAR_LOGS, true],
      [MESSAGES.PING, false],
      ['APPEND_SYSTEM_LOG_EXTRA', false],
      [undefined, false],
      [null, false],
      [{ type: MESSAGES.APPEND_SYSTEM_LOG }, false],
    ])('classifies only exact log transport types (%s)', (type, expected) => {
      expect(isLogMessageType(type)).toBe(expected);
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
          error: expect.objectContaining({ message: expect.any(String) }),
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
          error: expect.objectContaining({
            code: ErrorCode.VALIDATION_ERROR,
            message: expect.stringContaining('correlation ID is required'),
          }),
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
          error: expect.objectContaining({
            code: ErrorCode.VALIDATION_ERROR,
            message: expect.stringContaining('Port sender is required'),
          }),
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

    it('aborts the matching background request when the bridge sends cancellation', async () => {
      const analysisHandlers = await import('../src/background/handlers/analysis');
      const handleAIExtractContentMock = vi.mocked(analysisHandlers.handleAIExtractContent);
      let requestSignal: AbortSignal | undefined;
      handleAIExtractContentMock.mockImplementation(
        async (_message, context: HandlerContext) =>
          new Promise((_, reject) => {
            requestSignal = context.requestSignal;
            requestSignal?.addEventListener('abort', () => reject(new Error('Request aborted')));
          }),
      );
      const port = createMockPort();
      const request = {
        id: 'cancelled-request-id',
        type: MESSAGES.AI_EXTRACT_CONTENT,
        payload: { chunks: ['<div>comment</div>'] },
      } as PortMessage;

      const requestPromise = router.handlePortMessage(port, request);
      await Promise.resolve();
      await Promise.resolve();
      await router.handlePortMessage(port, {
        id: request.id,
        type: PORT_CANCEL_MESSAGE_TYPE,
      });
      await requestPromise;

      expect(requestSignal?.aborted).toBe(true);
      expect(port.postMessage).toHaveBeenCalledWith({
        id: request.id,
        response: {
          error: {
            code: ErrorCode.UNKNOWN_ERROR,
            message: 'Request aborted',
            retryable: false,
          },
        },
      });
    });
  });
});
