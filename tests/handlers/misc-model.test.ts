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
  contextWindowSize: 128000,
  maxOutputTokens: 100,
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

  it('should return success when model responds without persisting settings', async () => {
    const rememberVerifiedConfig = vi.fn();
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
        aiService: {
          callAI,
          rememberVerifiedConfig,
        } as unknown as HandlerContext['aiService'],
        settingsStore: {
          saveSettings,
          getSettings: vi.fn().mockResolvedValue({ aiTimeout: 60000 }),
        } as unknown as HandlerContext['settingsStore'],
      }),
    );

    expect(callAI).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60000 }));
    expect(rememberVerifiedConfig).toHaveBeenCalledWith(baseConfig);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.response).toBe('OK');
    expect(res.message).toBe('Model is working correctly');
  });

  it('should append hint on failure', async () => {
    const errorMessage = 'Network issue';
    const callAI = vi.fn().mockRejectedValue(new Error(errorMessage));

    const mockSaveSettings = vi.fn();

    const res = await handleTestModel(
      { type: 'TEST_MODEL', payload: { config: baseConfig } } as Extract<
        Message,
        { type: 'TEST_MODEL' }
      >,
      createMockHandlerContext({
        aiService: asAIService(callAI),
        settingsStore: {
          saveSettings: mockSaveSettings,
          getSettings: vi.fn().mockResolvedValue({ aiTimeout: 60000 }),
        } as unknown as HandlerContext['settingsStore'],
      }),
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain(errorMessage);
    expect(res.error).toContain(TEXT.MODEL_TEST_HINT);
  });
});
