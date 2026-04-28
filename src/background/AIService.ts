import {
  AIConfig,
  AIRequest,
  AIResponse,
  AIStreamProgress,
  Comment,
  AnalysisResult,
  AnalysisMetadata,
  TaskProgressMessageParams,
} from '../types';
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

interface AnalysisProgressUpdate {
  current: number;
  total: number;
  stageMessage: string;
  stageMessageKey?: string;
  stageMessageParams?: TaskProgressMessageParams;
}

type AnalysisProgressCallback = (progress: AnalysisProgressUpdate) => void;

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
      apiUrl = apiUrl.replace(/\/$/, '') + API_CONST.ENDPOINTS.CHAT_COMPLETIONS;
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
    });
  }

  private async readAIResponse(
    response: Response,
    onStreamActivity: () => void,
    onStreamProgress?: (progress: AIStreamProgress) => void,
  ): Promise<StreamingAIResult> {
    if (!response.body) {
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

      const chunk = JSON.parse(payload) as ChatCompletionData;
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
    } finally {
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
    try {
      const baseUrl = apiUrl
        .trim()
        .replace(/\/$/, '')
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
    metadata?: AnalysisMetadata,
    signal?: AbortSignal,
    timeout?: number,
    onProgress?: AnalysisProgressCallback,
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

    const progressTracker = this.createAnalysisProgressTracker(commentBatches.length, onProgress);
    progressTracker.reportWaiting();

    if (commentBatches.length === 1) {
      const result = await this.analyzeSingleBatch(
        commentBatches[0],
        config,
        promptTemplate,
        sanitizedMetadata,
        signal,
        timeout,
        resolvedLanguage,
        (progress) => progressTracker.reportStreamProgress(0, progress),
      );
      progressTracker.reportBatchComplete(0);
      progressTracker.reportAllComplete();
      return result;
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
            (progress) => progressTracker.reportStreamProgress(index, progress),
          );
          progressTracker.reportBatchComplete(index);
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

      const merged = PromptBuilder.mergeAnalysisResults(successful);
      progressTracker.reportAllComplete();
      return merged;
    }
  }

  private createAnalysisProgressTracker(
    totalBatches: number,
    onProgress?: AnalysisProgressCallback,
  ) {
    const safeTotalBatches = Math.max(1, totalBatches);
    const batchUnits = Array.from({ length: safeTotalBatches }, () => 0);
    const batchCharacters = Array.from({ length: safeTotalBatches }, () => 0);
    const batchChunks = Array.from({ length: safeTotalBatches }, () => 0);
    const totalUnits = safeTotalBatches * AI_CONST.ANALYSIS_STREAM_BATCH_UNITS;
    const messages = AI_CONST.ANALYSIS_PROGRESS_MESSAGES;
    const messageKeys = AI_CONST.ANALYSIS_PROGRESS_MESSAGE_KEYS;
    const paramKeys = AI_CONST.ANALYSIS_PROGRESS_PARAM_KEYS;

    const createMessage = (
      baseMessage: string,
      messageKey: string,
      batchMessageKey: string,
      batchIndex?: number,
    ): Pick<AnalysisProgressUpdate, 'stageMessage' | 'stageMessageKey' | 'stageMessageParams'> => {
      const charactersReceived = batchCharacters.reduce((sum, count) => sum + count, 0);
      if (safeTotalBatches <= 1 || batchIndex === undefined) {
        return {
          stageMessage:
            charactersReceived > 0
              ? `${baseMessage}, ${charactersReceived} ${messages.CHARS_LABEL}`
              : baseMessage,
          stageMessageKey: messageKey,
          stageMessageParams: { [paramKeys.CHARACTERS]: charactersReceived },
        };
      }

      return {
        stageMessage: `${baseMessage}, ${messages.BATCH_LABEL} ${batchIndex + 1}/${safeTotalBatches}, ${charactersReceived} ${messages.CHARS_LABEL}`,
        stageMessageKey: batchMessageKey,
        stageMessageParams: {
          [paramKeys.BATCH]: batchIndex + 1,
          [paramKeys.TOTAL_BATCHES]: safeTotalBatches,
          [paramKeys.CHARACTERS]: charactersReceived,
        },
      };
    };

    const emit = ({
      stageMessage,
      stageMessageKey,
      stageMessageParams,
    }: Pick<
      AnalysisProgressUpdate,
      'stageMessage' | 'stageMessageKey' | 'stageMessageParams'
    >): void => {
      if (!onProgress) {
        return;
      }

      const current = Math.min(
        totalUnits,
        batchUnits.reduce((sum, units) => sum + units, 0),
      );
      onProgress({ current, total: totalUnits, stageMessage, stageMessageKey, stageMessageParams });
    };

    return {
      reportWaiting: (): void => {
        emit({
          stageMessage: messages.WAITING,
          stageMessageKey: messageKeys.WAITING,
        });
      },
      reportStreamProgress: (batchIndex: number, progress: AIStreamProgress): void => {
        if (batchIndex < 0 || batchIndex >= safeTotalBatches) {
          return;
        }

        batchCharacters[batchIndex] = Math.max(
          batchCharacters[batchIndex],
          progress.charactersReceived,
        );
        batchChunks[batchIndex] = Math.max(batchChunks[batchIndex], progress.chunksReceived);
        const streamUnits = Math.min(
          AI_CONST.ANALYSIS_STREAM_MAX_UNITS_PER_BATCH,
          Math.max(
            1,
            Math.floor(batchCharacters[batchIndex] / AI_CONST.ANALYSIS_STREAM_CHARS_PER_UNIT),
          ),
        );
        batchUnits[batchIndex] = Math.max(batchUnits[batchIndex], streamUnits);
        emit(
          createMessage(
            messages.RECEIVING,
            messageKeys.RECEIVING,
            messageKeys.RECEIVING_BATCH,
            batchIndex,
          ),
        );
      },
      reportBatchComplete: (batchIndex: number): void => {
        if (batchIndex < 0 || batchIndex >= safeTotalBatches) {
          return;
        }

        batchUnits[batchIndex] = AI_CONST.ANALYSIS_STREAM_BATCH_UNITS;
        emit(
          createMessage(
            messages.COMPLETE,
            messageKeys.COMPLETE,
            messageKeys.COMPLETE_BATCH,
            batchIndex,
          ),
        );
      },
      reportAllComplete: (): void => {
        for (let batchIndex = 0; batchIndex < batchUnits.length; batchIndex += 1) {
          batchUnits[batchIndex] = AI_CONST.ANALYSIS_STREAM_BATCH_UNITS;
        }
        emit({
          stageMessage: messages.COMPLETE,
          stageMessageKey: messageKeys.COMPLETE,
        });
      },
    };
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
    metadata?: AnalysisMetadata,
    signal?: AbortSignal,
    timeout?: number,
    language: string = LANGUAGES.DEFAULT,
    onStreamProgress?: (progress: AIStreamProgress) => void,
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
      onStreamProgress,
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
    metadata?: AnalysisMetadata,
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

  private sanitizeAnalysisMetadata(metadata?: AnalysisMetadata): AnalysisMetadata | undefined {
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
