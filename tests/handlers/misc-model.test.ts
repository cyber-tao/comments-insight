import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTestModel } from '../../src/background/handlers/misc';
import type { HandlerContext } from '../../src/background/handlers/types';
import { TEXT } from '../../src/config/constants';
import type { Message } from '../../src/types';
import { createMockHandlerContext } from '../helpers/handler-context';

vi.mock('../../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const baseConfig = {
  apiUrl: 'https://api.example.com/v1',
  apiKey: 'key',
  model: 'demo-model',
  maxTokens: 100,
  temperature: 0.7,
  topP: 0.9,
};

const asAIService = (callAI: ReturnType<typeof vi.fn>): HandlerContext['aiService'] =>
  ({
    callAI,
    rememberVerifiedConfig: vi.fn(),
  }) as unknown as HandlerContext['aiService'];

describe('misc handlers - model test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as typeof chrome);
  });

  it('should return success when model responds', async () => {
    const callAI = vi.fn().mockResolvedValue({
      content: 'OK',
      tokensUsed: 5,
      finishReason: 'stop',
    });
    const saveSettings = vi.fn().mockResolvedValue(undefined);

    const res = await handleTestModel(
      { type: 'TEST_MODEL', payload: { config: baseConfig } } as Extract<
        Message,
        { type: 'TEST_MODEL' }
      >,
      createMockHandlerContext({
        aiService: asAIService(callAI),
        storageManager: {
          saveSettings,
        } as unknown as HandlerContext['storageManager'],
      }),
    );

    expect(callAI).toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalledWith({
      aiModel: baseConfig,
    });
    expect(res.success).toBe(true);
    expect(res.response).toBe('OK');
    expect(res.message).toBe('Model is working correctly');
  });

  it('should fail when persisting tested config fails', async () => {
    const callAI = vi.fn().mockResolvedValue({
      content: 'OK',
      tokensUsed: 5,
      finishReason: 'stop',
    });
    const saveSettings = vi.fn().mockRejectedValue(new Error('persist failed'));

    const res = await handleTestModel(
      { type: 'TEST_MODEL', payload: { config: baseConfig } } as Extract<
        Message,
        { type: 'TEST_MODEL' }
      >,
      createMockHandlerContext({
        aiService: asAIService(callAI),
        storageManager: {
          saveSettings,
        } as unknown as HandlerContext['storageManager'],
      }),
    );

    expect(callAI).toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalled();
    expect(res.success).toBe(false);
    expect(res.error).toContain('failed to persist AI model settings');
  });

  it('should append hint on failure', async () => {
    const errorMessage = 'Network issue';
    const callAI = vi.fn().mockRejectedValue(new Error(errorMessage));

    const res = await handleTestModel(
      { type: 'TEST_MODEL', payload: { config: baseConfig } } as Extract<
        Message,
        { type: 'TEST_MODEL' }
      >,
      createMockHandlerContext({
        aiService: asAIService(callAI),
        storageManager: {
          saveSettings: vi.fn(),
        } as unknown as HandlerContext['storageManager'],
      }),
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain(errorMessage);
    expect(res.error).toContain(TEXT.MODEL_TEST_HINT);
  });
});
