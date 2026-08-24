import {
  AIConfig,
  AIStreamProgress,
  Comment,
  AnalysisResult,
  AnalysisMetadata,
  TaskProgressMessageParams,
} from '../../types';
import { Logger } from '../../utils/logger';
import { createAIError, ErrorCode, ExtensionError } from '../../utils/errors';
import { AI as AI_CONST, LANGUAGES, TEXT, ANALYSIS_FORMAT } from '@/config/constants';
import { Tokenizer } from '../../utils/tokenizer';
import { runWithConcurrencyLimit } from '../../utils/promise';

import { PromptBuilder } from './PromptBuilder';
import { AIService } from '../AIService';

interface AnalysisProgressUpdate {
  current: number;
  total: number;
  stageMessage: string;
  stageMessageKey?: string;
  stageMessageParams?: TaskProgressMessageParams;
}

type AnalysisProgressCallback = (progress: AnalysisProgressUpdate) => void;

export class CommentAnalyzer {
  constructor(private readonly aiService: AIService) {}

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
    if (comments.length > 0 && commentBatches.length === 0) {
      throw createAIError(ErrorCode.AI_INVALID_RESPONSE, TEXT.NO_ANALYZABLE_COMMENTS, {}, false);
    }

    Logger.info('[CommentAnalyzer] Analyzing comments', {
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
          if (error instanceof ExtensionError && error.code === ErrorCode.TASK_CANCELLED) {
            throw error;
          }
          Logger.error(`[CommentAnalyzer] Analysis batch ${index + 1} failed`, { error });
          return { ok: false as const, error };
        }
      });

      const results = await runWithConcurrencyLimit(tasks, AI_CONST.MAX_CONCURRENT_REQUESTS);
      const failed = results.filter((item) => !item.ok);
      if (failed.length > 0) {
        throw createAIError(
          ErrorCode.AI_INVALID_RESPONSE,
          `${failed.length} analysis batch${failed.length === 1 ? '' : 'es'} failed; no partial report was saved`,
          { totalBatches: results.length, failedBatches: failed.length },
          false,
        );
      }

      const successful = results.filter((item) => item.ok).map((item) => item.result);
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

    const response = await this.aiService.callAI({
      prompt,
      config,
      signal,
      timeout,
      onStreamProgress,
    });

    const markdown = response.content;

    return {
      markdown,
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

  private splitCommentsForAnalysis(
    comments: Comment[],
    config: AIConfig,
    promptOverheadTokens: number = 0,
  ): Comment[][] {
    if (comments.length === 0) {
      return [comments];
    }

    const batches: Comment[][] = [];
    let currentBatch: Comment[] = [];
    let currentTokens = 0;

    const maxOutput = config.maxOutputTokens || AI_CONST.DEFAULT_MAX_OUTPUT_TOKENS;
    const availableTokens = Math.max(
      AI_CONST.MIN_AVAILABLE_TOKENS,
      config.contextWindowSize - maxOutput - AI_CONST.INPUT_TOKEN_BUFFER - promptOverheadTokens,
    );
    const metadataReserve = AI_CONST.METADATA_RESERVE_TOKENS;
    const maxContentTokens = Math.max(0, availableTokens - metadataReserve);
    const maxContentChars = maxContentTokens * AI_CONST.CHARS_PER_TOKEN_RATIO;

    for (const comment of comments) {
      let commentForBatch = comment;
      let commentTokens = PromptBuilder.estimateTokensForComment(commentForBatch);
      const contentExceedsCharBudget =
        typeof comment.content === 'string' && comment.content.length > maxContentChars;

      if (commentTokens > availableTokens || contentExceedsCharBudget) {
        Logger.warn('[CommentAnalyzer] Comment exceeds context limit, truncating', {
          commentTokens,
          availableTokens,
        });

        if (contentExceedsCharBudget) {
          const originalLength = comment.content.length;
          commentForBatch = {
            ...comment,
            content: comment.content.substring(0, maxContentChars) + TEXT.TRUNCATED_SUFFIX,
          };
          commentTokens = PromptBuilder.estimateTokensForComment(commentForBatch);

          Logger.info('[CommentAnalyzer] Comment truncated', {
            originalLength,
            newLength: commentForBatch.content.length,
            newTokens: commentTokens,
          });
        }

        if (commentTokens > availableTokens) {
          Logger.warn('[CommentAnalyzer] Dropping oversize comment after truncation', {
            commentId: comment.id,
            commentTokens,
            availableTokens,
            replyCount: comment.replies?.length ?? 0,
          });
          continue;
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

    return batches;
  }

  async generateDynamicHtml(
    analysisMarkdown: string,
    config: AIConfig,
    promptTemplate?: string,
    language?: string,
    metadata?: AnalysisMetadata,
    totalComments: number = 0,
    signal?: AbortSignal,
    timeout?: number,
    onStreamProgress?: (progress: AIStreamProgress) => void,
    comments?: Comment[],
  ): Promise<{ html: string; tokensUsed: number }> {
    const resolvedLanguage = language || LANGUAGES.DEFAULT;
    const sanitizedMetadata = this.sanitizeAnalysisMetadata(metadata);

    let topCommentsData: string | undefined;
    if (comments && comments.length > 0) {
      const topComments = [...comments]
        .sort((a, b) => (b.likes || 0) - (a.likes || 0))
        .slice(0, 10);
      topCommentsData = PromptBuilder.serializeCommentsDense(topComments).text;
    }

    const prompt = PromptBuilder.buildDynamicReportPromptWrapper(
      analysisMarkdown,
      promptTemplate,
      {
        ...sanitizedMetadata,
        topCommentsData,
      },
      totalComments,
      resolvedLanguage,
    );

    Logger.info('[CommentAnalyzer] Generating dynamic HTML report', {
      promptLength: prompt.length,
      language: resolvedLanguage,
      hasTopComments: !!topCommentsData,
    });

    const response = await this.aiService.callAI({
      prompt,
      systemPrompt:
        'You are an expert web developer and UI designer. Output ONLY valid, standalone, self-contained static HTML5 without scripts, event handlers, forms, frames, external resources, or markdown fences.',
      config,
      signal,
      timeout,
      onStreamProgress,
    });

    const html = PromptBuilder.extractCleanHtml(response.content);
    return {
      html,
      tokensUsed: response.tokensUsed,
    };
  }
}
