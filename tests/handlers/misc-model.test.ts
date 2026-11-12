import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleGetAvailableModels, handleTestModel } from '../../src/background/handlers/misc';
import { handleSaveSettings, handleImportSettings } from '../../src/background/handlers/settings';
import { AIService } from '../../src/background/AIService';
import type { AIResponse } from '../../src/types';
import type { HandlerContext } from '../../src/background/handlers/types';
import { TEXT } from '../../src/config/constants';
import type { Message } from '../../src/types';
import { createMockHandlerContext } from '../helpers/handler-context';
import { createAIError, ErrorCode } from '../../src/utils/errors';

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
  protocol: 'openai-chat-completions' as const,
};

const asAIService = (callAI: ReturnType<typeof vi.fn>): HandlerContext['aiService'] =>
  ({
    callAI,
    rememberVerifiedConfig: vi.fn(),
    getVerificationEpoch: vi.fn().mockReturnValue(0),
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
          getVerificationEpoch: vi.fn().mockReturnValue(7),
        } as unknown as HandlerContext['aiService'],
        settingsStore: {
          saveSettings,
          getSettings: vi.fn().mockResolvedValue({ aiTimeout: 60000 }),
        } as unknown as HandlerContext['settingsStore'],
      }),
    );

    expect(callAI).toHaveBeenCalledWith(expect.objectContaining({ timeout: 60000 }));
    expect(rememberVerifiedConfig).toHaveBeenCalledWith(baseConfig, 7);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.response).toBe('OK');
    expect(res.message).toBe('Model is working correctly');
  });

  it.each(['save', 'import'] as const)(
    'does not resurrect a deleted key when an older model test finishes after %s',
    async (operation) => {
      const settingsStore = {
        getSettings: vi.fn().mockResolvedValue({ aiTimeout: 60000, developerMode: false }),
        saveSettings: vi.fn().mockResolvedValue(undefined),
        importSettings: vi.fn().mockResolvedValue(undefined),
      };
      const service = new AIService(
        settingsStore as unknown as ConstructorParameters<typeof AIService>[0],
        { saveAiLog: vi.fn() } as unknown as ConstructorParameters<typeof AIService>[1],
        {
          recordTokenUsage: vi.fn().mockResolvedValue(undefined),
        } as unknown as ConstructorParameters<typeof AIService>[2],
      );
      service.rememberVerifiedConfig(baseConfig);
      let resolveTest!: (response: AIResponse) => void;
      const callAI = vi.spyOn(service, 'callAI').mockReturnValueOnce(
        new Promise((resolve) => {
          resolveTest = resolve;
        }),
      );
      const context = createMockHandlerContext({
        aiService: service,
        settingsStore: settingsStore as unknown as HandlerContext['settingsStore'],
      });
      const oldTest = handleTestModel(
        { type: 'TEST_MODEL', payload: { config: baseConfig } },
        context,
      );
      await Promise.resolve();
      expect(callAI).toHaveBeenCalledOnce();
      if (operation === 'save') {
        await handleSaveSettings(
          {
            type: 'SAVE_SETTINGS',
            payload: {
              settings: { aiModel: { apiKey: '' } },
              expectedAiEndpoint: baseConfig.apiUrl,
            },
          },
          context,
        );
      } else {
        await handleImportSettings(
          { type: 'IMPORT_SETTINGS', payload: { data: '{"aiModel":{"apiKey":""}}' } },
          context,
        );
      }
      resolveTest({ content: 'OK', tokensUsed: 1, finishReason: 'stop' });
      expect((await oldTest).success).toBe(true);
      callAI.mockRestore();

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }),
      });
      vi.stubGlobal('fetch', fetchMock);
      await service.callAI({ prompt: 'Use saved settings', config: { ...baseConfig, apiKey: '' } });
      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty(
        'Authorization',
      );
    },
  );

  it.each(['save', 'import'] as const)(
    'keeps the previously verified key when %s persistence fails during a model test',
    async (operation) => {
      const settingsStore = {
        getSettings: vi.fn().mockResolvedValue({ aiTimeout: 60000, developerMode: false }),
        saveSettings: vi.fn().mockRejectedValue(new Error('storage unavailable')),
        importSettings: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      };
      const service = new AIService(
        settingsStore as unknown as ConstructorParameters<typeof AIService>[0],
        { saveAiLog: vi.fn() } as unknown as ConstructorParameters<typeof AIService>[1],
        {
          recordTokenUsage: vi.fn().mockResolvedValue(undefined),
        } as unknown as ConstructorParameters<typeof AIService>[2],
      );
      service.rememberVerifiedConfig(baseConfig);
      const epoch = service.getVerificationEpoch();
      let resolveTest!: (response: AIResponse) => void;
      const callAI = vi.spyOn(service, 'callAI').mockReturnValueOnce(
        new Promise((resolve) => {
          resolveTest = resolve;
        }),
      );
      const context = createMockHandlerContext({
        aiService: service,
        settingsStore: settingsStore as unknown as HandlerContext['settingsStore'],
      });
      const oldTest = handleTestModel(
        { type: 'TEST_MODEL', payload: { config: baseConfig } },
        context,
      );
      await Promise.resolve();
      await expect(
        operation === 'save'
          ? handleSaveSettings(
              {
                type: 'SAVE_SETTINGS',
                payload: {
                  settings: { aiModel: { apiKey: '' } },
                  expectedAiEndpoint: baseConfig.apiUrl,
                },
              },
              context,
            )
          : handleImportSettings(
              { type: 'IMPORT_SETTINGS', payload: { data: '{"aiModel":{"apiKey":""}}' } },
              context,
            ),
      ).rejects.toThrow('storage unavailable');
      expect(service.getVerificationEpoch()).toBe(epoch);
      resolveTest({ content: 'OK', tokensUsed: 1, finishReason: 'stop' });
      await oldTest;
      callAI.mockRestore();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }),
      });
      vi.stubGlobal('fetch', fetchMock);
      await service.callAI({
        prompt: 'Use prior verified settings',
        config: { ...baseConfig, apiKey: '' },
      });
      expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer key',
      });
    },
  );

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

  it('does not remember a completed test for a protocol that has changed', async () => {
    const rememberVerifiedConfig = vi.fn();
    const getSettings = vi
      .fn()
      .mockResolvedValueOnce({ aiTimeout: 60000, aiModel: baseConfig })
      .mockResolvedValueOnce({
        aiTimeout: 60000,
        aiModel: { ...baseConfig, protocol: 'openai-responses' },
      });
    const result = await handleTestModel(
      { type: 'TEST_MODEL', payload: { config: baseConfig } },
      createMockHandlerContext({
        aiService: {
          callAI: vi.fn().mockResolvedValue({ content: 'OK', tokensUsed: 1 }),
          rememberVerifiedConfig,
          getVerificationEpoch: vi.fn().mockReturnValue(0),
        } as unknown as HandlerContext['aiService'],
        settingsStore: { getSettings } as unknown as HandlerContext['settingsStore'],
      }),
    );
    expect(result.success).toBe(true);
    expect(rememberVerifiedConfig).not.toHaveBeenCalled();
  });

  it.each([undefined, 'anthropic-messages'] as const)(
    'forwards model discovery with the selected or legacy protocol (%s)',
    async (protocol) => {
      const getAvailableModels = vi.fn().mockResolvedValue(['test-model']);
      const result = await handleGetAvailableModels(
        {
          type: 'GET_AVAILABLE_MODELS',
          payload: { apiUrl: baseConfig.apiUrl, apiKey: 'key', protocol },
        },
        createMockHandlerContext({
          aiService: { getAvailableModels } as unknown as HandlerContext['aiService'],
        }),
      );
      expect(result.models).toEqual(['test-model']);
      expect(getAvailableModels).toHaveBeenCalledWith(
        baseConfig.apiUrl,
        'key',
        protocol ?? 'openai-chat-completions',
      );
    },
  );

  it('propagates model discovery errors for message-router serialization', async () => {
    const error = createAIError(ErrorCode.MISSING_API_KEY, 'Invalid API key', {}, false);
    await expect(
      handleGetAvailableModels(
        { type: 'GET_AVAILABLE_MODELS', payload: { apiUrl: baseConfig.apiUrl, apiKey: 'key' } },
        createMockHandlerContext({
          aiService: {
            getAvailableModels: vi.fn().mockRejectedValue(error),
          } as unknown as HandlerContext['aiService'],
        }),
      ),
    ).rejects.toBe(error);
  });
});
