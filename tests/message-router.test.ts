import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRouter } from '../src/background/MessageRouter';
import { MESSAGES } from '../src/config/constants';
import { ErrorCode } from '../src/utils/errors';

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
  handleAIAnalyzeStructure: vi.fn().mockResolvedValue({ selector: '.comments' }),
  handleAIExtractContent: vi.fn().mockResolvedValue({ comments: [] }),
  handleExtractionCompleted: vi.fn().mockResolvedValue({ success: true }),
  handleExtractionProgress: vi.fn().mockReturnValue(undefined),
  handleStartAnalysis: vi.fn().mockResolvedValue({ result: 'analysis' }),
}));

vi.mock('../src/background/handlers/settings', () => ({
  handleGetSettings: vi.fn().mockResolvedValue({ maxComments: 100 }),
  handleSaveSettings: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../src/background/handlers/history', () => ({
  handleGetHistory: vi.fn().mockResolvedValue([]),
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
}));

// Mock services
const mockTaskManager = {
  createTask: vi.fn(),
  getTask: vi.fn(),
  startTask: vi.fn(),
};

const mockAIService = {
  callAI: vi.fn(),
  analyzeComments: vi.fn(),
};

const mockStorageManager = {
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
};

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
  },
};

describe('MessageRouter', () => {
  let router: MessageRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new MessageRouter(
      mockTaskManager as any,
      mockAIService as any,
      mockStorageManager as any,
    );
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
        { type: MESSAGES.SAVE_SETTINGS, payload: { maxComments: 200 } },
        mockSender,
      );

      expect(result).toEqual({ success: true });
    });

    it('should handle GET_HISTORY message', async () => {
      const result = await router.handleMessage({ type: MESSAGES.GET_HISTORY }, mockSender);

      expect(result).toEqual([]);
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
        { type: MESSAGES.START_EXTRACTION, payload: { maxComments: 100 } },
        mockSender,
      );

      expect(result).toEqual({ taskId: 'test-task' });
    });

    it('should handle GET_AVAILABLE_MODELS message', async () => {
      const result = await router.handleMessage(
        { type: MESSAGES.GET_AVAILABLE_MODELS },
        mockSender,
      );

      expect(result).toEqual({ models: ['gpt-4'] });
    });

    it('should throw error for unknown message type', async () => {
      await expect(
        router.handleMessage({ type: 'UNKNOWN_TYPE' } as any, mockSender),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
      });
    });

    it('should ignore content script messages', async () => {
      const result1 = await router.handleMessage({ type: MESSAGES.GET_PLATFORM_INFO }, mockSender);
      const result2 = await router.handleMessage({ type: MESSAGES.GET_DOM_STRUCTURE }, mockSender);
      const result3 = await router.handleMessage({ type: MESSAGES.CANCEL_EXTRACTION }, mockSender);

      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
      expect(result3).toBeUndefined();
    });
  });

  describe('handlePortMessage', () => {
    it('should handle port message and send response', async () => {
      const mockPort = {
        sender: mockSender,
        postMessage: vi.fn(),
      };

      await router.handlePortMessage(mockPort as any, {
        id: 'correlation-123',
        type: MESSAGES.PING,
      });

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        id: 'correlation-123',
        response: { pong: true },
      });
    });

    it('should handle port message error and send error response', async () => {
      const mockPort = {
        sender: mockSender,
        postMessage: vi.fn(),
      };

      await router.handlePortMessage(mockPort as any, {
        id: 'correlation-456',
        type: 'UNKNOWN_TYPE' as any,
      });

      expect(mockPort.postMessage).toHaveBeenCalledWith({
        id: 'correlation-456',
        response: expect.objectContaining({
          error: expect.any(String),
        }),
      });
    });
  });
});
