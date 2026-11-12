import { AIConfig, AIProtocol, AIRequest, AIResponse } from '../types';

import { Logger } from '../utils/logger';
import { ErrorHandler, createAIError, ErrorCode, ExtensionError } from '../utils/errors';
import { AI as AI_CONST, RETRY, TEXT, TIMEOUT, SECURITY } from '@/config/constants';
import type { SettingsStore } from './storage/SettingsStore';
import type { LogStore } from './storage/LogStore';
import type { TokenStatsStore } from './storage/TokenStatsStore';
import { buildAiRequestUrl, buildAiModelsUrl, normalizeAiApiUrl } from '@/utils/url';
import { redactApiKey } from '@/utils/log-sanitize';

import { AIErrorHandler } from './ai/AIErrorHandler';
import { DataNormalizer } from './ai/DataNormalizer';
import { buildAIHeaders, buildAIRequest, readAIResponse } from './ai/ProtocolAdapter';

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

async function fetchAiEndpoint(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: 'manual' });
  if (response.type === 'opaqueredirect' || REDIRECT_STATUS_CODES.has(response.status)) {
    throw createAIError(
      ErrorCode.AI_ENDPOINT_REDIRECT,
      'The AI endpoint redirected the request. Enter its final API URL in Settings.',
      { messageKey: 'errors.aiEndpointRedirect' },
      false,
    );
  }
  return response;
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

    const currentApiUrl = normalizeAiApiUrl(config.apiUrl);
    const fallbackApiUrl = normalizeAiApiUrl(this.lastVerifiedConfig.apiUrl);
    if (
      !currentApiUrl ||
      currentApiUrl !== fallbackApiUrl ||
      (config.protocol ?? AI_CONST.DEFAULT_PROTOCOL) !==
        (this.lastVerifiedConfig.protocol ?? AI_CONST.DEFAULT_PROTOCOL)
    ) {
      return config;
    }

    if (
      typeof this.lastVerifiedConfig.apiKey !== 'string' ||
      this.lastVerifiedConfig.apiKey.trim().length === 0
    ) {
      return config;
    }

    Logger.warn('[AIService] Falling back to last verified API key');

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
    const apiUrl = buildAiRequestUrl(config.apiUrl, config.protocol ?? AI_CONST.DEFAULT_PROTOCOL);
    if (!apiUrl) {
      throw createAIError(
        ErrorCode.INVALID_API_URL,
        'AI API URL must use HTTPS, except for loopback development endpoints',
      );
    }
    return apiUrl;
  }

  async callAI(request: AIRequest & { redactResponse?: boolean }): Promise<AIResponse> {
    const { prompt, systemPrompt, config, signal, timeout, onStreamProgress, redactResponse } =
      request;
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

          let activeKey = '';
          try {
            if (retryController.signal.aborted) {
              throw createAIError(ErrorCode.TASK_CANCELLED, 'Request aborted', {});
            }

            const resolvedConfig = this.resolveConfigForCall(config);
            activeKey =
              typeof resolvedConfig.apiKey === 'string' ? resolvedConfig.apiKey.trim() : '';
            const apiUrl = this.validateAndBuildUrl(resolvedConfig);
            const safeUrl = redactApiKey(apiUrl, activeKey);
            const safeModel = redactApiKey(resolvedConfig.model, activeKey);

            Logger.info('[AIService] Calling AI API', {
              url: safeUrl,
              model: safeModel,
              promptLength: prompt.length,
              timeout: effectiveTimeout,
              hasApiKey: Boolean(activeKey),
            });

            const protocol = resolvedConfig.protocol ?? AI_CONST.DEFAULT_PROTOCOL;
            const headers = buildAIHeaders(protocol, activeKey);
            const requestBody = buildAIRequest(prompt, systemPrompt, resolvedConfig);

            const response = await fetchAiEndpoint(apiUrl, {
              method: 'POST',
              headers,
              body: requestBody,
              signal: retryController.signal,
            });

            if (!response.ok) {
              const errorText = await response.text();
              Logger.warn('[AIService] API responded with non-OK status', {
                status: response.status,
                model: safeModel,
                url: safeUrl,
              });
              AIErrorHandler.classifyHTTPError(
                response.status,
                errorText,
                resolvedConfig.model,
                activeKey,
              );
            }

            resetTimeout();

            const streamResult = await readAIResponse(
              response,
              protocol,
              activeKey,
              resetTimeout,
              onStreamProgress &&
                ((progress) => {
                  const finishReason = progress.finishReason;
                  onStreamProgress({
                    ...progress,
                    finishReason: finishReason && redactApiKey(finishReason, activeKey),
                  });
                }),
            );

            let content = streamResult.content;
            const tokensUsed = streamResult.tokensUsed;
            const finishReason = streamResult.finishReason;
            if (finishReason !== 'stop' && finishReason !== AI_CONST.STREAM.UNKNOWN_FINISH_REASON) {
              const safeFinishReason = redactApiKey(finishReason, activeKey);
              throw createAIError(
                ErrorCode.AI_INVALID_RESPONSE,
                `Model output is incomplete (${safeFinishReason})`,
                { finishReason: safeFinishReason },
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
              activeKey,
            ).catch((e) => Logger.warn('Failed to log to file', { error: e }));

            return {
              content: redactResponse ? redactApiKey(content, activeKey) : content,
              tokensUsed,
              finishReason,
            };
          } catch (error) {
            AIErrorHandler.classifyCallError(
              this.settingsStore,
              this.logStore,
              error,
              signal,
              effectiveTimeout,
              prompt,
              activeKey,
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

  async getAvailableModels(
    apiUrl: string,
    apiKey: string,
    protocol: AIProtocol = AI_CONST.DEFAULT_PROTOCOL,
  ): Promise<string[]> {
    const modelsUrl = buildAiModelsUrl(typeof apiUrl === 'string' ? apiUrl : '');
    if (!modelsUrl) {
      throw createAIError(
        ErrorCode.INVALID_API_URL,
        'AI API URL must use HTTPS, except for loopback development endpoints',
        {},
        false,
      );
    }

    const activeKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    Logger.info('[AIService] Fetching available models', {
      url: redactApiKey(modelsUrl, activeKey),
    });
    const headers = buildAIHeaders(protocol, activeKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT.AVAILABLE_MODELS_FETCH_MS);

    try {
      const url = new URL(modelsUrl);
      const models = new Set<string>();
      const cursors = new Set<string>();
      if (protocol === 'anthropic-messages') url.searchParams.set('limit', '1000');
      while (true) {
        const response = await fetchAiEndpoint(url.toString(), {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          const errorText = await response.text();
          if (response.status === 404) {
            throw createAIError(
              ErrorCode.API_ERROR,
              'Model listing endpoint was not found (404)',
              { status: 404 },
              false,
            );
          }
          AIErrorHandler.classifyHTTPError(response.status, errorText, '', activeKey);
        }
        const data = (await response.json()) as {
          data?: Array<{ id?: unknown }>;
          has_more?: boolean;
          last_id?: unknown;
        };
        if (!data || !Array.isArray(data.data)) {
          throw createAIError(
            ErrorCode.AI_INVALID_RESPONSE,
            'Model listing response must contain a data array',
            {},
            false,
          );
        }
        for (const model of data.data) {
          if (typeof model?.id !== 'string' || !model.id.trim()) {
            throw createAIError(
              ErrorCode.AI_INVALID_RESPONSE,
              'Model listing response contains an invalid model ID',
              {},
              false,
            );
          }
          models.add(model.id);
        }
        if (protocol !== 'anthropic-messages' || !data.has_more) break;
        if (typeof data.last_id !== 'string' || !data.last_id || cursors.has(data.last_id)) {
          throw createAIError(
            ErrorCode.AI_INVALID_RESPONSE,
            'Model listing returned an invalid or repeated pagination cursor',
            {},
            false,
          );
        }
        cursors.add(data.last_id);
        url.searchParams.set('after_id', data.last_id);
      }
      Logger.info('[AIService] Available models fetched', { count: models.size });
      return [...models];
    } catch (error) {
      if (error instanceof ExtensionError) {
        throw error;
      }
      if ((error as { name?: string })?.name === 'AbortError') {
        throw createAIError(
          ErrorCode.AI_TIMEOUT,
          `Fetching available models timed out after ${TIMEOUT.AVAILABLE_MODELS_FETCH_MS}ms`,
          {},
          false,
        );
      }
      const message = redactApiKey(
        error instanceof Error ? error.message : String(error),
        activeKey,
      );
      Logger.error('[AIService] Failed to get models', {
        message,
      });
      throw createAIError(
        error instanceof SyntaxError ? ErrorCode.AI_INVALID_RESPONSE : ErrorCode.API_ERROR,
        `Failed to fetch available models: ${message}`,
        {},
        false,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
