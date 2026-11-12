import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIService } from '../src/background/AIService';
import { CommentAnalyzer } from '../src/background/ai/CommentAnalyzer';
import { mockAIConfig, mockComment, mockComments } from './fixtures';
import { ErrorCode } from '../src/utils/errors';
import { AI, TEXT, TIMEOUT } from '../src/config/constants';
import { Logger } from '../src/utils/logger';

vi.hoisted(() => vi.resetModules());

// Mock chrome API
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
});

// Mock Logger
vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Stores
const mockSettingsStore = {
  getSettings: vi.fn().mockResolvedValue({ developerMode: false }),
};

const mockTokenStatsStore = {
  recordTokenUsage: vi.fn().mockResolvedValue(undefined),
};

const mockLogStore = {
  saveAiLog: vi.fn().mockResolvedValue(undefined),
};

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const createStreamingResponse = (chunks: string[]) => ({
  ok: true,
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }),
});

describe('AIService', () => {
  let aiService: AIService;
  let commentAnalyzer: CommentAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    aiService = new AIService(
      mockSettingsStore as unknown as ConstructorParameters<typeof AIService>[0],
      mockLogStore as unknown as ConstructorParameters<typeof AIService>[1],
      mockTokenStatsStore as unknown as ConstructorParameters<typeof AIService>[2],
    );
    commentAnalyzer = new CommentAnalyzer(aiService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('callAI', () => {
    it('classifies Responses output-limit errors without retrying or leaking credentials', async () => {
      const apiKey = 'responses-private-key';
      mockFetch.mockResolvedValue(
        new Response(`max_output_tokens exceeds the model limit: ${apiKey}`, { status: 400 }),
      );
      await expect(
        aiService.callAI({
          prompt: 'Test',
          config: mockAIConfig({ protocol: 'openai-responses', apiKey }),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_CONFIG,
        retryable: false,
        details: { response: 'max_output_tokens exceeds the model limit: [redacted]' },
      });
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain(apiKey);
      expect(JSON.stringify(vi.mocked(Logger.error).mock.calls)).not.toContain(apiKey);
    });

    it.each(['openai-responses', 'anthropic-messages'] as const)(
      'uses %s headers, endpoint and token accounting',
      async (protocol) => {
        const response =
          protocol === 'openai-responses'
            ? {
                status: 'completed',
                output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }],
                usage: { total_tokens: 10 },
              }
            : {
                content: [{ type: 'text', text: 'Hello' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 6, output_tokens: 4 },
              };
        mockFetch.mockResolvedValue(Response.json(response));
        const result = await aiService.callAI({
          prompt: 'Test',
          config: mockAIConfig({ protocol }),
        });
        expect(result).toEqual({ content: 'Hello', tokensUsed: 10, finishReason: 'stop' });
        expect(mockTokenStatsStore.recordTokenUsage).toHaveBeenCalledExactlyOnceWith(10);
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe(
          `https://api.openai.com/v1/${protocol === 'openai-responses' ? 'responses' : 'messages'}`,
        );
        expect(init.redirect).toBe('manual');
        expect(init.headers[protocol === 'openai-responses' ? 'Authorization' : 'x-api-key']).toBe(
          protocol === 'openai-responses' ? 'Bearer test-api-key' : 'test-api-key',
        );
      },
    );

    it('does not reuse verified credentials across protocols on the same endpoint', async () => {
      aiService.rememberVerifiedConfig(mockAIConfig({ apiKey: 'remembered-key' }));
      mockFetch.mockResolvedValue(
        Response.json({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }],
        }),
      );
      await aiService.callAI({
        prompt: 'Test',
        config: mockAIConfig({ protocol: 'openai-responses', apiKey: '' }),
      });
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    });

    it('rejects an incomplete Responses result without recording partial tokens or retrying', async () => {
      mockFetch.mockResolvedValue(
        createStreamingResponse([
          'data: {"type":"response.output_text.delta","delta":"Partial"}\n\n',
          'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"usage":{"total_tokens":10}}}\n\n',
        ]),
      );
      await expect(
        aiService.callAI({
          prompt: 'Test',
          config: mockAIConfig({ protocol: 'openai-responses' }),
        }),
      ).rejects.toMatchObject({ code: ErrorCode.AI_INVALID_RESPONSE, retryable: false });
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockTokenStatsStore.recordTokenUsage).not.toHaveBeenCalled();
    });

    it.each([{ type: 'opaqueredirect', status: 0 }, { status: 307 }, { status: 308 }])(
      'rejects provider redirects without retrying (%j)',
      async (redirectResponse) => {
        const readBody = vi.fn();
        mockFetch.mockResolvedValue({ ...redirectResponse, ok: false, text: readBody });

        await expect(
          aiService.callAI({ prompt: 'Private synthetic comment', config: mockAIConfig() }),
        ).rejects.toMatchObject({
          code: ErrorCode.AI_ENDPOINT_REDIRECT,
          details: { messageKey: 'errors.aiEndpointRedirect' },
          retryable: false,
        });
        expect(mockFetch).toHaveBeenCalledOnce();
        expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
        expect(readBody).not.toHaveBeenCalled();
      },
    );

    it('redacts the exact request credential from HTTP diagnostics and persisted AI logs', async () => {
      const apiKey = 'fixture_key.with-special+characters';
      mockSettingsStore.getSettings.mockResolvedValueOnce({ developerMode: true });
      mockFetch.mockResolvedValue(new Response(`Provider echoed ${apiKey}`, { status: 400 }));

      await expect(
        aiService.callAI({ prompt: `Synthetic ${apiKey}`, config: mockAIConfig({ apiKey }) }),
      ).rejects.toMatchObject({
        code: ErrorCode.API_ERROR,
        message: 'API Bad Request (400): Provider echoed [redacted]',
        details: { response: 'Provider echoed [redacted]' },
      });

      expect(mockLogStore.saveAiLog).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          prompt: 'Synthetic [redacted]',
          response: expect.stringContaining('Provider echoed [redacted]'),
        }),
      );
      expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain(apiKey);
      expect(JSON.stringify(vi.mocked(Logger.debug).mock.calls)).not.toContain(apiKey);
    });

    it('redacts the effective cached key from a streamed connection-test preview', async () => {
      const apiKey = 'cached_test-key.with+$';
      const config = mockAIConfig({ apiKey });
      aiService.rememberVerifiedConfig(config);
      mockSettingsStore.getSettings.mockResolvedValueOnce({ developerMode: true });
      mockFetch.mockResolvedValue(
        createStreamingResponse([
          `data: ${JSON.stringify({ choices: [{ delta: { content: apiKey.slice(0, 10) } }] })}\n\n`,
          `data: ${JSON.stringify({
            choices: [{ delta: { content: apiKey.slice(10) }, finish_reason: 'stop' }],
          })}\n\n`,
          'data: [DONE]\n\n',
        ]),
      );

      const result = await aiService.callAI({
        prompt: 'Connection test',
        config: { ...config, apiKey: '' },
        redactResponse: true,
      });

      expect(result.content).toBe('[redacted]');
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${apiKey}`);
      expect(mockLogStore.saveAiLog).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ response: '[redacted]' }),
      );
    });

    it.each([null, 'length', 'content_filter'])(
      'rejects incomplete streams (%s) without retrying',
      async (finishReason) => {
        mockFetch.mockResolvedValue(
          createStreamingResponse([
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' }, finish_reason: finishReason }] })}\n\n`,
          ]),
        );
        await expect(
          aiService.callAI({ prompt: 'Test', config: mockAIConfig() }),
        ).rejects.toMatchObject({ code: ErrorCode.AI_INVALID_RESPONSE });
        expect(mockFetch).toHaveBeenCalledOnce();
      },
    );

    it('accepts a DONE marker without a finish reason and pretty-printed JSON', async () => {
      mockFetch.mockResolvedValueOnce(
        createStreamingResponse([
          'data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n',
        ]),
      );
      expect((await aiService.callAI({ prompt: 'Test', config: mockAIConfig() })).content).toBe(
        'done',
      );
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            {
              choices: [{ message: { content: 'json' }, finish_reason: 'stop' }],
            },
            null,
            2,
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
      );
      expect((await aiService.callAI({ prompt: 'Test', config: mockAIConfig() })).content).toBe(
        'json',
      );
    });

    it('should make API request with correct parameters', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }],
          usage: { total_tokens: 100 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const config = mockAIConfig({
        apiUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        model: 'gpt-4o-mini',
      });

      const promise = aiService.callAI({
        prompt: 'Test prompt',
        config,
      });

      // Advance timers to allow the request to complete
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-key',
          }),
        }),
      );

      const requestInit = mockFetch.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(requestInit.body as string)).toMatchObject({
        stream: true,
        stream_options: { include_usage: true },
      });

      expect(result.content).toBe('Test response');
      expect(result.tokensUsed).toBe(100);
    });

    it('ignores an old verification epoch without replacing a newer verified credential', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }),
      });
      const config = mockAIConfig({ apiUrl: 'https://api.example.com/v1', apiKey: 'old-key' });
      const oldEpoch = aiService.getVerificationEpoch();
      aiService.clearVerifiedConfig();
      aiService.rememberVerifiedConfig(
        { ...config, apiKey: 'new-key' },
        aiService.getVerificationEpoch(),
      );
      aiService.rememberVerifiedConfig(config, oldEpoch);
      await aiService.callAI({ prompt: 'After stale test', config: { ...config, apiKey: '' } });
      expect((mockFetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer new-key',
      });
    });

    it('should stop using a remembered key after it is explicitly cleared', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
          usage: { total_tokens: 1 },
        }),
      });
      const verifiedConfig = mockAIConfig({
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'remembered-key',
      });
      const configWithoutKey = { ...verifiedConfig, apiKey: '' };
      aiService.rememberVerifiedConfig(verifiedConfig);

      await aiService.callAI({ prompt: 'Before clear', config: configWithoutKey });
      expect((mockFetch.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer remembered-key',
      });

      aiService.clearVerifiedConfig();
      await aiService.callAI({ prompt: 'After clear', config: configWithoutKey });
      expect((mockFetch.mock.calls[1]?.[1] as RequestInit).headers).not.toHaveProperty(
        'Authorization',
      );
    });

    it('should parse streamed chat completion chunks', async () => {
      const streamProgress = vi.fn();
      mockFetch.mockResolvedValue(
        createStreamingResponse([
          'data: {"choices":[{"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
          'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}],"usage":{"total_tokens":42}}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const config = mockAIConfig();

      const result = await aiService.callAI({
        prompt: 'Test prompt',
        config,
        onStreamProgress: streamProgress,
      });

      expect(result).toEqual({
        content: 'Hello world',
        tokensUsed: 42,
        finishReason: 'stop',
      });
      expect(mockTokenStatsStore.recordTokenUsage).toHaveBeenCalledWith(42);
      expect(streamProgress).toHaveBeenCalledWith(
        expect.objectContaining({ chunksReceived: 2, charactersReceived: 'Hello world'.length }),
      );
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should parse JSON response bodies from providers that ignore stream mode', async () => {
      mockFetch.mockResolvedValue(
        createStreamingResponse([
          '{"choices":[{"message":{"content":"JSON response"},"finish_reason":"stop"}],"usage":{"total_tokens":24}}',
        ]),
      );

      const config = mockAIConfig();

      const result = await aiService.callAI({
        prompt: 'Test prompt',
        config,
      });

      expect(result).toEqual({
        content: 'JSON response',
        tokensUsed: 24,
        finishReason: 'stop',
      });
    });

    it('should reject empty model responses instead of returning a blank success', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          createStreamingResponse([
            'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"total_tokens":24}}\n\n',
            'data: [DONE]\n\n',
          ]),
        ),
      );

      const config = mockAIConfig();
      const promise = aiService.callAI({
        prompt: 'Test prompt',
        config,
      });
      const rejection = expect(promise).rejects.toMatchObject({
        code: ErrorCode.AI_INVALID_RESPONSE,
      });

      await vi.runAllTimersAsync();
      await rejection;
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should skip malformed SSE frames without aborting the stream', async () => {
      mockFetch.mockResolvedValue(
        createStreamingResponse([
          'data: {"choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
          'data: {not-json\n\n',
          'data: {"choices":[{"delta":{"content":"world"},"finish_reason":"stop"}],"usage":{"total_tokens":10}}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const config = mockAIConfig();
      const result = await aiService.callAI({ prompt: 'Test', config });

      expect(result.content).toBe('Hello world');
      expect(result.tokensUsed).toBe(10);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should cancel the reader when the stream throws', async () => {
      const cancel = vi.fn().mockResolvedValue(undefined);
      const body = {
        getReader: () => {
          let calls = 0;
          return {
            read: vi.fn().mockImplementation(() => {
              calls += 1;
              if (calls === 1) {
                return Promise.resolve({
                  value: new TextEncoder().encode(
                    'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
                  ),
                  done: false,
                });
              }
              return Promise.reject(new Error('network reset'));
            }),
            cancel,
            releaseLock: vi.fn(),
          };
        },
      };
      mockFetch.mockResolvedValue({ ok: true, body });

      const config = mockAIConfig();
      const promise = aiService.callAI({ prompt: 'Test', config });
      const rejection = expect(promise).rejects.toThrow();
      await vi.runAllTimersAsync();
      await rejection;

      expect(cancel).toHaveBeenCalled();
    });

    it('should append /chat/completions to API URL if missing', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { total_tokens: 50 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const config = mockAIConfig({
        apiUrl: 'https://api.example.com/v1/',
      });

      const promise = aiService.callAI({
        prompt: 'Test',
        config,
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/v1/chat/completions',
        expect.anything(),
      );
    });

    it('should reject insecure remote API URLs before sending credentials', async () => {
      const config = mockAIConfig({
        apiUrl: 'http://api.example.com/v1',
        apiKey: 'must-not-leak',
      });

      await expect(aiService.callAI({ prompt: 'Test', config })).rejects.toMatchObject({
        code: ErrorCode.INVALID_API_URL,
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should allow HTTP for loopback model endpoints', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Local response' }, finish_reason: 'stop' }],
        }),
      });
      const config = mockAIConfig({ apiUrl: 'http://127.0.0.1:11434/v1' });

      const promise = aiService.callAI({ prompt: 'Test', config });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:11434/v1/chat/completions',
        expect.anything(),
      );
    });

    it('should not retry non-retryable bad requests', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: vi.fn().mockResolvedValue('Bad request'),
      });

      const promise = aiService.callAI({ prompt: 'Test', config: mockAIConfig() });
      const rejection = expect(promise).rejects.toMatchObject({ code: ErrorCode.API_ERROR });

      await vi.runAllTimersAsync();
      await rejection;
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle rate limit errors (429)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: vi.fn().mockResolvedValue('Rate limit exceeded'),
      });

      const config = mockAIConfig();

      const promise = aiService.callAI({
        prompt: 'Test',
        config,
      });
      const rejection = expect(promise).rejects.toMatchObject({
        code: ErrorCode.AI_RATE_LIMIT,
      });

      await vi.runAllTimersAsync();
      await rejection;
    });

    it('should handle authentication errors (401)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('Unauthorized'),
      });

      const config = mockAIConfig();

      const promise = aiService.callAI({
        prompt: 'Test',
        config,
      });
      const rejection = expect(promise).rejects.toMatchObject({
        code: ErrorCode.MISSING_API_KEY,
      });

      await vi.runAllTimersAsync();
      await rejection;
    });

    it('should handle model not found errors (404)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: vi.fn().mockResolvedValue('Model not found'),
      });

      const config = mockAIConfig({ model: 'non-existent-model' });

      const promise = aiService.callAI({
        prompt: 'Test',
        config,
      });
      const rejection = expect(promise).rejects.toMatchObject({
        code: ErrorCode.AI_MODEL_NOT_FOUND,
      });

      await vi.runAllTimersAsync();
      await rejection;
    });

    it('should throw error when API URL is missing', async () => {
      const config = mockAIConfig({ apiUrl: '' });

      const promise = aiService.callAI({
        prompt: 'Test',
        config,
      });
      const rejection = expect(promise).rejects.toMatchObject({
        code: ErrorCode.INVALID_API_URL,
      });

      await vi.runAllTimersAsync();
      await rejection;
    });

    it('should throw error when model is missing', async () => {
      const config = mockAIConfig({ model: '' });

      const promise = aiService.callAI({
        prompt: 'Test',
        config,
      });
      const rejection = expect(promise).rejects.toMatchObject({
        code: ErrorCode.INVALID_MODEL,
      });

      await vi.runAllTimersAsync();
      await rejection;
    });

    it('should respect abort signal', async () => {
      const controller = new AbortController();
      controller.abort();

      const config = mockAIConfig();

      const promise = aiService.callAI({
        prompt: 'Test',
        config,
        signal: controller.signal,
      });
      const rejection = expect(promise).rejects.toMatchObject({
        code: ErrorCode.TASK_CANCELLED,
      });

      await vi.runAllTimersAsync();
      await rejection;
    });

    it('should remove think tags from response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: { content: '<think>Internal reasoning</think>Actual response' },
              finish_reason: 'stop',
            },
          ],
          usage: { total_tokens: 100 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const config = mockAIConfig();

      const promise = aiService.callAI({
        prompt: 'Test',
        config,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.content).toBe('Actual response');
    });

    it('does not retry AI timeouts and honors the configured budget once', async () => {
      mockFetch.mockImplementation(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );

      const promise = aiService.callAI({
        prompt: 'hello',
        config: mockAIConfig(),
        timeout: 1000,
      });

      const rejection = expect(promise).rejects.toMatchObject({ code: ErrorCode.AI_TIMEOUT });
      // Advance past the timeout plus what a retry backoff would need; the
      // call must fail exactly once with AI_TIMEOUT and never re-fetch.
      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should record token usage after successful call', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
          usage: { total_tokens: 150 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const config = mockAIConfig();

      const promise = aiService.callAI({
        prompt: 'Test',
        config,
      });

      await vi.runAllTimersAsync();
      await promise;

      expect(mockTokenStatsStore.recordTokenUsage).toHaveBeenCalledWith(150);
    });
  });

  describe('getAvailableModels', () => {
    it('fetches all Anthropic pages with protocol headers and preserves URL parameters', async () => {
      mockFetch.mockResolvedValueOnce(
        Response.json({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' }),
      );
      mockFetch.mockResolvedValueOnce(
        Response.json({ data: [{ id: 'claude-b' }, { id: 'claude-a' }], has_more: false }),
      );
      expect(
        await aiService.getAvailableModels(
          'https://api.anthropic.com/v1/messages?tenant=1',
          'anthropic-key',
          'anthropic-messages',
        ),
      ).toEqual(['claude-a', 'claude-b']);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://api.anthropic.com/v1/models?tenant=1&limit=1000',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'anthropic-key',
            'anthropic-version': '2023-06-01',
          }),
          redirect: 'manual',
        }),
      );
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://api.anthropic.com/v1/models?tenant=1&limit=1000&after_id=claude-a',
      );
      expect(vi.getTimerCount()).toBe(0);
    });

    it('stops malformed pagination without returning a silently partial model list', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          Response.json({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' }),
        ),
      );
      await expect(
        aiService.getAvailableModels('https://api.anthropic.com/v1', 'key', 'anthropic-messages'),
      ).rejects.toMatchObject({
        code: ErrorCode.AI_INVALID_RESPONSE,
        message: expect.stringContaining('pagination cursor'),
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('uses the shared model endpoint for Responses with Bearer authentication', async () => {
      mockFetch.mockResolvedValue(Response.json({ data: [{ id: 'model-a' }] }));
      expect(
        await aiService.getAvailableModels(
          'https://api.example/v1/responses',
          'key',
          'openai-responses',
        ),
      ).toEqual(['model-a']);
      expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
        'https://api.example/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer key' }),
        }),
      );
    });

    it('reports a provider redirect without fetching the redirect target', async () => {
      mockFetch.mockResolvedValue({ type: 'opaqueredirect', status: 0, ok: false });
      await expect(
        aiService.getAvailableModels('https://api.example.com/v1', 'test-key'),
      ).rejects.toMatchObject({ code: ErrorCode.AI_ENDPOINT_REDIRECT, retryable: false });
      expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
        'https://api.example.com/v1/models',
        expect.objectContaining({ method: 'GET', redirect: 'manual' }),
      );
    });

    it('does not log a request credential echoed in a model-list parse failure', async () => {
      const apiKey = 'fixture_key.short+1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError(`Invalid JSON: ${apiKey}`)),
      });

      await expect(
        aiService.getAvailableModels('https://api.example.com/v1', apiKey),
      ).rejects.toMatchObject({
        code: ErrorCode.AI_INVALID_RESPONSE,
        message: 'Failed to fetch available models: Invalid JSON: [redacted]',
      });
      expect(vi.mocked(Logger.error)).toHaveBeenCalledWith('[AIService] Failed to get models', {
        message: 'Invalid JSON: [redacted]',
      });
    });

    it('should fetch models from API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }, { id: 'gpt-4o-mini' }],
        }),
      });

      const models = await aiService.getAvailableModels(
        'https://api.openai.com/v1',
        'test-api-key',
      );

      expect(models).toContain('gpt-4');
      expect(models).toContain('gpt-3.5-turbo');
      expect(models).toContain('gpt-4o-mini');
    });

    it('reports API errors with sanitized diagnostics', async () => {
      mockFetch.mockResolvedValue(new Response('Server rejected test-api-key', { status: 500 }));
      await expect(
        aiService.getAvailableModels('https://api.openai.com/v1', 'test-api-key'),
      ).rejects.toMatchObject({
        code: ErrorCode.API_ERROR,
        message: 'API error (500): Server rejected [redacted]',
        details: { response: 'Server rejected [redacted]' },
      });
    });

    it('reports network errors instead of an empty catalogue', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      await expect(
        aiService.getAvailableModels('https://api.openai.com/v1', 'test-api-key'),
      ).rejects.toMatchObject({
        code: ErrorCode.API_ERROR,
        message: 'Failed to fetch available models: Network error',
      });
    });

    it('reports authentication failures explicitly', async () => {
      mockFetch.mockResolvedValue(new Response('Unauthorized key', { status: 401 }));
      await expect(
        aiService.getAvailableModels('https://api.example/v1', 'key'),
      ).rejects.toMatchObject({ code: ErrorCode.MISSING_API_KEY });
    });

    it('reports an invalid URL without sending credentials', async () => {
      await expect(
        aiService.getAvailableModels('http://remote.example/v1', 'key'),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_API_URL });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each([{}, { data: 'invalid' }, { data: [{}] }, null])(
      'rejects malformed model listings (%j)',
      async (body) => {
        mockFetch.mockResolvedValue(Response.json(body));
        await expect(
          aiService.getAvailableModels('https://api.example/v1', 'key'),
        ).rejects.toMatchObject({ code: ErrorCode.AI_INVALID_RESPONSE });
      },
    );

    it('allows a genuinely empty model list', async () => {
      mockFetch.mockResolvedValue(Response.json({ data: [] }));
      await expect(aiService.getAvailableModels('https://api.example/v1', 'key')).resolves.toEqual(
        [],
      );
    });

    it('reports model discovery timeouts and clears its timer', async () => {
      mockFetch.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      );
      const failure = expect(
        aiService.getAvailableModels('https://api.example/v1', 'key'),
      ).rejects.toMatchObject({
        code: ErrorCode.AI_TIMEOUT,
        message: expect.stringContaining('timed out'),
      });
      await vi.advanceTimersByTimeAsync(TIMEOUT.AVAILABLE_MODELS_FETCH_MS);
      await failure;
      expect(vi.getTimerCount()).toBe(0);
    });

    it('should strip trailing slash and /chat/completions from URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [{ id: 'model-1' }],
        }),
      });

      await aiService.getAvailableModels('https://api.example.com/v1/chat/completions', 'test-key');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/v1/models',
        expect.anything(),
      );
    });
  });

  describe('analyzeComments', () => {
    it('should analyze comments and return structured result', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: `# Analysis Report
                
| Sentiment | Percentage |
|-----------|------------|
| Positive | 60% |
| Negative | 20% |
| Neutral | 20% |

## Key Insights
- Users are generally satisfied`,
              },
              finish_reason: 'stop',
            },
          ],
          usage: { total_tokens: 500 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const comments = mockComments(5);
      const config = mockAIConfig();

      const promise = commentAnalyzer.analyzeComments(comments, config, 'Analyze these comments');

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.markdown).toContain('Analysis Report');
      expect(result.summary).toBeUndefined();
      expect(result.tokensUsed).toBe(500);
      expect(result.generatedAt).toBeDefined();
    });

    it('should fail rather than persist a partial report when any batch fails', async () => {
      const callSpy = vi
        .spyOn(aiService, 'callAI')
        .mockRejectedValueOnce(new Error('batch failed'))
        .mockResolvedValue({ content: 'Successful batch', tokensUsed: 10, finishReason: 'stop' });
      const comments = mockComments(4, { content: 'word '.repeat(1000) });
      const config = mockAIConfig({ contextWindowSize: 6000, maxOutputTokens: 1 });

      await expect(
        commentAnalyzer.analyzeComments(comments, config, 'Analyze'),
      ).rejects.toMatchObject({
        code: ErrorCode.AI_INVALID_RESPONSE,
        message: expect.stringContaining('1 analysis batch'),
      });
      expect(callSpy.mock.calls.length).toBeGreaterThan(1);
    });

    it('should handle empty comments array', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [
            {
              message: { content: 'No comments to analyze' },
              finish_reason: 'stop',
            },
          ],
          usage: { total_tokens: 50 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const config = mockAIConfig();

      const promise = commentAnalyzer.analyzeComments([], config, 'Analyze');

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.markdown).toBe('No comments to analyze');
    });

    it('should reject model budgets that leave no safe input context', async () => {
      const config = mockAIConfig({ contextWindowSize: 4096, maxOutputTokens: 2000 });

      await expect(
        commentAnalyzer.analyzeComments([mockComment()], config, 'Analyze'),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CONFIG });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should analyze a single oversized comment after truncating content to fit context', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Analysis' }, finish_reason: 'stop' }],
          usage: { total_tokens: 100 },
        }),
      });

      const config = mockAIConfig({ contextWindowSize: 4096, maxOutputTokens: 1 });
      const oversizedContent = 'x'.repeat(5000);
      const comments = [
        mockComment({
          id: 'oversized-content',
          content: oversizedContent,
          replies: [],
        }),
      ];

      const promise = commentAnalyzer.analyzeComments(comments, config, 'Analyze');

      await vi.runAllTimersAsync();
      const result = await promise;

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      const userMessage = body.messages.find(
        (message: { role: string }) => message.role === 'user',
      );
      expect(userMessage.content).toContain(TEXT.TRUNCATED_SUFFIX);
      expect(userMessage.content).not.toContain(oversizedContent);
      expect(result.markdown).toBe('Analysis');
    });

    it('should reject when every comment is too large to fit after truncation', async () => {
      const config = mockAIConfig({ contextWindowSize: 4096, maxOutputTokens: 1 });
      const comments = [
        mockComment({
          id: 'oversized-metadata',
          content: 'root',
          replies: mockComments(300, { content: 'reply content '.repeat(20) }),
        }),
      ];

      await expect(
        commentAnalyzer.analyzeComments(comments, config, 'Analyze'),
      ).rejects.toMatchObject({
        code: ErrorCode.AI_INVALID_RESPONSE,
        message: TEXT.NO_ANALYZABLE_COMMENTS,
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects mixed input before calling AI instead of silently dropping a thread', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Analysis' }, finish_reason: 'stop' }],
          usage: { total_tokens: 100 },
        }),
      });

      const config = mockAIConfig({ contextWindowSize: 4096, maxOutputTokens: 1 });
      const skippedComment = mockComment({
        id: 'oversized-metadata',
        content: 'root',
        replies: mockComments(300, { content: 'reply content '.repeat(20) }),
      });
      const keptComment = mockComment({ id: 'kept-comment', content: 'small comment' });

      await expect(
        commentAnalyzer.analyzeComments([skippedComment, keptComment], config, 'Analyze'),
      ).rejects.toMatchObject({ code: ErrorCode.AI_INVALID_RESPONSE });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should pass metadata to prompt', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Analysis' }, finish_reason: 'stop' }],
          usage: { total_tokens: 100 },
        }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const comments = mockComments(3);
      const config = mockAIConfig();
      const metadata = {
        platform: 'YouTube',
        url: 'https://youtube.com/watch?v=123',
        title: 'Test Video',
      };

      const promise = commentAnalyzer.analyzeComments(
        comments,
        config,
        'Analyze {platform} comments from {url} titled {title}',
        'en-US',
        metadata,
      );

      await vi.runAllTimersAsync();
      await promise;

      // Verify fetch was called with body containing metadata info in the prompt
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      const userMessage = body.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage.content).toContain('YouTube');
      expect(userMessage.content).toContain('https://youtube.com/watch?v=123');
      expect(userMessage.content).toContain('Test Video');
    });

    it('should respect abort signal during analysis', async () => {
      const controller = new AbortController();
      controller.abort();

      const comments = mockComments(5);
      const config = mockAIConfig();

      const promise = commentAnalyzer.analyzeComments(
        comments,
        config,
        'Analyze',
        'en-US',
        undefined,
        controller.signal,
      );
      const rejection = expect(promise).rejects.toMatchObject({
        code: ErrorCode.TASK_CANCELLED,
      });

      await vi.runAllTimersAsync();
      await rejection;
    });

    it('should report analysis progress while streaming model output', async () => {
      mockFetch.mockResolvedValue(
        createStreamingResponse([
          `data: ${JSON.stringify({ choices: [{ delta: { content: '# Analysis Report\n' }, finish_reason: null }] })}\n\n`,
          'data: {"choices":[{"delta":{"content":"streaming body"},"finish_reason":"stop"}],"usage":{"total_tokens":50}}\n\n',
          'data: [DONE]\n\n',
        ]),
      );

      const comments = mockComments(2);
      const config = mockAIConfig();
      const progress = vi.fn();

      await commentAnalyzer.analyzeComments(
        comments,
        config,
        'Analyze these comments',
        'en-US',
        undefined,
        undefined,
        undefined,
        progress,
      );

      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({
          stageMessage: AI.ANALYSIS_PROGRESS_MESSAGES.WAITING,
          stageMessageKey: AI.ANALYSIS_PROGRESS_MESSAGE_KEYS.WAITING,
        }),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({
          stageMessage: expect.stringContaining('receiving model response'),
          stageMessageKey: AI.ANALYSIS_PROGRESS_MESSAGE_KEYS.RECEIVING,
          stageMessageParams: expect.objectContaining({ characters: expect.any(Number) }),
        }),
      );
      expect(progress).toHaveBeenLastCalledWith(
        expect.objectContaining({
          stageMessage: AI.ANALYSIS_PROGRESS_MESSAGES.COMPLETE,
          stageMessageKey: AI.ANALYSIS_PROGRESS_MESSAGE_KEYS.COMPLETE,
        }),
      );
    });
  });
});
