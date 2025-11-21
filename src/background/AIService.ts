import { AIConfig, AIRequest, AIResponse, Comment, AnalysisResult } from '../types';
import { buildExtractionPrompt, buildAnalysisPrompt } from '../utils/prompts';
import { Logger } from '../utils/logger';
import {
  ErrorHandler,
  ExtensionError,
  ErrorCode,
  createAIError,
  createNetworkError,
} from '../utils/errors';
import { AI as AI_CONST, REGEX, LOG_PREFIX, ANALYSIS_FORMAT } from '@/config/constants';
import { storageManager } from './StorageManager';
import { Tokenizer } from '../utils/tokenizer';

/**
 * AIService handles all AI-related operations including
 * comment extraction and analysis
 */
export class AIService {
  private currentLanguage: string = 'en-US';

  private logToFile(
    type: 'extraction' | 'analysis',
    data: { prompt: string; response: string; timestamp: number },
  ) {
    // Log to console with a special format that can be easily identified
    Logger.debug(`[AI_LOG_${type.toUpperCase()}]`, {
      timestamp: data.timestamp,
      type,
      prompt: data.prompt.substring(0, 500) + '...', // First 500 chars
      response: data.response.substring(0, 500) + '...', // First 500 chars
      promptLength: data.prompt.length,
      responseLength: data.response.length,
    });

    // Check developer mode before saving to storage
    storageManager.getSettings().then((settings) => {
      if (!settings.developerMode) {
        return;
      }

      // Save full log to chrome.storage.local
      const logKey = `${LOG_PREFIX.AI}${type}_${data.timestamp}`;
      chrome.storage.local
        .set({
          [logKey]: {
            type,
            timestamp: data.timestamp,
            prompt: data.prompt,
            response: data.response,
          },
        })
        .catch((err) => Logger.error('[AIService] Failed to save log:', err));
    });
  }
  /**
   * Call AI API with the given request
   * @param request - AI request configuration
   * @returns AI response
   */
  async callAI(request: AIRequest): Promise<AIResponse> {
    const { prompt, systemPrompt, config } = request;

    return await ErrorHandler.withRetry(
      async () => {
        try {
          // Validate configuration
          if (!config.apiUrl || !config.apiKey) {
            throw createAIError(ErrorCode.MISSING_API_KEY, 'API URL and API Key are required', {
              hasUrl: !!config.apiUrl,
              hasKey: !!config.apiKey,
            });
          }

          // Ensure API URL ends with /chat/completions
          let apiUrl = config.apiUrl.trim();
          if (!apiUrl.endsWith('/chat/completions')) {
            apiUrl = apiUrl.replace(/\/$/, '') + '/chat/completions';
          }

          Logger.info('[AIService] Calling AI API', {
            url: apiUrl,
            model: config.model,
            promptLength: prompt.length,
          });

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages: [
                ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                { role: 'user', content: prompt },
              ],
              max_tokens: config.maxTokens,
              temperature: config.temperature,
              top_p: config.topP,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();

            // Determine specific error type
            if (response.status === 429) {
              throw createAIError(ErrorCode.AI_RATE_LIMIT, 'Rate limit exceeded', {
                status: response.status,
                response: errorText,
              });
            } else if (response.status === 404) {
              throw createAIError(
                ErrorCode.AI_MODEL_NOT_FOUND,
                `Model not found: ${config.model}`,
                { status: response.status, model: config.model },
              );
            } else if (response.status === 401 || response.status === 403) {
              throw createAIError(ErrorCode.MISSING_API_KEY, 'Invalid API key or unauthorized', {
                status: response.status,
              });
            } else {
              throw createAIError(
                ErrorCode.API_ERROR,
                `AI API error: ${response.status} - ${errorText}`,
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
          storageManager.recordTokenUsage(tokensUsed).catch((err) => {
            Logger.warn('[AIService] Failed to record tokens', { err });
          });

          // Log the interaction for debugging
          const logType =
            prompt.includes('extract comments') || prompt.includes('DOM Structure')
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
          if (error instanceof ExtensionError) {
            throw error;
          }

          // Handle network errors
          if (error instanceof TypeError && error.message.includes('fetch')) {
            throw createNetworkError('Network request failed', { originalError: error.message });
          }

          Logger.error('[AIService] AI call failed', { error });
          throw error;
        }
      },
      'AIService.callAI',
      {
        maxAttempts: 3,
        initialDelay: 1000,
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
      let baseUrl = apiUrl.trim().replace(/\/$/, '');
      // Remove /chat/completions if present
      baseUrl = baseUrl.replace(/\/chat\/completions$/, '');
      const modelsUrl = baseUrl + '/models';

      Logger.info('[AIService] Fetching available models', { url: modelsUrl });

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        Logger.warn('[AIService] Failed to fetch models, using defaults', {
          status: response.status,
        });
        return this.getDefaultModels();
      }

      const data = await response.json();
      const models = data.data?.map((model: any) => model.id) || [];

      Logger.info('[AIService] Available models fetched', { count: models.length });
      return models.length > 0 ? models : this.getDefaultModels();
    } catch (error) {
      Logger.error('[AIService] Failed to get models', { error });
      return this.getDefaultModels();
    }
  }

  /**
   * Extract comments from DOM content using AI
   * @param domContent - Serialized DOM content
   * @param config - AI configuration
   * @returns Extracted comments
   */
  async extractComments(
    domContent: string,
    config: AIConfig,
    promptTemplate: string,
  ): Promise<Comment[]> {
    const maxModelTokens = config.maxTokens ?? 4000;
    const chunks = this.chunkDomContent(domContent, maxModelTokens);
    const allComments: Comment[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const partPrompt = this.buildExtractionPromptWrapper(chunks[i], promptTemplate);
      const response = await this.callAI({ prompt: partPrompt, config });
      try {
        const comments = JSON.parse(response.content);
        if (Array.isArray(comments)) {
          allComments.push(...comments);
        } else {
          Logger.warn('[AIService] Non-array comments in part', { part: i + 1 });
        }
      } catch (error) {
        Logger.error('[AIService] Failed to parse AI response part', { part: i + 1, error });
        // Continue with next part
      }
    }

    Logger.info('[AIService] Extracted comments (aggregated)', {
      count: allComments.length,
      parts: chunks.length,
    });
    return allComments;
  }

  /**
   * Analyze comments using AI
   * @param comments - Comments to analyze
   * @param config - AI configuration
   * @param promptTemplate - Custom prompt template
   * @param language - Language for analysis
   * @param metadata - Additional metadata (platform, url, title, datetime, videoTime)
   * @returns Analysis result
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
    },
  ): Promise<AnalysisResult> {
    this.currentLanguage = language || 'en-US';
    // Split comments if they exceed token limit
    const commentBatches = this.splitCommentsForAnalysis(comments, config.maxTokens);

    Logger.info('[AIService] Analyzing comments', { batches: commentBatches.length });

    if (commentBatches.length === 1) {
      // Single batch - analyze directly
      return await this.analyzeSingleBatch(commentBatches[0], config, promptTemplate, metadata);
    } else {
      // Multiple batches - analyze separately and merge
      const results = await Promise.all(
        commentBatches.map((batch) =>
          this.analyzeSingleBatch(batch, config, promptTemplate, metadata),
        ),
      );
      return this.mergeAnalysisResults(results);
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
    },
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

  /**
   * Split comments into batches based on token limit
   * @param comments - All comments
   * @param maxTokens - Maximum tokens per batch
   * @returns Array of comment batches
   */
  private splitCommentsForAnalysis(comments: Comment[], maxTokens: number): Comment[][] {
    const batches: Comment[][] = [];
    let currentBatch: Comment[] = [];
    let currentTokens = 0;
    const availableTokens = Math.max(
      1,
      Math.floor(maxTokens * (1 - AI_CONST.TOKEN_RESERVE_RATIO)),
    );

    for (const comment of comments) {
      const commentTokens = this.estimateTokensForComment(comment);

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
   * Build extraction prompt for AI (wrapper)
   * @param domContent - DOM content
   * @returns Formatted prompt
   */
  private buildExtractionPromptWrapper(domContent: string, template: string): string {
    return buildExtractionPrompt(domContent, template);
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
    },
    totalComments: number = 0,
  ): string {
    return buildAnalysisPrompt(commentsData, template, {
      datetime: new Date().toISOString(),
      videoTime: metadata?.videoTime || 'N/A',
      platform: metadata?.platform || 'Unknown Platform',
      url: metadata?.url || 'N/A',
      title: metadata?.title || 'Untitled',
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
    // Simple extraction - in production, this could be more sophisticated
    const positiveMatch = markdown.match(/Positive:\s*(\d+)%/i);
    const negativeMatch = markdown.match(/Negative:\s*(\d+)%/i);
    const neutralMatch = markdown.match(/Neutral:\s*(\d+)%/i);

    return {
      totalComments: comments.length,
      sentimentDistribution: {
        positive: positiveMatch ? parseInt(positiveMatch[1]) : 33,
        negative: negativeMatch ? parseInt(negativeMatch[1]) : 33,
        neutral: neutralMatch ? parseInt(neutralMatch[1]) : 34,
      },
      hotComments: comments.slice(0, 5), // Top 5 by default
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

    return [
      `${prefix}${username}`,
      timestamp,
      likes,
      content,
    ].join(ANALYSIS_FORMAT.FIELD_SEPARATOR);
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

  /**
   * Get default model list
   * @returns Default model names
   */
  private getDefaultModels(): string[] {
    return [
      'gpt-4',
      'gpt-4-turbo',
      'gpt-3.5-turbo',
      'claude-3-opus',
      'claude-3-sonnet',
      'claude-3-haiku',
    ];
  }

  private chunkDomContent(structure: string, maxTokens: number): string[] {
    const reserveRatio = AI_CONST.TOKEN_RESERVE_RATIO;
    const limit = Math.max(200, Math.floor(maxTokens * (1 - reserveRatio)));

    const parts: string[] = [];
    let current: string[] = [];
    let tokens = 0;

    // Split by closing tags to preserve structure better than just newlines
    // This regex splits after > followed by newline, keeping the delimiter
    const lines = structure.split(/(?<=>)\n/);

    for (const line of lines) {
      const t = Tokenizer.estimateTokens(line) + 1; // +1 for newline
      if (tokens + t > limit && current.length > 0) {
        parts.push(current.join('\n'));
        current = [line];
        tokens = t;
      } else {
        current.push(line);
        tokens += t;
      }
    }
    if (current.length > 0) parts.push(current.join('\n'));
    return parts.length > 0 ? parts : [structure];
  }
}

// Export singleton instance
export const aiService = new AIService();