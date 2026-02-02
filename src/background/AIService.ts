import { AIConfig, AIRequest, AIResponse, Comment, AnalysisResult } from '../types';
import { buildAnalysisPrompt, buildTimestampNormalizationPrompt } from '../utils/prompts';
import { Logger } from '../utils/logger';
import {
  ErrorHandler,
  ExtensionError,
  ErrorCode,
  createAIError,
  createNetworkError,
} from '../utils/errors';
import {
  AI as AI_CONST,
  REGEX,
  LOG_PREFIX,
  ANALYSIS_FORMAT,
  TIME_NORMALIZATION,
  RETRY,
  DEFAULTS,
  LANGUAGES,
  LIMITS,
  DATE_TIME,
} from '@/config/constants';
import type { StorageManager } from './StorageManager';
import { Tokenizer } from '../utils/tokenizer';

async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  const workerCount = Math.min(Math.max(1, limit), tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= tasks.length) {
        return;
      }
      results[current] = await tasks[current]();
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * AIService handles all AI-related operations including
 * comment extraction and analysis.
 *
 * This service is responsible for:
 * - Making API calls to AI providers (OpenAI-compatible APIs)
 * - Analyzing extracted comments to generate insights
 * - Managing AI request logging for debugging
 *
 * @example
 * ```typescript
 * const aiService = new AIService(storageManager);
 * const response = await aiService.callAI({
 *   prompt: 'Analyze these comments...',
 *   config: { apiUrl: '...', apiKey: '...', model: 'gpt-4', ... }
 * });
 * ```
 */
export class AIService {
  private currentLanguage: string = LANGUAGES.DEFAULT;

  /**
   * Creates a new AIService instance.
   * @param storageManager - StorageManager instance for settings and log persistence
   */
  constructor(private readonly storageManager: StorageManager) {}

  private logToFile(
    type: 'extraction' | 'analysis',
    data: { prompt: string; response: string; timestamp: number },
  ) {
    // Log to console with a special format that can be easily identified
    Logger.debug(`[AI_LOG_${type.toUpperCase()}]`, {
      timestamp: data.timestamp,
      type,
      prompt: data.prompt.substring(0, LIMITS.LOG_PROMPT_PREVIEW_LENGTH) + '...', // Corrected: Removed unnecessary backticks around string literal
      response: data.response.substring(0, LIMITS.LOG_PROMPT_PREVIEW_LENGTH) + '...', // Corrected: Removed unnecessary backticks around string literal
      promptLength: data.prompt.length,
      responseLength: data.response.length,
    });

    // Check developer mode before saving to storage
    this.storageManager.getSettings().then((settings) => {
      if (!settings.developerMode) {
        return;
      }

      const logKey = `${LOG_PREFIX.AI}${type}_${data.timestamp}`;
      this.storageManager
        .saveAiLog(logKey, {
          type,
          timestamp: data.timestamp,
          prompt: data.prompt,
          response: data.response,
        })
        .catch((error: unknown) => Logger.error('[AIService] Failed to save log', { error }));
    });
  }

