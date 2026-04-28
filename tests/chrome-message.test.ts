import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendMessage, sendMessageToTab, sendMessageVoid } from '@/utils/chrome-message';
import type { Message } from '@/types';

// Mock chrome API
const mockChrome = {
  runtime: {
    sendMessage: vi.fn(),
    lastError: null as { message?: string } | null,
  },
  tabs: {
    sendMessage: vi.fn(),
  },
};

// Setup global chrome mock
vi.stubGlobal('chrome', mockChrome);

describe('chrome-message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChrome.runtime.lastError = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('sendMessage', () => {
    it('should send message and receive response', async () => {
      const testMessage: Message = { type: 'GET_SETTINGS' };
      const testResponse = { success: true, data: 'test' };

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: (response: unknown) => void) => {
          callback(testResponse);
        },
      );

      const result = await sendMessage(testMessage);

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        testMessage,
        expect.any(Function),
      );
      expect(result).toEqual(testResponse);
    });

    it('should reject on timeout', async () => {
      const testMessage: Message = { type: 'GET_SETTINGS' };

      mockChrome.runtime.sendMessage.mockImplementation(() => {
        // Never call the callback to simulate timeout
      });

      const promise = sendMessage(testMessage, { timeoutMs: 100 });

      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow('Message timeout');
    });

    it('should reject on chrome.runtime.lastError', async () => {
      const testMessage: Message = { type: 'GET_SETTINGS' };
      const errorMessage = 'Connection failed';

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: (response: unknown) => void) => {
          mockChrome.runtime.lastError = { message: errorMessage };
          callback(undefined);
        },
      );

      await expect(sendMessage(testMessage)).rejects.toThrow(errorMessage);
    });

    it('should handle lastError without message', async () => {
      const testMessage: Message = { type: 'GET_SETTINGS' };

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: (response: unknown) => void) => {
          mockChrome.runtime.lastError = {};
          callback(undefined);
        },
      );

      await expect(sendMessage(testMessage)).rejects.toThrow('Unknown chrome runtime error');
    });

    it('should use custom timeout', async () => {
      const testMessage: Message = { type: 'GET_SETTINGS' };

      mockChrome.runtime.sendMessage.mockImplementation(() => {
        // Never call callback
      });

      const promise = sendMessage(testMessage, { timeoutMs: 5000 });

      // Should not reject at 4999ms
      vi.advanceTimersByTime(4999);

      // Should reject at 5000ms
      vi.advanceTimersByTime(1);

      await expect(promise).rejects.toThrow('Message timeout');
    });

    it('should clear timeout on successful response', async () => {
      const testMessage: Message = { type: 'GET_SETTINGS' };
      const testResponse = { data: 'success' };

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: (response: unknown) => void) => {
          // Immediate response
          callback(testResponse);
        },
      );

      const result = await sendMessage(testMessage, { timeoutMs: 100 });

      expect(result).toEqual(testResponse);

      // Advance time past timeout - should not cause any issues
      vi.advanceTimersByTime(200);
    });

    it('should handle settled flag for race condition (timeout first)', async () => {
      const testMessage: Message = { type: 'GET_SETTINGS' };
      let capturedCallback: ((response: unknown) => void) | null = null;

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: (response: unknown) => void) => {
          capturedCallback = callback;
        },
      );

      const promise = sendMessage(testMessage, { timeoutMs: 100 });

      // Timeout first
      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow('Message timeout');

      // Now call the callback - should be ignored due to settled flag
      if (capturedCallback) {
        capturedCallback({ data: 'late response' });
      }
      // If settled flag works correctly, no additional errors or state changes
    });

    it('should handle settled flag for race condition (response first)', async () => {
      const testMessage: Message = { type: 'GET_SETTINGS' };
      const testResponse = { data: 'quick response' };

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: (response: unknown) => void) => {
          callback(testResponse);
        },
      );

      const result = await sendMessage(testMessage, { timeoutMs: 100 });

      expect(result).toEqual(testResponse);

      // Advance past timeout - should not cause double rejection
      vi.advanceTimersByTime(200);
    });

    it('should handle null response', async () => {
      const testMessage: Message = { type: 'GET_SETTINGS' };

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: (response: unknown) => void) => {
          callback(null);
        },
      );

      const result = await sendMessage(testMessage);

      expect(result).toBeNull();
    });

    it('should handle undefined response', async () => {
      const testMessage: Message = { type: 'GET_SETTINGS' };

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: (response: unknown) => void) => {
          callback(undefined);
        },
      );

      const result = await sendMessage(testMessage);

      expect(result).toBeUndefined();
    });
  });

  describe('sendMessageToTab', () => {
    it('should send message to specific tab', async () => {
      const tabId = 123;
      const testMessage: Message = { type: 'GET_PLATFORM_INFO' };
      const testResponse = { platform: 'youtube' };

      mockChrome.tabs.sendMessage.mockImplementation(
        (_tabId: number, _message: Message, callback: (response: unknown) => void) => {
          callback(testResponse);
        },
      );

      const result = await sendMessageToTab(tabId, testMessage);

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
        tabId,
        testMessage,
        expect.any(Function),
      );
      expect(result).toEqual(testResponse);
    });

    it('should reject on timeout for tab message', async () => {
      const tabId = 456;
      const testMessage: Message = { type: 'GET_PLATFORM_INFO' };

      mockChrome.tabs.sendMessage.mockImplementation(() => {
        // Never call callback
      });

      const promise = sendMessageToTab(tabId, testMessage, { timeoutMs: 100 });

      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow('Message timeout');
    });

    it('should reject on chrome.runtime.lastError for tab message', async () => {
      const tabId = 789;
      const testMessage: Message = { type: 'GET_PLATFORM_INFO' };
      const errorMessage = 'Tab not found';

      mockChrome.tabs.sendMessage.mockImplementation(
        (_tabId: number, _message: Message, callback: (response: unknown) => void) => {
          mockChrome.runtime.lastError = { message: errorMessage };
          callback(undefined);
        },
      );

      await expect(sendMessageToTab(tabId, testMessage)).rejects.toThrow(errorMessage);
    });

    it('should handle settled flag for tab messages', async () => {
      const tabId = 111;
      const testMessage: Message = { type: 'GET_PLATFORM_INFO' };
      let capturedCallback: ((response: unknown) => void) | null = null;

      mockChrome.tabs.sendMessage.mockImplementation(
        (_tabId: number, _message: Message, callback: (response: unknown) => void) => {
          capturedCallback = callback;
        },
      );

      const promise = sendMessageToTab(tabId, testMessage, { timeoutMs: 50 });

      vi.advanceTimersByTime(50);

      await expect(promise).rejects.toThrow('Message timeout');

      // Late callback should be ignored
      if (capturedCallback) {
        capturedCallback({ data: 'too late' });
      }
    });
  });

  describe('sendMessageVoid', () => {
    it('should send message and resolve without returning data', async () => {
      const testMessage: Message = { type: 'CANCEL_TASK' };

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: () => void) => {
          callback();
        },
      );

      const result = await sendMessageVoid(testMessage);

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        testMessage,
        expect.any(Function),
      );
      expect(result).toBeUndefined();
    });

    it('should reject on timeout for void message', async () => {
      const testMessage: Message = { type: 'CANCEL_TASK' };

      mockChrome.runtime.sendMessage.mockImplementation(() => {
        // Never call callback
      });

      const promise = sendMessageVoid(testMessage, { timeoutMs: 100 });

      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow('Message timeout');
    });

    it('should reject on chrome.runtime.lastError for void message', async () => {
      const testMessage: Message = { type: 'CANCEL_TASK' };
      const errorMessage = 'Service worker inactive';

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: () => void) => {
          mockChrome.runtime.lastError = { message: errorMessage };
          callback();
        },
      );

      await expect(sendMessageVoid(testMessage)).rejects.toThrow(errorMessage);
    });

    it('should handle settled flag for void messages', async () => {
      const testMessage: Message = { type: 'CANCEL_TASK' };
      let capturedCallback: (() => void) | null = null;

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: () => void) => {
          capturedCallback = callback;
        },
      );

      const promise = sendMessageVoid(testMessage, { timeoutMs: 50 });

      vi.advanceTimersByTime(50);

      await expect(promise).rejects.toThrow('Message timeout');

      // Late callback should be ignored
      if (capturedCallback) {
        capturedCallback();
      }
    });

    it('should use default timeout when not specified', async () => {
      const testMessage: Message = { type: 'CANCEL_TASK' };

      mockChrome.runtime.sendMessage.mockImplementation(() => {
        // Never call callback
      });

      const promise = sendMessageVoid(testMessage);

      // Default timeout is TIMEOUT.MESSAGE_RESPONSE_MS (10000)
      vi.advanceTimersByTime(9999);

      // Should not have rejected yet
      let rejected = false;
      promise.catch(() => {
        rejected = true;
      });

      vi.advanceTimersByTime(1);

      await vi.runAllTimersAsync();

      expect(rejected).toBe(true);
    });
  });

  describe('message types', () => {
    it('should work with different message types', async () => {
      const messages: Message[] = [
        { type: 'GET_SETTINGS' },
        { type: 'SAVE_SETTINGS', payload: { maxComments: 100 } },
        { type: 'START_EXTRACTION', payload: { url: 'https://example.com' } },
        { type: 'CANCEL_TASK' },
        { type: 'GET_HISTORY' },
      ];

      for (const message of messages) {
        mockChrome.runtime.sendMessage.mockImplementation(
          (_msg: Message, callback: (response: unknown) => void) => {
            callback({ success: true });
          },
        );

        const result = await sendMessage(message);
        expect(result).toEqual({ success: true });
      }

      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledTimes(messages.length);
    });
  });

  describe('typed responses', () => {
    it('should preserve type in response', async () => {
      interface TestResponse {
        id: number;
        name: string;
        active: boolean;
      }

      const testMessage: Message = { type: 'GET_SETTINGS' };
      const testResponse: TestResponse = { id: 1, name: 'test', active: true };

      mockChrome.runtime.sendMessage.mockImplementation(
        (_message: Message, callback: (response: unknown) => void) => {
          callback(testResponse);
        },
      );

      const result = await sendMessage<TestResponse>(testMessage);

      expect(result.id).toBe(1);
      expect(result.name).toBe('test');
      expect(result.active).toBe(true);
    });
  });
});
