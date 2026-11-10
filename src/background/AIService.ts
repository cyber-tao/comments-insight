import { AIConfig, AIRequest, AIResponse, AIStreamProgress } from '../types';

import { Logger } from '../utils/logger';
import { ErrorHandler, createAIError, ErrorCode } from '../utils/errors';
import {
  AI as AI_CONST,
  RETRY,
  TEXT,
  API as API_CONST,
  TIMEOUT,
  SECURITY,
} from '@/config/constants';
import type { SettingsStore } from './storage/SettingsStore';
import type { LogStore } from './storage/LogStore';
import type { TokenStatsStore } from './storage/TokenStatsStore';
import { buildAiChatCompletionsUrl, parseAllowedAiApiUrl } from '@/utils/url';

import { AIErrorHandler } from './ai/AIErrorHandler';
import { DataNormalizer } from './ai/DataNormalizer';

interface ChatCompletionData {
  choices?: Array<{
    message?: { content?: string };
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
  usage?: { total_tokens?: number };
}

interface StreamingAIResult {
  content: string;
  tokensUsed: number;
  finishReason: string;
}

export class AIService {
  private lastVerifiedConfig: AIConfig | null = null;
  private lastVerifiedConfigTimestamp: number = 0;
  private verificationEpoch = 0;

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly logStore: LogStore,
    private readonly tokenStatsStore: TokenStatsStore,
  ) {}

  getVerificationEpoch(): number {
    return this.verificationEpoch;
  }

  rememberVerifiedConfig(config: AIConfig, expectedEpoch = this.verificationEpoch): void {
    if (
      expectedEpoch !== this.verificationEpoch ||
      typeof config.apiKey !== 'string' ||
      config.apiKey.trim().length === 0 ||
      !config.apiUrl ||
      !config.model
    ) {
      return;
    }
    this.lastVerifiedConfig = { ...config };
    this.lastVerifiedConfigTimestamp = Date.now();
  }

  clearVerifiedConfig(): void {
    this.verificationEpoch += 1;
    this.lastVerifiedConfig = null;
    this.lastVerifiedConfigTimestamp = 0;
  }

  private isLastVerifiedConfigExpired(): boolean {
    if (!this.lastVerifiedConfigTimestamp) {
      return true;
    }
    const elapsed = Date.now() - this.lastVerifiedConfigTimestamp;
    return elapsed > SECURITY.API_KEY_MEMORY_TTL_MS;
  }

  private clearExpiredVerifiedConfig(): void {
    if (this.lastVerifiedConfig && this.isLastVerifiedConfigExpired()) {
      this.clearVerifiedConfig();
      Logger.debug('[AIService] Cleared expired lastVerifiedConfig');
    }
  }

  private resolveConfigForCall(config: AIConfig): AIConfig {
    if (typeof config.apiKey === 'string' && config.apiKey.trim().length > 0) {
      return config;
    }

    this.clearExpiredVerifiedConfig();

    if (!this.lastVerifiedConfig) {
      return config;
    }

    const currentApiUrl = config.apiUrl.trim();
    const fallbackApiUrl = this.lastVerifiedConfig.apiUrl.trim();
    if (!currentApiUrl || currentApiUrl !== fallbackApiUrl) {
      return config;
    }

    if (
      typeof this.lastVerifiedConfig.apiKey !== 'string' ||
      this.lastVerifiedConfig.apiKey.trim().length === 0
    ) {
      return config;
    }

    Logger.warn('[AIService] Falling back to last verified API key', {
      model: config.model,
      apiUrl: currentApiUrl,
    });

    return {
      ...config,
      apiKey: this.lastVerifiedConfig.apiKey,
    };
  }

  private validateAndBuildUrl(config: AIConfig): string {
    if (!config.apiUrl) {
      throw createAIError(ErrorCode.INVALID_API_URL, 'API URL is required', {
        hasUrl: !!config.apiUrl,
      });
    }
    if (!config.model) {
      throw createAIError(ErrorCode.INVALID_MODEL, 'Model is required', {
        hasModel: !!config.model,
      });
    }
    const apiUrl = buildAiChatCompletionsUrl(config.apiUrl);
    if (!apiUrl) {
      throw createAIError(
        ErrorCode.INVALID_API_URL,
        'AI API URL must use HTTPS, except for loopback development endpoints',
        { apiUrl: config.apiUrl },
      );
    }
    return apiUrl;
  }

  private buildChatCompletionRequest(
    prompt: string,
    systemPrompt: string | undefined,
    config: AIConfig,
  ): string {
    return JSON.stringify({
      model: config.model,
      messages: [
        ...(systemPrompt ? [{ role: AI_CONST.ROLES.SYSTEM, content: systemPrompt }] : []),
        { role: AI_CONST.ROLES.USER, content: prompt },
      ],
      max_tokens: config.maxOutputTokens || AI_CONST.DEFAULT_MAX_OUTPUT_TOKENS,
      temperature: config.temperature,
      top_p: config.topP,
      stream: true,
      stream_options: { include_usage: true },
    });
  }

