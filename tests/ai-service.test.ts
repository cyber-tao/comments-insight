import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIService } from '../src/background/AIService';
import { mockAIConfig, mockComments } from './fixtures';
import { ErrorCode } from '../src/utils/errors';
import { AI } from '../src/config/constants';

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

// Mock StorageManager
const mockStorageManager = {
  getSettings: vi.fn().mockResolvedValue({ developerMode: false }),
  saveAiLog: vi.fn().mockResolvedValue(undefined),
  recordTokenUsage: vi.fn().mockResolvedValue(undefined),
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    aiService = new AIService(
      mockStorageManager as unknown as ConstructorParameters<typeof AIService>[0],
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('callAI', () => {
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
      expect(JSON.parse(requestInit.body as string)).toMatchObject({ stream: true });

      expect(result.content).toBe('Test response');
      expect(result.tokensUsed).toBe(100);
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
      expect(mockStorageManager.recordTokenUsage).toHaveBeenCalledWith(42);
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

      expect(mockStorageManager.recordTokenUsage).toHaveBeenCalledWith(150);
    });
  });

  describe('getAvailableModels', () => {
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

    it('should return empty array on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const models = await aiService.getAvailableModels(
        'https://api.openai.com/v1',
        'test-api-key',
      );

      expect(models.length).toBe(0);
    });

    it('should return empty array on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const models = await aiService.getAvailableModels(
        'https://api.openai.com/v1',
        'test-api-key',
      );

      expect(models.length).toBe(0);
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

      const promise = aiService.analyzeComments(comments, config, 'Analyze these comments');

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.markdown).toContain('Analysis Report');
      expect(result.summary.totalComments).toBe(5);
      expect(result.summary.sentimentDistribution.positive).toBe(60);
      expect(result.tokensUsed).toBe(500);
      expect(result.generatedAt).toBeDefined();
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

      const promise = aiService.analyzeComments([], config, 'Analyze');

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.summary.totalComments).toBe(0);
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

      const promise = aiService.analyzeComments(
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

      const promise = aiService.analyzeComments(
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

      await aiService.analyzeComments(
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