  /**
   * Makes a request to the AI API with retry logic and error handling.
   *
   * @param request - The AI request configuration
   * @param request.prompt - The user prompt to send to the AI
   * @param request.systemPrompt - Optional system prompt for context
   * @param request.config - AI configuration (API URL, key, model, etc.)
   * @param request.signal - Optional AbortSignal for cancellation
   * @param request.timeout - Optional timeout in milliseconds
   * @returns Promise resolving to the AI response
   * @throws {ExtensionError} When API call fails, times out, or is rate limited
   *
   * @example
   * ```typescript
   * const response = await aiService.callAI({
   *   prompt: 'Summarize this text...',
   *   config: settings.aiModel,
   *   signal: abortController.signal,
   * });
   * ```
   */
  async callAI(request: AIRequest): Promise<AIResponse> {
    const { prompt, systemPrompt, config, signal, timeout } = request;

    // Use configured timeout or default
    const effectiveTimeout = timeout || AI_CONST.DEFAULT_TIMEOUT;

    return await ErrorHandler.withRetry(
      async () => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();

        // Handle parent signal
        if (signal) {
          if (signal.aborted) {
            controller.abort();
          } else {
            signal.addEventListener('abort', () => controller.abort());
          }
        }

        // Set timeout
        timeoutId = setTimeout(() => {
          controller.abort(new Error('Timeout'));
        }, effectiveTimeout);

        try {
          if (controller.signal.aborted) {
            throw createAIError(ErrorCode.TASK_CANCELLED, 'Request aborted', {});
          }

          // Validate configuration
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

          // Ensure API URL ends with /chat/completions
          let apiUrl = config.apiUrl.trim();
          if (!apiUrl.endsWith('/chat/completions')) {
            apiUrl = apiUrl.replace(new RegExp('/$'), '') + '/chat/completions';
          }

          Logger.info('[AIService] Calling AI API', {
            url: apiUrl,
            model: config.model,
            promptLength: prompt.length,
            timeout: effectiveTimeout,
          });

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };

          if (typeof config.apiKey === 'string' && config.apiKey.trim().length > 0) {
            headers.Authorization = `Bearer ${config.apiKey}`;
          }

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: config.model,
              messages: [
                ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                { role: 'user', content: prompt },
              ],
              max_tokens: config.maxOutputTokens || AI_CONST.DEFAULT_MAX_OUTPUT_TOKENS,
              temperature: config.temperature,
              top_p: config.topP,
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text();

            // Determine specific error type
            if (response.status === 429) {
              throw createAIError(ErrorCode.AI_RATE_LIMIT, 'Rate limit exceeded', {
                status: response.status,
                response: errorText,
              });
            } else if (response.status === 400) {
              if (
                errorText.includes('max_tokens') ||
                errorText.includes('context length') ||
                errorText.includes('maximum context')
              ) {
                throw createAIError(
                  ErrorCode.INVALID_CONFIG,
                  `Context limit exceeded. Please reduce 'Context Length' in settings or use a larger model. API Error: ${errorText}`,
                  { status: response.status, response: errorText },
                  false, // Not retryable
                );
              }
              throw createAIError(
                ErrorCode.API_ERROR,
                `API Bad Request (400): ${errorText}`,
                { status: response.status, response: errorText },
                false,
              );
            } else if (response.status === 404) {
              throw createAIError(
                ErrorCode.AI_MODEL_NOT_FOUND,
                `Model '${config.model}' not found`,
                { status: response.status, model: config.model },
              );
            } else if (response.status === 401 || response.status === 403) {
              throw createAIError(ErrorCode.MISSING_API_KEY, 'Invalid API key or unauthorized', {
                status: response.status,
              });
            } else {
              throw createAIError(
                ErrorCode.API_ERROR,
                `API error (${response.status}): ${errorText}`,
                { status: response.status, response: errorText },
              );
            }
          }

          const data = await response.json();

          // Extract response content and token usage
          let content = data.choices?.[0]?.message?.content || '';
          const tokensUsed = data.usage?.total_tokens || 0;
          const finishReason = data.choices?.[0]?.finish_reason || 'unknown';

          // Remove <think> tags if present (for thinking models)
          content = this.removeThinkTags(content);

          Logger.info('[AIService] AI response received', {
            tokensUsed,
            finishReason,
            contentLength: content.length,
          });

          // Record token usage
          this.storageManager.recordTokenUsage(tokensUsed).catch((err: unknown) => {
            Logger.warn('[AIService] Failed to record tokens', { err });
          });

          // Log the interaction for debugging
          const logType =
            prompt.includes('extract comments') ||
            prompt.includes('DOM Structure') ||
            prompt.includes('time normalization')
              ? 'extraction'
              : 'analysis';
          this.logToFile(logType, {
            prompt,
            response: content,
            timestamp: Date.now(),
          });

          return {
            content,
            tokensUsed,
            finishReason,
          };
        } catch (error) {
          if (
            error instanceof Error &&
            (error.name === 'AbortError' || error.message === 'Timeout')
          ) {
            if (signal?.aborted) {
              throw createAIError(ErrorCode.TASK_CANCELLED, 'Request aborted by user', {});
            }
            throw createAIError(
              ErrorCode.AI_TIMEOUT,
              `AI Request timed out after ${effectiveTimeout}ms`,
              {},
              false,
            );
          }

          if (error instanceof ExtensionError) {
            // Log retry intent for debugging
            if (
              error.retryable ||
              [ErrorCode.AI_RATE_LIMIT, ErrorCode.AI_TIMEOUT, ErrorCode.API_ERROR].includes(
                error.code,
              )
            ) {
              Logger.debug(`[AIService] Encountered retryable error: ${error.code}`, {
                message: error.message,
              });
            }
            const logType =
              prompt.includes('extract comments') ||
              prompt.includes('DOM Structure') ||
              prompt.includes('time normalization')
                ? 'extraction'
                : 'analysis';
            this.logToFile(logType, {
              prompt,
              response: error.message,
              timestamp: Date.now(),
            });
            throw error;
          }

          // Handle network errors
          if (error instanceof TypeError && error.message.includes('fetch')) {
            throw createNetworkError('Network request failed', {
              originalError: error.message,
            });
          }

          Logger.error('[AIService] AI call failed', { error });
          const logType =
            prompt.includes('extract comments') ||
            prompt.includes('DOM Structure') ||
            prompt.includes('time normalization')
              ? 'extraction'
              : 'analysis';
          this.logToFile(logType, {
            prompt,
            response: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          });
          throw error;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      },
      'AIService.callAI',
      {
        maxAttempts: RETRY.MAX_ATTEMPTS,
        initialDelay: RETRY.INITIAL_DELAY_MS,
      },
    );
  }

  /**
   * Get available models from AI provider
   * @param apiUrl - API URL
   * @param apiKey - API key
   * @returns List of available model names
   */
  async getAvailableModels(apiUrl: string, apiKey: string): Promise<string[]> {
    try {
      // Ensure API URL is base URL (v1)
      let baseUrl = apiUrl
        .trim()
        .replace(new RegExp('/$'), '')
        .replace(new RegExp('/chat/completions$'), '');
      const modelsUrl = baseUrl + '/models';

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

  /**
   * Analyzes comments using AI to generate insights and sentiment analysis.
   *
   * This method handles large comment sets by automatically batching them
   * to fit within the AI model's context window. Results from multiple
   * batches are merged into a single analysis result.
   *
   * @param comments - Array of comments to analyze
   * @param config - AI configuration (API URL, key, model, context window, etc.)
   * @param promptTemplate - Custom prompt template with placeholders
   * @param language - Language code for analysis output (e.g., 'zh-CN', 'en-US')
   * @param metadata - Additional context for the analysis
   * @param metadata.platform - Platform name (e.g., 'youtube.com')
   * @param metadata.url - URL of the source page
   * @param metadata.title - Title of the post/video
   * @param metadata.datetime - Current datetime for the report
   * @param metadata.videoTime - Publication time of the video/post
   * @param signal - Optional AbortSignal for cancellation
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise resolving to AnalysisResult with markdown report and summary
   * @throws {ExtensionError} When AI request fails or is cancelled
   *
   * @example
   * ```typescript
   * const result = await aiService.analyzeComments(
   *   comments,
   *   settings.aiModel,
   *   settings.analyzerPromptTemplate,
   *   'zh-CN',
   *   { platform: 'youtube.com', title: 'Video Title' },
   *   abortController.signal,
   * );
   * ```
   */
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
    this.currentLanguage = language || LANGUAGES.DEFAULT;
    // Split comments if they exceed token limit
    const commentBatches = this.splitCommentsForAnalysis(comments, config);

    Logger.info('[AIService] Analyzing comments', { batches: commentBatches.length });

    if (commentBatches.length === 1) {
      // Single batch - analyze directly
      return await this.analyzeSingleBatch(
        commentBatches[0],
        config,
        promptTemplate,
        metadata,
        signal,
        timeout,
      );
    } else {
      // Multiple batches - analyze with concurrency limit
      const tasks = commentBatches.map((batch, index) => async () => {
        try {
          const result = await this.analyzeSingleBatch(
            batch,
            config,
            promptTemplate,
            metadata,
            signal,
            timeout,
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

      return this.mergeAnalysisResults(successful);
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

    const items = this.collectTimestampItems(comments);
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
          systemPrompt:
            'You MUST respond with ONLY valid JSON, no markdown, no explanations, no code blocks. Start with [ and end with ].',
          config,
          timeout,
        });
        const parsed = this.parseTimestampNormalizationResponse(response.content);
        if (!parsed) {
          continue;
        }
        for (const item of parsed) {
          if (item.path && item.timestamp) {
            const normalized = this.normalizeTimestampToMinute(item.timestamp);
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

    this.applyTimestampNormalization(comments, normalizedMap);
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
        systemPrompt:
          'You MUST respond with ONLY valid JSON, no markdown, no explanations, no code blocks. Start with [ and end with ].',
        config,
        timeout,
      });
      const parsed = this.parseTimestampNormalizationResponse(response.content);
      const match = parsed?.find((item) => item.path === '0');
      if (!match?.timestamp) {
        return timestamp;
      }
      return this.normalizeTimestampToMinute(match.timestamp) || timestamp;
    } catch (error) {
      Logger.warn('[AIService] Single timestamp normalization failed', { error });
      return timestamp;
    }
  }

  /**
   * Analyze a single batch of comments
   * @param comments - Comments to analyze
   * @param config - AI configuration
   * @param promptTemplate - Custom prompt template
   * @param metadata - Additional metadata
   * @returns Analysis result
   */
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
  ): Promise<AnalysisResult> {
    const serialized = this.serializeCommentsDense(comments);
    const prompt = this.buildAnalysisPromptWrapper(
      serialized.text,
      promptTemplate,
      metadata,
      serialized.total,
    );

    const response = await this.callAI({
      prompt,
      config,
      signal,
      timeout,
    });

    // Parse the markdown response
    const markdown = response.content;

    // Extract summary information from markdown
    const summary = this.extractSummaryFromMarkdown(markdown, comments);

    return {
      markdown,
      summary,
      tokensUsed: response.tokensUsed,
      generatedAt: Date.now(),
    };
  }

  private collectTimestampItems(
    comments: Comment[],
    parentPath: string = '',
    items: Array<{ path: string; timestamp: string }> = [],
  ): Array<{ path: string; timestamp: string }> {
    comments.forEach((comment, index) => {
      const path = parentPath
        ? `${parentPath}${TIME_NORMALIZATION.PATH_SEPARATOR}${index}`
        : `${index}`;
      items.push({ path, timestamp: comment.timestamp });
      if (comment.replies?.length) {
        this.collectTimestampItems(comment.replies, path, items);
      }
    });
    return items;
  }

  private applyTimestampNormalization(
    comments: Comment[],
    normalizedMap: Map<string, string>,
    parentPath: string = '',
  ): void {
    comments.forEach((comment, index) => {
      const path = parentPath
        ? `${parentPath}${TIME_NORMALIZATION.PATH_SEPARATOR}${index}`
        : `${index}`;
      const normalized = normalizedMap.get(path);
      if (normalized) {
        comment.timestamp = normalized;
      }
      if (comment.replies?.length) {
        this.applyTimestampNormalization(comment.replies, normalizedMap, path);
      }
    });
  }

  private parseTimestampNormalizationResponse(
    content: string,
  ): Array<{ path: string; timestamp: string }> | null {
    let jsonText = content.trim();
    jsonText = jsonText
      .replace(REGEX.MD_CODE_JSON_START, '')
      .replace(REGEX.MD_CODE_ANY_END, '')
      .trim();
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        return null;
      }
      return parsed.filter(
        (item): item is { path: string; timestamp: string } =>
          item &&
          typeof item === 'object' &&
          typeof item.path === 'string' &&
          typeof item.timestamp === 'string',
      );
    } catch (error) {
      Logger.warn('[AIService] Failed to parse timestamp normalization response', { error });
    }
    return null;
  }

  private formatLocalIsoMinute(date: Date): string {
    const pad = (value: number) => value.toString().padStart(DATE_TIME.PAD_LENGTH, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + DATE_TIME.MONTH_OFFSET);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${year}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${month}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${day}T${hours}${DATE_TIME.DISPLAY_TIME_SEPARATOR}${minutes}`;
  }

  private normalizeTimestampToMinute(timestamp: string): string | null {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return this.formatLocalIsoMinute(parsed);
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

  /**
   * Split comments into batches based on token limit
   * @param comments - All comments
   * @param config - AI Config
   * @returns Array of comment batches
   */
  private splitCommentsForAnalysis(comments: Comment[], config: AIConfig): Comment[][] {
    const batches: Comment[][] = [];
    let currentBatch: Comment[] = [];
    let currentTokens = 0;

    const maxOutput = config.maxOutputTokens || AI_CONST.DEFAULT_MAX_OUTPUT_TOKENS;
    // Calculate available input tokens: Context Window - Output - Safety Buffer
    // We use a safety buffer for system prompt and overhead
    const availableTokens = Math.max(
      AI_CONST.MIN_AVAILABLE_TOKENS,
      config.contextWindowSize - maxOutput - AI_CONST.INPUT_TOKEN_BUFFER,
    );

    for (const comment of comments) {
      let commentTokens = this.estimateTokensForComment(comment);

      // Handle huge single comment
      if (commentTokens > availableTokens) {
        Logger.warn('[AIService] Comment exceeds context limit, truncating', {
          commentTokens,
          availableTokens,
        });

        // Reserve space for metadata (username, timestamp etc) - approx 100 tokens
        const metadataReserve = 100;
        const maxContentTokens = Math.max(0, availableTokens - metadataReserve);

        // Approximate char count (assuming 2 chars per token to be safe for mixed en/zh)
        const maxChars = maxContentTokens * 2;

        if (comment.content && comment.content.length > maxChars) {
          const originalLength = comment.content.length;
          comment.content = comment.content.substring(0, maxChars) + '... [Truncated]';
          commentTokens = this.estimateTokensForComment(comment); // Re-calculate

          Logger.info('[AIService] Comment truncated', {
            originalLength,
            newLength: comment.content.length,
            newTokens: commentTokens,
          });
        }
      }

      if (currentTokens + commentTokens > availableTokens && currentBatch.length > 0) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentTokens = 0;
        }
      }

      currentBatch.push(comment);
      currentTokens += commentTokens;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches.length > 0 ? batches : [comments];
  }

  /**
   * Merge multiple analysis results into one
   * @param results - Array of analysis results
   * @returns Merged analysis result
   */
  private mergeAnalysisResults(results: AnalysisResult[]): AnalysisResult {
    const mergedMarkdown = results
      .map((r, i) => `## Batch ${i + 1}\n\n${r.markdown}`)
      .join('\n\n---\n\n');

    const totalComments = results.reduce((sum, r) => sum + r.summary.totalComments, 0);
    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);

    // Merge sentiment distributions
    const sentimentDistribution = {
      positive: 0,
      negative: 0,
      neutral: 0,
    };

    results.forEach((r) => {
      sentimentDistribution.positive += r.summary.sentimentDistribution.positive;
      sentimentDistribution.negative += r.summary.sentimentDistribution.negative;
      sentimentDistribution.neutral += r.summary.sentimentDistribution.neutral;
    });

    // Normalize percentages
    const total =
      sentimentDistribution.positive +
      sentimentDistribution.negative +
      sentimentDistribution.neutral;
    if (total > 0) {
      sentimentDistribution.positive = Math.round((sentimentDistribution.positive / total) * 100);
      sentimentDistribution.negative = Math.round((sentimentDistribution.negative / total) * 100);
      sentimentDistribution.neutral =
        100 - sentimentDistribution.positive - sentimentDistribution.negative;
    }

    // Merge hot comments
    const allHotComments = results.flatMap((r) => r.summary.hotComments);
    const hotComments = allHotComments.slice(0, AI_CONST.HOT_COMMENTS_LIMIT);

    // Merge key insights
    const keyInsights = results.flatMap((r) => r.summary.keyInsights);

    return {
      markdown: mergedMarkdown,
      summary: {
        totalComments,
        sentimentDistribution,
        hotComments,
        keyInsights,
      },
      tokensUsed: totalTokens,
      generatedAt: Date.now(),
    };
  }

  /**
   * Build analysis prompt for AI (wrapper)
   * @param commentsJson - Comments in JSON format
   * @param template - Prompt template
   * @param metadata - Additional metadata
   * @returns Formatted prompt
   */
  private buildAnalysisPromptWrapper(
    commentsData: string,
    template: string,
    metadata?: {
      platform?: string;
      url?: string;
      title?: string;
      datetime?: string;
      videoTime?: string;
      postContent?: string;
    },
    totalComments: number = 0,
  ): string {
    return buildAnalysisPrompt(commentsData, template, {
      datetime: new Date().toISOString(),
      videoTime: metadata?.videoTime || 'N/A',
      platform: metadata?.platform || 'Unknown Platform',
      url: metadata?.url || 'N/A',
      title: metadata?.title || 'Untitled',
      postContent: metadata?.postContent || 'N/A',
      totalComments,
      language: this.currentLanguage,
    });
  }

  /**
   * Extract summary information from markdown
   * @param markdown - Markdown content
   * @param comments - Original comments
   * @returns Summary object
   */
  private extractSummaryFromMarkdown(
    markdown: string,
    comments: Comment[],
  ): AnalysisResult['summary'] {
    const parsePercent = (re: RegExp): number | undefined => {
      const match = markdown.match(re);
      return match ? parseInt(match[1]) : undefined;
    };

    const positive =
      parsePercent(/\|\s*Positive\s*\|\s*(\d+)%/i) ?? parsePercent(/Positive:\s*(\d+)%/i);
    const negative =
      parsePercent(/\|\s*Negative\s*\|\s*(\d+)%/i) ?? parsePercent(/Negative:\s*(\d+)%/i);
    const neutral =
      parsePercent(/\|\s*Neutral\s*\|\s*(\d+)%/i) ?? parsePercent(/Neutral:\s*(\d+)%/i);

    return {
      totalComments: comments.length,
      sentimentDistribution: {
        positive: typeof positive === 'number' ? positive : DEFAULTS.SENTIMENT_POSITIVE,
        negative: typeof negative === 'number' ? negative : DEFAULTS.SENTIMENT_NEGATIVE,
        neutral: typeof neutral === 'number' ? neutral : DEFAULTS.SENTIMENT_NEUTRAL,
      },
      hotComments: comments.slice(0, DEFAULTS.HOT_COMMENTS_PREVIEW),
      keyInsights: [],
    };
  }

  /**
   * Remove <think> tags from AI response (for thinking models)
   * @param content - AI response content
   * @returns Content without think tags
   */
  private removeThinkTags(content: string): string {
    // Remove <think>...</think> blocks (including multiline)
    return content.replace(REGEX.THINK_TAGS, '').trim();
  }

  private serializeCommentsDense(comments: Comment[]): { text: string; total: number } {
    const lines: string[] = [ANALYSIS_FORMAT.COMMENT_HEADER];
    let total = 0;

    const traverse = (items: Comment[], depth: number) => {
      for (const comment of items) {
        lines.push(this.formatCommentLine(comment, depth));
        total += 1;
        if (Array.isArray(comment.replies) && comment.replies.length > 0) {
          traverse(comment.replies, depth + 1);
        }
      }
    };

    traverse(comments, 0);

    return {
      text: lines.join('\n'),
      total,
    };
  }

  private formatCommentLine(comment: Comment, depth: number): string {
    const prefix = depth > 0 ? ANALYSIS_FORMAT.REPLY_PREFIX.repeat(depth) : '';
    const username = this.normalizeTextValue(comment.username, ANALYSIS_FORMAT.UNKNOWN_USERNAME);
    const timestamp = this.normalizeTextValue(comment.timestamp, ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP);
    const likes = this.formatLikesValue(comment.likes);
    const content = this.normalizeTextValue(comment.content, ANALYSIS_FORMAT.UNKNOWN_CONTENT);

    return [`${prefix}${username}`, timestamp, likes, content].join(
      ANALYSIS_FORMAT.FIELD_SEPARATOR,
    );
  }

  private normalizeTextValue(value: string | undefined | null, fallback: string): string {
    const normalized = (value ?? '').toString().replace(/\s+/g, ' ').trim();
    return normalized || fallback;
  }

  private formatLikesValue(likes?: number): string {
    if (typeof likes !== 'number' || Number.isNaN(likes)) {
      return '0';
    }
    return String(Math.max(0, Math.round(likes)));
  }

  private estimateTokensForComment(comment: Comment, depth: number = 0): number {
    let tokens = this.estimateTextTokens(this.formatCommentLine(comment, depth));
    if (Array.isArray(comment.replies)) {
      for (const reply of comment.replies) {
        tokens += this.estimateTokensForComment(reply, depth + 1);
      }
    }
    return tokens;
  }

  private estimateTextTokens(text: string): number {
    return Tokenizer.estimateTokens(text);
  }
}