  private async readAIResponse(
    response: Response,
    onStreamActivity: () => void,
    onStreamProgress?: (progress: AIStreamProgress) => void,
  ): Promise<StreamingAIResult> {
    if (!response.body || response.headers?.get('content-type')?.includes('application/json')) {
      const data = (await response.json()) as ChatCompletionData;
      const result = this.parseChatCompletionData(data);
      onStreamProgress?.({
        chunksReceived: result.content ? 1 : 0,
        charactersReceived: result.content.length,
        finishReason: result.finishReason,
      });
      return result;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let tokensUsed = 0;
    let finishReason = AI_CONST.STREAM.UNKNOWN_FINISH_REASON;
    let streamDone = false;
    let chunksReceived = 0;

    const emitProgress = (): void => {
      onStreamProgress?.({
        chunksReceived,
        charactersReceived: content.length,
        finishReason,
      });
    };

    const consumeLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed || streamDone) {
        return;
      }

      const payload = trimmed.startsWith(AI_CONST.STREAM.DATA_PREFIX)
        ? trimmed.slice(AI_CONST.STREAM.DATA_PREFIX.length).trim()
        : trimmed;
      if (!payload || payload === AI_CONST.STREAM.DONE_MARKER) {
        streamDone = payload === AI_CONST.STREAM.DONE_MARKER;
        return;
      }
      if (!payload.startsWith(AI_CONST.STREAM.JSON_START)) {
        return;
      }

      let chunk: ChatCompletionData;
      try {
        chunk = JSON.parse(payload) as ChatCompletionData;
      } catch (parseError) {
        Logger.warn('[AIService] Skipped malformed SSE frame', {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          previewLength: payload.length,
        });
        return;
      }
      const choice = chunk.choices?.[0];
      const deltaContent = choice?.delta?.content;
      const messageContent = choice?.message?.content;
      if (deltaContent) {
        content += deltaContent;
        chunksReceived += 1;
        emitProgress();
      } else if (messageContent) {
        content += messageContent;
        chunksReceived += 1;
        emitProgress();
      }
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
        emitProgress();
      }
      if (typeof chunk.usage?.total_tokens === 'number') {
        tokensUsed = chunk.usage.total_tokens;
      }
    };

    try {
      while (!streamDone) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        onStreamActivity();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          consumeLine(line);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        consumeLine(buffer);
      }
      if (!streamDone && finishReason === AI_CONST.STREAM.UNKNOWN_FINISH_REASON) {
        throw createAIError(
          ErrorCode.AI_INVALID_RESPONSE,
          'Model stream ended before completion',
          {},
          false,
        );
      }
    } catch (streamError) {
      try {
        await reader.cancel();
      } catch (cancelError) {
        Logger.warn('[AIService] Failed to cancel SSE reader after error', {
          error: cancelError instanceof Error ? cancelError.message : String(cancelError),
        });
      }
      throw streamError;
    } finally {
      if (streamDone) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }

    return { content, tokensUsed, finishReason };
  }

  private parseChatCompletionData(data: ChatCompletionData): StreamingAIResult {
    return {
      content: data.choices?.[0]?.message?.content || '',
      tokensUsed: data.usage?.total_tokens || 0,
      finishReason: data.choices?.[0]?.finish_reason || AI_CONST.STREAM.UNKNOWN_FINISH_REASON,
    };
  }

  async callAI(request: AIRequest): Promise<AIResponse> {
    const { prompt, systemPrompt, config, signal, timeout, onStreamProgress } = request;
    const effectiveTimeout = timeout || AI_CONST.DEFAULT_TIMEOUT;

    if (signal?.aborted) {
      throw createAIError(ErrorCode.TASK_CANCELLED, 'Request aborted', {});
    }

    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort();

    if (signal) {
      signal.addEventListener('abort', onParentAbort);
    }

    try {
      return await ErrorHandler.withRetry(
        async () => {
          const retryController = new AbortController();
          const onAbort = (): void => retryController.abort();
          controller.signal.addEventListener('abort', onAbort);

          if (controller.signal.aborted) {
            retryController.abort();
          }

          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          const resetTimeout = (): void => {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(() => {
              retryController.abort(new Error('Timeout'));
            }, effectiveTimeout);
          };

          timeoutId = setTimeout(() => {
            retryController.abort(new Error('Timeout'));
          }, effectiveTimeout);

          try {
            if (retryController.signal.aborted) {
              throw createAIError(ErrorCode.TASK_CANCELLED, 'Request aborted', {});
            }

            const resolvedConfig = this.resolveConfigForCall(config);
            const apiUrl = this.validateAndBuildUrl(resolvedConfig);
            const resolvedKey =
              typeof resolvedConfig.apiKey === 'string' ? resolvedConfig.apiKey : '';
            const hasApiKey = resolvedKey.trim().length > 0;

            Logger.info('[AIService] Calling AI API', {
              url: apiUrl,
              model: resolvedConfig.model,
              promptLength: prompt.length,
              timeout: effectiveTimeout,
              hasApiKey,
            });

            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };

            if (hasApiKey) {
              headers.Authorization = `Bearer ${resolvedConfig.apiKey}`;
            }

            const requestBody = this.buildChatCompletionRequest(
              prompt,
              systemPrompt,
              resolvedConfig,
            );

            const response = await fetch(apiUrl, {
              method: 'POST',
              headers,
              body: requestBody,
              signal: retryController.signal,
            });

            if (!response.ok) {
              const errorText = await response.text();
              Logger.warn('[AIService] API responded with non-OK status', {
                status: response.status,
                model: resolvedConfig.model,
                url: apiUrl,
              });
              AIErrorHandler.classifyHTTPError(response.status, errorText, resolvedConfig.model);
            }

            resetTimeout();

            const streamResult = await this.readAIResponse(
              response,
              resetTimeout,
              onStreamProgress,
            );

            let content = streamResult.content;
            const tokensUsed = streamResult.tokensUsed;
            const finishReason = streamResult.finishReason;
            if (finishReason !== 'stop' && finishReason !== AI_CONST.STREAM.UNKNOWN_FINISH_REASON) {
              throw createAIError(
                ErrorCode.AI_INVALID_RESPONSE,
                `Model output is incomplete (${finishReason})`,
                { finishReason },
                false,
              );
            }

            content = DataNormalizer.removeThinkTags(content);

            if (!content.trim()) {
              Logger.warn('[AIService] AI response content is empty', {
                tokensUsed,
                finishReason,
              });
              throw createAIError(
                ErrorCode.AI_INVALID_RESPONSE,
                TEXT.NO_RESPONSE_FROM_MODEL,
                { tokensUsed, finishReason },
                true,
              );
            }

            Logger.info('[AIService] AI response received', {
              tokensUsed,
              finishReason,
              contentLength: content.length,
            });

            this.tokenStatsStore.recordTokenUsage(tokensUsed).catch((err: unknown) => {
              Logger.warn('[AIService] Failed to record tokens', { err });
            });

            AIErrorHandler.logToFile(
              this.logStore,
              AIErrorHandler.determineLogType(prompt),
              {
                prompt,
                response: content,
                timestamp: Date.now(),
              },
              this.settingsStore,
            ).catch((e) => Logger.warn('Failed to log to file', { error: e }));

            return { content, tokensUsed, finishReason };
          } catch (error) {
            AIErrorHandler.classifyCallError(
              this.settingsStore,
              this.logStore,
              error,
              signal,
              effectiveTimeout,
              prompt,
            );
            throw error;
          } finally {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            controller.signal.removeEventListener('abort', onAbort);
          }
        },
        'AIService.callAI',
        {
          maxAttempts: RETRY.MAX_ATTEMPTS,
          initialDelay: RETRY.INITIAL_DELAY_MS,
          abortSignal: signal,
        },
      );
    } finally {
      if (signal) signal.removeEventListener('abort', onParentAbort);
    }
  }

  async getAvailableModels(apiUrl: string, apiKey: string): Promise<string[]> {
    const trimmedUrl = typeof apiUrl === 'string' ? apiUrl.trim() : '';
    if (!trimmedUrl) {
      Logger.warn('[AIService] getAvailableModels called without API URL');
      return [];
    }

    // Validate the URL up-front so we never issue a request to a malformed
    // origin and never block on DNS for arbitrary user input.
    const parsedUrl = parseAllowedAiApiUrl(trimmedUrl);
    if (!parsedUrl) {
      Logger.warn('[AIService] Invalid or insecure API URL for models lookup');
      return [];
    }

    let pathname = parsedUrl.pathname.replace(/\/$/, '');
    if (pathname.endsWith(API_CONST.ENDPOINTS.CHAT_COMPLETIONS)) {
      pathname = pathname.slice(0, -API_CONST.ENDPOINTS.CHAT_COMPLETIONS.length);
    }
    parsedUrl.pathname = `${pathname}${API_CONST.ENDPOINTS.MODELS}`;
    parsedUrl.hash = '';
    const modelsUrl = parsedUrl.toString();
    Logger.info('[AIService] Fetching available models', { url: modelsUrl });

    const headers: Record<string, string> = {};
    if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT.AVAILABLE_MODELS_FETCH_MS);

    try {
      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        Logger.warn('[AIService] Failed to fetch models', {
          status: response.status,
        });
        return [];
      }

      const data = (await response.json()) as { data?: Array<{ id: string }> };
      const models = data.data?.map((model) => model.id) || [];
      Logger.info('[AIService] Available models fetched', { count: models.length });
      return models;
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') {
        Logger.warn('[AIService] Models fetch aborted by timeout', {
          timeoutMs: TIMEOUT.AVAILABLE_MODELS_FETCH_MS,
        });
        return [];
      }
      Logger.error('[AIService] Failed to get models', { error });
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
