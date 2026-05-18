import { AIConfig, Comment } from '../../types';
import { buildTimestampNormalizationPrompt } from '../../utils/prompts';
import { Logger } from '../../utils/logger';
import { AI as AI_CONST, TIME_NORMALIZATION } from '@/config/constants';
import { Tokenizer } from '../../utils/tokenizer';
import { DataNormalizer } from './DataNormalizer';
import { PromptBuilder } from './PromptBuilder';
import { AIService } from '../AIService';

export class TimestampNormalizer {
  constructor(private readonly aiService: AIService) {}

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
        const response = await this.aiService.callAI({
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
        Logger.warn('[TimestampNormalizer] Timestamp normalization failed', { error });
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
      const response = await this.aiService.callAI({
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
      Logger.warn('[TimestampNormalizer] Single timestamp normalization failed', { error });
      return timestamp;
    }
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
}
