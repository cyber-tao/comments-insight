import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTestModel } from '../../src/background/handlers/misc';
import type { HandlerContext } from '../../src/background/handlers/types';
import { TEXT } from '../../src/config/constants';

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

const ctx = (overrides: Partial<HandlerContext> = {}): HandlerContext =>
  ({
    taskManager: {} as any,
    aiService: {} as any,
    storageManager: {} as any,
    sender: { tab: { id: 1 } },
    ...overrides,
  }) as HandlerContext;

describe('misc handlers - model test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return success when model responds', async () => {
    const callAI = vi.fn().mockResolvedValue({
      content: 'OK',
      tokensUsed: 5,
      finishReason: 'stop',
    });

    const res = await handleTestModel(
      { type: 'TEST_MODEL', payload: { config: baseConfig } } as any,
      ctx({ aiService: { callAI } as any }),
    );

    expect(callAI).toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.response).toBe('OK');
    expect(res.message).toBe('Model is working correctly');
  });

  it('should append hint on failure', async () => {
    const errorMessage = 'Network issue';
    const callAI = vi.fn().mockRejectedValue(new Error(errorMessage));

    const res = await handleTestModel(
      { type: 'TEST_MODEL', payload: { config: baseConfig } } as any,
      ctx({ aiService: { callAI } as any }),
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain(errorMessage);
    expect(res.error).toContain(TEXT.MODEL_TEST_HINT);
  });
});
