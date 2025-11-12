import { AIConfig, AIRequest, AIResponse, Comment, AnalysisResult } from '../types';
import { buildExtractionPrompt, buildAnalysisPrompt } from '../utils/prompts';
import { Logger } from '../utils/logger';
import { 
  ErrorHandler, 
  ExtensionError, 
  ErrorCode, 
  createAIError, 
  createNetworkError 
} from '../utils/errors';

/**
 * AIService handles all AI-related operations including
 * comment extraction and analysis
 */
export class AIService {
  private currentLanguage: string = 'en-US';
  
  private logToFile(type: 'extraction' | 'analysis', data: { prompt: string; response: string; timestamp: number}) {
    // Log to console with a special format that can be easily identified
    Logger.debug(`[AI_LOG_${type.toUpperCase()}]`, {
      timestamp: data.timestamp,
      type,
      prompt: data.prompt.substring(0, 500) + '...', // First 500 chars
      response: data.response.substring(0, 500) + '...', // First 500 chars
      promptLength: data.prompt.length,
      responseLength: data.response.length,
    });
    
    // Save full log to chrome.storage.local
    const logKey = `ai_log_${type}_${data.timestamp}`;
    chrome.storage.local.set({
      [logKey]: {
        type,
        timestamp: data.timestamp,
        prompt: data.prompt,
        response: data.response,
      }
    }).catch(err => Logger.error('[AIService] Failed to save log:', err));
  }
  /**
   * Call AI API with the given request
   * @param request - AI request configuration
   * @returns AI response
   */
  async callAI(request: AIRequest): Promise<AIResponse> {
    const { prompt, systemPrompt, config } = request;

    return await ErrorHandler.withRetry(async () => {
      try {
        // Validate configuration
        if (!config.apiUrl || !config.apiKey) {
          throw createAIError(
            ErrorCode.MISSING_API_KEY,
            'API URL and API Key are required',
            { hasUrl: !!config.apiUrl, hasKey: !!config.apiKey }
          );
        }

        // Ensure API URL ends with /chat/completions
        let apiUrl = config.apiUrl.trim();
        if (!apiUrl.endsWith('/chat/completions')) {
          apiUrl = apiUrl.replace(/\/$/, '') + '/chat/completions';
        }
        
        Logger.info('[AIService] Calling AI API', { 
          url: apiUrl, 
          model: config.model,
          promptLength: prompt.length 
        });

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
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
            throw createAIError(
              ErrorCode.AI_RATE_LIMIT,
              'Rate limit exceeded',
              { status: response.status, response: errorText }
            );
          } else if (response.status === 404) {
            throw createAIError(
              ErrorCode.AI_MODEL_NOT_FOUND,
              `Model not found: ${config.model}`,
              { status: response.status, model: config.model }
            );
          } else if (response.status === 401 || response.status === 403) {
            throw createAIError(
              ErrorCode.MISSING_API_KEY,
              'Invalid API key or unauthorized',
              { status: response.status }
            );
          } else {
            throw createAIError(
              ErrorCode.API_ERROR,
              `AI API error: ${response.status} - ${errorText}`,
              { status: response.status, response: errorText }
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

        // Log the interaction for debugging
        const logType = prompt.includes('extract comments') || prompt.includes('DOM Structure') ? 'extraction' : 'analysis';
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
    }, 'AIService.callAI', {
      maxAttempts: 3,
      initialDelay: 1000,
    });
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
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        Logger.warn('[AIService] Failed to fetch models, using defaults', { 
          status: response.status 
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
  async extractComments(domContent: string, config: AIConfig): Promise<Comment[]> {
    const prompt = this.buildExtractionPromptWrapper(domContent);
    
    const response = await this.callAI({
      prompt,
      config,
    });

    // Parse JSON response
    try {
      const comments = JSON.parse(response.content);
      
      if (!Array.isArray(comments)) {
        throw createAIError(
          ErrorCode.AI_INVALID_RESPONSE,
          'AI response is not an array',
          { responseType: typeof comments }
        );
      }

      Logger.info('[AIService] Extracted comments', { count: comments.length });
      return comments;
    } catch (error) {
      if (error instanceof ExtensionError) {
        throw error;
      }
      
      Logger.error('[AIService] Failed to parse AI response', { error });
      throw createAIError(
        ErrorCode.AI_INVALID_RESPONSE,
        'Failed to parse comment data from AI response',
        { originalError: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  }

  /**
   * Analyze comments using AI
   * @param comments - Comments to analyze
   * @param config - AI configuration
   * @param promptTemplate - Custom prompt template
   * @param language - Language for analysis
   * @param metadata - Additional metadata (platform, url, title, datetime)
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
    }
  ): Promise<AnalysisResult> {
    this.currentLanguage = language || 'en-US';
    // Split comments if they exceed token limit
    const commentBatches = this.splitCommentsForAnalysis(comments, config.maxTokens);
    
    console.log('[AIService] Analyzing comments in', commentBatches.length, 'batches');

    if (commentBatches.length === 1) {
      // Single batch - analyze directly
      return await this.analyzeSingleBatch(commentBatches[0], config, promptTemplate, metadata);
    } else {
      // Multiple batches - analyze separately and merge
      const results = await Promise.all(
        commentBatches.map(batch => this.analyzeSingleBatch(batch, config, promptTemplate, metadata))
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
    }
  ): Promise<AnalysisResult> {
    const commentsJson = JSON.stringify(comments, null, 2);
    const prompt = this.buildAnalysisPromptWrapper(commentsJson, promptTemplate, metadata);

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

    // Rough estimation: 1 token ≈ 4 characters
    const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

    for (const comment of comments) {
      const commentTokens = estimateTokens(JSON.stringify(comment));
      
      // Reserve 50% of tokens for prompt and response
      if (currentTokens + commentTokens > maxTokens * 0.5) {
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
    const mergedMarkdown = results.map((r, i) => 
      `## Batch ${i + 1}\n\n${r.markdown}`
    ).join('\n\n---\n\n');

    const totalComments = results.reduce((sum, r) => sum + r.summary.totalComments, 0);
    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);

    // Merge sentiment distributions
    const sentimentDistribution = {
      positive: 0,
      negative: 0,
      neutral: 0,
    };

    results.forEach(r => {
      sentimentDistribution.positive += r.summary.sentimentDistribution.positive;
      sentimentDistribution.negative += r.summary.sentimentDistribution.negative;
      sentimentDistribution.neutral += r.summary.sentimentDistribution.neutral;
    });

    // Normalize percentages
    const total = sentimentDistribution.positive + sentimentDistribution.negative + sentimentDistribution.neutral;
    if (total > 0) {
      sentimentDistribution.positive = Math.round((sentimentDistribution.positive / total) * 100);
      sentimentDistribution.negative = Math.round((sentimentDistribution.negative / total) * 100);
      sentimentDistribution.neutral = 100 - sentimentDistribution.positive - sentimentDistribution.negative;
    }

    // Merge hot comments
    const allHotComments = results.flatMap(r => r.summary.hotComments);
    const hotComments = allHotComments.slice(0, 10); // Keep top 10

    // Merge key insights
    const keyInsights = results.flatMap(r => r.summary.keyInsights);

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
  private buildExtractionPromptWrapper(domContent: string): string {
    return buildExtractionPrompt(domContent);
  }

  /**
   * Build analysis prompt for AI (wrapper)
   * @param commentsJson - Comments in JSON format
   * @param template - Prompt template
   * @param metadata - Additional metadata
   * @returns Formatted prompt
   */
  private buildAnalysisPromptWrapper(
    commentsJson: string, 
    template: string,
    metadata?: {
      platform?: string;
      url?: string;
      title?: string;
      datetime?: string;
    }
  ): string {
    return buildAnalysisPrompt(commentsJson, template, {
      datetime: metadata?.datetime || new Date().toISOString(),
      platform: metadata?.platform || 'Unknown Platform',
      url: metadata?.url || 'N/A',
      title: metadata?.title || 'Untitled',
      totalComments: JSON.parse(commentsJson).length,
      language: this.currentLanguage,
    });
  }

  /**
   * Extract summary information from markdown
   * @param markdown - Markdown content
   * @param comments - Original comments
   * @returns Summary object
   */
  private extractSummaryFromMarkdown(markdown: string, comments: Comment[]): AnalysisResult['summary'] {
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
    return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
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
}

// Export singleton instance
export const aiService = new AIService();
