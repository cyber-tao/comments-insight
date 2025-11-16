import { Comment, Platform, AIExtractionResponse } from '../types';
import { DOMSimplifier } from './DOMSimplifier';
import { TIMING, SCROLL } from '@/config/constants';
import { PageController } from './PageController';

/**
 * Progressive Comment Extractor - Uses iterative AI-driven exploration
 */
export class CommentExtractorProgressive {
  private domSimplifier: DOMSimplifier;
  private maxIterations = 10;
  private currentIteration = 0;
  private initialDepth: number;
  private expandDepth: number;

  constructor(
    private pageController: PageController,
    options?: {
      initialDepth?: number;
      expandDepth?: number;
    },
  ) {
    this.domSimplifier = new DOMSimplifier();
    this.initialDepth = options?.initialDepth ?? 3;
    this.expandDepth = options?.expandDepth ?? 2;
  }

  /**
   * Extract comments using progressive AI-driven approach
   * @param maxComments - Maximum number of comments to extract
   * @param platform - Platform name
   * @param onProgress - Progress callback
   * @returns Array of comments
   */
  async extractWithAI(
    maxComments: number,
    platform: Platform,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<Comment[]> {
    Logger.info('[CommentExtractorProgressive] Starting progressive extraction');

    try {
      // Step 1: Wait for page to be ready (10%)
      onProgress?.(10, 'Waiting for page to load...');
      await this.pageController.waitForElement('body', 5000);
      await this.delay(TIMING.XL);

      // Step 2: Start progressive extraction (10-90%)
      onProgress?.(20, 'Starting AI-driven exploration...');
      const comments = await this.progressiveExtraction(platform, (iterProgress, msg) => {
        // Map iteration progress to 20-90%
        const overallProgress = 20 + iterProgress * 0.7;
        onProgress?.(overallProgress, msg);
      });

      // Step 3: Validate and clean (90%)
      onProgress?.(90, 'Validating extracted data...');
      const validComments = this.validateComments(comments, platform);

      // Step 4: Limit to maxComments (100%)
      onProgress?.(100, 'Extraction complete!');
      const limitedComments = validComments.slice(0, maxComments);

      Logger.info('[CommentExtractorProgressive] Extraction complete', { count: limitedComments.length });
      return limitedComments;
    } catch (error) {
      Logger.error('[CommentExtractorProgressive] Extraction failed', { error });
      throw error;
    }
  }

  /**
   * Progressive extraction - iteratively explore DOM with AI guidance
   */
  private async progressiveExtraction(
    platform: Platform,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<Comment[]> {
    const allComments: Comment[] = [];
    this.currentIteration = 0;

    // Start with simplified body structure using configured depth
    let currentDOM = this.domSimplifier.simplifyElement(document.body, this.initialDepth);

    while (this.currentIteration < this.maxIterations) {
      this.currentIteration++;
      const iterProgress = (this.currentIteration / this.maxIterations) * 100;

      Logger.info(
        `[CommentExtractorProgressive] Iteration ${this.currentIteration}/${this.maxIterations}`,
      );
      onProgress?.(iterProgress, `Exploring page structure (round ${this.currentIteration})...`);

      // Convert DOM to string for AI
      const domString = this.domSimplifier.nodeToString(currentDOM);

      // Build prompt for this iteration
      const prompt = this.buildProgressivePrompt(domString, this.currentIteration, platform);

      // Call AI
      const response = await this.callAIExtraction(prompt, platform);

      Logger.debug('[CommentExtractorProgressive] AI Response', {
        commentsFound: response.comments.length,
        nodesToExpand: response.nodesToExpand.length,
        needsScroll: response.needsScroll,
        completed: response.completed,
        analysis: response.analysis,
      });

      // Collect comments from this iteration
      if (response.comments.length > 0) {
        allComments.push(...response.comments);
        onProgress?.(
          iterProgress,
          `Found ${response.comments.length} comments (total: ${allComments.length})...`,
        );
      }

      // Check if completed
      if (response.completed) {
        Logger.info('[CommentExtractorProgressive] AI indicated extraction is complete');
        break;
      }

      // Handle scrolling if needed
      if (response.needsScroll) {
        onProgress?.(iterProgress, 'Scrolling to load more content...');
        await this.pageController.scrollToLoadMore(SCROLL.PROGRESSIVE_SCROLLS_PER_ITERATION);
        await this.delay(TIMING.XXL);

        // Re-simplify DOM after scroll using configured depth
        currentDOM = this.domSimplifier.simplifyElement(document.body, this.initialDepth);
        continue;
      }

      // Expand nodes as instructed by AI
      if (response.nodesToExpand.length > 0) {
        onProgress?.(iterProgress, `Expanding ${response.nodesToExpand.length} nodes...`);

        // Sort by priority (highest first)
        const sortedNodes = response.nodesToExpand.sort((a, b) => b.priority - a.priority);

        // Expand top priority nodes (limit to 5 per iteration to avoid token explosion)
        const nodesToExpand = sortedNodes.slice(0, 5);

        for (const nodeInfo of nodesToExpand) {
          Logger.info(
            `[CommentExtractorProgressive] Expanding: ${nodeInfo.selector} (${nodeInfo.reason})`,
          );

          const expanded = this.domSimplifier.expandNode(nodeInfo.selector, this.expandDepth);
          if (expanded) {
            currentDOM = this.domSimplifier.updateTreeWithExpanded(currentDOM, expanded);
          } else {
            Logger.warn('[CommentExtractorProgressive] Failed to expand', { selector: nodeInfo.selector });
          }
        }
      } else {
        // No nodes to expand and not completed - might be stuck
        Logger.warn('[CommentExtractorProgressive] No nodes to expand but not completed');
        break;
      }

      // Small delay between iterations
      await this.delay(TIMING.LG);
    }

    if (this.currentIteration >= this.maxIterations) {
      Logger.warn('[CommentExtractorProgressive] Reached max iterations');
    }

    return allComments;
  }

  /**
   * Build prompt for progressive extraction
   */
  private buildProgressivePrompt(domString: string, iteration: number, platform: Platform): string {
    return `You are a web scraping expert. Your task is to progressively explore a ${platform} webpage to find and extract comments.

## Current Iteration: ${iteration}

## Current DOM Structure:
\`\`\`html
${domString}
\`\`\`

## Your Task:
1. **Analyze** the structure to identify where comments might be located
2. **Extract** any comments you can see in the current view with complete information
3. **Decide** which nodes need to be expanded for further exploration (use CSS selectors)
4. **Determine** if we need to scroll to load more content
5. **Assess** if extraction is complete

## Response Format:
Return ONLY a valid JSON object (no markdown, no code blocks):
{
  "comments": [
    {
      "id": "unique_id",
      "username": "user_name",
      "timestamp": "time_string",
      "likes": 0,
      "content": "comment_text",
      "replies": []
    }
  ],
  "nodesToExpand": [
    {
      "selector": "css_selector",
      "reason": "why_expand_this",
      "priority": 10
    }
  ],
  "needsScroll": false,
  "completed": false,
  "analysis": "your reasoning about what you found and what to do next"
}

## Strategy:
- **Iteration 1-2**: Identify the main comment section container
- **Iteration 3-5**: Understand comment structure by expanding sample comments
- **Iteration 6+**: Extract all comments with the understood pattern
- Expand only the most promising nodes (priority 8-10)
- Stop when you've found all visible comments
- Request scroll if you see "load more" indicators or pagination
- Mark completed=true when no more comments can be found

## Important:
- Return ONLY valid JSON, no additional text
- Generate unique IDs for each comment
- Extract nested replies if present
- Be efficient - don't expand unnecessary nodes
- If you can extract comments from current view, do it!`;
  }

  /**
   * Call AI extraction via background service
   */
  private async callAIExtraction(
    prompt: string,
    platform: Platform,
  ): Promise<AIExtractionResponse> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'AI_EXTRACT_PROGRESSIVE',
          data: { prompt, platform },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (response.error) {
            reject(new Error(response.error));
            return;
          }

          resolve(response.data);
        },
      );
    });
  }

  /**
   * Validate and clean extracted comments
   */
  private validateComments(comments: Comment[], platform: Platform): Comment[] {
    const seen = new Set<string>();

    return comments
      .filter((comment) => {
        // Must have content
        if (!comment.content || comment.content.trim().length === 0) {
          return false;
        }

        // Must have username
        if (!comment.username || comment.username.trim().length === 0) {
          return false;
        }

        // Deduplicate by ID
        if (seen.has(comment.id)) {
          return false;
        }
        seen.add(comment.id);

        return true;
      })
      .map((comment) => ({
        ...comment,
        platform,
        likes: Math.max(0, comment.likes || 0),
        replies: comment.replies || [],
      }));
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
import { Logger } from '@/utils/logger';
