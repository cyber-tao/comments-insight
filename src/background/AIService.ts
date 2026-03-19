import { AIConfig, AIRequest, AIResponse, Comment, AnalysisResult } from '../types';
import { buildTimestampNormalizationPrompt } from '../utils/prompts';
import { Logger } from '../utils/logger';
import { ErrorHandler, createAIError, ErrorCode } from '../utils/errors';
import {
  AI as AI_CONST,
  RETRY,
  LANGUAGES,
  TIME_NORMALIZATION,
  TEXT,
  ANALYSIS_FORMAT,
  API as API_CONST,
} from '@/config/constants';
import type { StorageManager } from './StorageManager';
import { Tokenizer } from '../utils/tokenizer';
import { runWithConcurrencyLimit } from '../utils/promise';

import { AIErrorHandler } from './ai/AIErrorHandler';
import { DataNormalizer } from './ai/DataNormalizer';
import { PromptBuilder } from './ai/PromptBuilder';

export class AIService {
  private lastVerifiedConfig: AIConfig | null = null;

  constructor(private readonly storageManager: StorageManager) {}

  rememberVerifiedConfig(config: AIConfig): void {
    if (
      typeof config.apiKey !== 'string' ||
      config.apiKey.trim().length === 0 ||
      !config.apiUrl ||
      !config.model
    ) {
      return;
    }
    this.lastVerifiedConfig = { ...config };
  }

  private resolveConfigForCall(config: AIConfig): AIConfig {
    if (typeof config.apiKey === 'string' && config.apiKey.trim().length > 0) {
      return config;
    }

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
    let apiUrl = config.apiUrl.trim();
    if (!apiUrl.endsWith(API_CONST.ENDPOINTS.CHAT_COMPLETIONS)) {
      apiUrl = apiUrl.replace(new RegExp('/$'), '') + API_CONST.ENDPOINTS.CHAT_COMPLETIONS;
    }
    return apiUrl;
  }

  async callAI(request: AIRequest): Promise<AIResponse> {
    const { prompt, systemPrompt, config, signal, timeout } = request;
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

          const timeoutId = setTimeout(() => {
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

            const requestBody = JSON.stringify({
              model: resolvedConfig.model,
              messages: [
                ...(systemPrompt ? [{ role: AI_CONST.ROLES.SYSTEM, content: systemPrompt }] : []),
                { role: AI_CONST.ROLES.USER, content: prompt },
              ],
              max_tokens: resolvedConfig.maxOutputTokens || AI_CONST.DEFAULT_MAX_OUTPUT_TOKENS,
              temperature: resolvedConfig.temperature,
              top_p: resolvedConfig.topP,
            });

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

            const data = await response.json();

            let content = data.choices?.[0]?.message?.content || '';
            const tokensUsed = data.usage?.total_tokens || 0;
            const finishReason = data.choices?.[0]?.finish_reason || 'unknown';

            content = DataNormalizer.removeThinkTags(content);

            Logger.info('[AIService] AI response received', {
              tokensUsed,
              finishReason,
              contentLength: content.length,
            });

            this.storageManager.recordTokenUsage(tokensUsed).catch((err: unknown) => {
              Logger.warn('[AIService] Failed to record tokens', { err });
            });

            AIErrorHandler.logToFile(this.storageManager, AIErrorHandler.determineLogType(prompt), {
              prompt,
              response: content,
              timestamp: Date.now(),
            }).catch((e) => Logger.warn('Failed to log to file', { error: e }));

            return { content, tokensUsed, finishReason };
          } catch (error) {
            AIErrorHandler.classifyCallError(
              this.storageManager,
              error,
              signal,
              effectiveTimeout,
              prompt,
            );
            throw error;
          } finally {
            clearTimeout(timeoutId);
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
    try {
      const baseUrl = apiUrl
        .trim()
        .replace(new RegExp('/$'), '')
        .replace(new RegExp(API_CONST.ENDPOINTS.CHAT_COMPLETIONS + '$'), '');
      const modelsUrl = baseUrl + API_CONST.ENDPOINTS.MODELS;

      Logger.info('[AIService] Fetching available models', { url: modelsUrl });

      const headers: Record<string, string> = {};
      if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers,
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
      Logger.error('[AIService] Failed to get models', { error });
      return [];
    }
  }

  async analyzeComments(
    comments: Comment[],
    config: AIConfig,
    promptTemplate: string,
    language?: string,
    metadata?: {
      platform?: string;
      url?: string;
      title?: string;
      datetime?: string;
      videoTime?: string;
      postContent?: string;
    },
    signal?: AbortSignal,
    timeout?: number,
  ): Promise<AnalysisResult> {
    const resolvedLanguage = language || LANGUAGES.DEFAULT;
    const sanitizedMetadata = this.sanitizeAnalysisMetadata(metadata);
    const promptOverheadTokens = this.estimateAnalysisPromptOverheadTokens(
      promptTemplate,
      sanitizedMetadata,
      resolvedLanguage,
    );
    const commentBatches = this.splitCommentsForAnalysis(comments, config, promptOverheadTokens);

    Logger.info('[AIService] Analyzing comments', {
      batches: commentBatches.length,
    });

    if (commentBatches.length === 1) {
      return await this.analyzeSingleBatch(
        commentBatches[0],
        config,
        promptTemplate,
        sanitizedMetadata,
        signal,
        timeout,
        resolvedLanguage,
      );
    } else {
      const tasks = commentBatches.map((batch, index) => async () => {
        try {
          const result = await this.analyzeSingleBatch(
            batch,
            config,
            promptTemplate,
            sanitizedMetadata,
            signal,
            timeout,
            resolvedLanguage,
          );
          return { ok: true as const, result };
        } catch (error) {
          Logger.error(`[AIService] Analysis batch ${index + 1} failed`, { error });
          return { ok: false as const, error };
        }
      });

      const results = await runWithConcurrencyLimit(tasks, AI_CONST.MAX_CONCURRENT_REQUESTS);
      const successful = results.filter((item) => item.ok).map((item) => item.result);

      if (successful.length === 0) {
        throw createAIError(
          ErrorCode.AI_INVALID_RESPONSE,
          'All analysis batches failed',
          {},
          false,
        );
      }

      if (successful.length < results.length) {
        Logger.warn('[AIService] Partial analysis results due to failed batches', {
          total: results.length,
          successful: successful.length,
        });
      }

      return PromptBuilder.mergeAnalysisResults(successful);
    }
  }

  async normalizeCommentTimestamps(
    comments: Comment[],
    config: AIConfig,
    referenceTimeISO: string,
    timeout?: number,
  ): Promise<Comment[]> {
    if (!comments.length) {
      return comments;
    }

    const items = PromptBuilder.collectTimestampItems(comments);
    if (items.length === 0) {
      return comments;
    }

    const normalizedMap = new Map<string, string>();

    const batchSize = this.getNormalizationBatchSize(config, referenceTimeISO);
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const prompt = buildTimestampNormalizationPrompt(JSON.stringify(batch), referenceTimeISO);

      try {
        const response = await this.callAI({
          prompt,
          systemPrompt: AI_CONST.PROMPTS.JSON_ONLY,
          config,
          timeout,
        });
        const parsed = DataNormalizer.parseTimestampNormalizationResponse(response.content);
        if (!parsed) {
          continue;
        }
        for (const item of parsed) {
          if (item.path && item.timestamp) {
            const normalized = DataNormalizer.normalizeTimestampToMinute(item.timestamp);
            if (normalized) {
              normalizedMap.set(item.path, normalized);
            }
          }
        }
      } catch (error) {
        Logger.warn('[AIService] Timestamp normalization failed', { error });
      }
    }

    if (normalizedMap.size === 0) {
      return comments;
    }

    PromptBuilder.applyTimestampNormalization(comments, normalizedMap);
    return comments;
  }

  async normalizeSingleTimestamp(
    timestamp: string | undefined,
    config: AIConfig,
    referenceTimeISO: string,
    timeout?: number,
  ): Promise<string | undefined> {
    if (!timestamp) {
      return timestamp;
    }

    const prompt = buildTimestampNormalizationPrompt(
      JSON.stringify([{ path: '0', timestamp }]),
      referenceTimeISO,
    );

    try {
      const response = await this.callAI({
        prompt,
        systemPrompt: AI_CONST.PROMPTS.JSON_ONLY,
        config,
        timeout,
      });
      const parsed = DataNormalizer.parseTimestampNormalizationResponse(response.content);
      const match = parsed?.find((item) => item.path === '0');
      if (!match?.timestamp) {
        return timestamp;
      }
      return DataNormalizer.normalizeTimestampToMinute(match.timestamp) || timestamp;
    } catch (error) {
      Logger.warn('[AIService] Single timestamp normalization failed', { error });
      return timestamp;
    }
  }

  private async analyzeSingleBatch(
    comments: Comment[],
    config: AIConfig,
    promptTemplate: string,
    metadata?: {
      platform?: string;
      url?: string;
      title?: string;
      datetime?: string;
      videoTime?: string;
      postContent?: string;
    },
    signal?: AbortSignal,
    timeout?: number,
    language: string = LANGUAGES.DEFAULT,
  ): Promise<AnalysisResult> {
    const serialized = PromptBuilder.serializeCommentsDense(comments);
    const prompt = PromptBuilder.buildAnalysisPromptWrapper(
      serialized.text,
      promptTemplate,
      metadata,
      serialized.total,
      language,
    );

    const response = await this.callAI({
      prompt,
      config,
      signal,
      timeout,
    });

    const markdown = response.content;
    const summary = PromptBuilder.extractSummaryFromMarkdown(markdown, comments);

    return {
      markdown,
      summary,
      tokensUsed: response.tokensUsed,
      generatedAt: Date.now(),
    };
  }

  private estimateAnalysisPromptOverheadTokens(
    promptTemplate: string,
    metadata?: {
      platform?: string;
      url?: string;
      title?: string;
      datetime?: string;
      videoTime?: string;
      postContent?: string;
    },
    language: string = LANGUAGES.DEFAULT,
  ): number {
    const probePrompt = PromptBuilder.buildAnalysisPromptWrapper(
      ANALYSIS_FORMAT.COMMENT_HEADER,
      promptTemplate,
      metadata,
      0,
      language,
    );
    return Tokenizer.estimateTokens(probePrompt);
  }

  private trimAnalysisField(value: string | undefined, maxChars: number): string | undefined {
    if (typeof value !== 'string') {
      return value;
    }

    if (value.length <= maxChars) {
      return value;
    }

    return value.slice(0, maxChars) + TEXT.TRUNCATED_SUFFIX;
  }

  private sanitizeAnalysisMetadata(metadata?: {
    platform?: string;
    url?: string;
    title?: string;
    datetime?: string;
    videoTime?: string;
    postContent?: string;
  }):
    | {
        platform?: string;
        url?: string;
        title?: string;
        datetime?: string;
        videoTime?: string;
        postContent?: string;
      }
    | undefined {
    if (!metadata) {
      return metadata;
    }

    return {
      ...metadata,
      title: this.trimAnalysisField(metadata.title, AI_CONST.ANALYSIS_TITLE_MAX_CHARS),
      url: this.trimAnalysisField(metadata.url, AI_CONST.ANALYSIS_URL_MAX_CHARS),
      postContent: this.trimAnalysisField(
        metadata.postContent,
        AI_CONST.ANALYSIS_POST_CONTENT_MAX_CHARS,
      ),
    };
  }

  private getNormalizationBatchSize(config: AIConfig, referenceTimeISO: string): number {
    const maxOutput = config.maxOutputTokens || AI_CONST.DEFAULT_MAX_OUTPUT_TOKENS;
    const basePrompt = buildTimestampNormalizationPrompt('[]', referenceTimeISO);
    const overheadTokens = Tokenizer.estimateTokens(basePrompt);
    const availableTokens = Math.max(
      AI_CONST.MIN_AVAILABLE_TOKENS,
      config.contextWindowSize - maxOutput - AI_CONST.INPUT_TOKEN_BUFFER - overheadTokens,
    );
    const estimated = Math.floor(availableTokens / TIME_NORMALIZATION.ITEM_TOKEN_ESTIMATE);
    return Math.max(1, estimated);
  }

  private splitCommentsForAnalysis(
    comments: Comment[],
    config: AIConfig,
    promptOverheadTokens: number = 0,
  ): Comment[][] {
    const batches: Comment[][] = [];
    let currentBatch: Comment[] = [];
    let currentTokens = 0;

    const maxOutput = config.maxOutputTokens || AI_CONST.DEFAULT_MAX_OUTPUT_TOKENS;
    const availableTokens = Math.max(
      AI_CONST.MIN_AVAILABLE_TOKENS,
      config.contextWindowSize - maxOutput - AI_CONST.INPUT_TOKEN_BUFFER - promptOverheadTokens,
    );

    for (const comment of comments) {
      let commentForBatch = comment;
      let commentTokens = PromptBuilder.estimateTokensForComment(commentForBatch);

      if (commentTokens > availableTokens) {
        Logger.warn('[AIService] Comment exceeds context limit, truncating', {
          commentTokens,
          availableTokens,
        });

        const metadataReserve = AI_CONST.METADATA_RESERVE_TOKENS;
        const maxContentTokens = Math.max(0, availableTokens - metadataReserve);
        const maxChars = maxContentTokens * AI_CONST.CHARS_PER_TOKEN_RATIO;

        if (comment.content && comment.content.length > maxChars) {
          const originalLength = comment.content.length;
          commentForBatch = {
            ...comment,
            content: comment.content.substring(0, maxChars) + TEXT.TRUNCATED_SUFFIX,
          };
          commentTokens = PromptBuilder.estimateTokensForComment(commentForBatch);

          Logger.info('[AIService] Comment truncated', {
            originalLength,
            newLength: commentForBatch.content.length,
            newTokens: commentTokens,
          });
        }
      }

      if (currentTokens + commentTokens > availableTokens && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }

      currentBatch.push(commentForBatch);
      currentTokens += commentTokens;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches.length > 0 ? batches : [comments];
  }
}
