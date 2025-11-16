import { Comment, Platform } from '../types';
import { DOMAnalyzer } from './DOMAnalyzer';
import { SELECTORS, TIMEOUT, MESSAGES } from '@/config/constants';
import { PageController } from './PageController';
import { CommentExtractorSelector } from './CommentExtractorSelector';

/**
 * CommentExtractor extracts comments from web pages
 */
export class CommentExtractor {
  constructor(
    private domAnalyzer: DOMAnalyzer,
    private pageController: PageController,
  ) {}

  /**
   * Extract comments using AI-driven approach
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
    Logger.info('[CommentExtractor] Starting config-driven extraction');
    const selectorExtractor = new CommentExtractorSelector(this.pageController);
    const cfgResponse = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage(
        { type: MESSAGES.CHECK_SCRAPER_CONFIG, payload: { url: window.location.href } },
        resolve,
      );
    });
    const config = cfgResponse?.config;
    if (!config || !config.selectors) {
      throw new Error('No scraper config for current page');
    }
    onProgress?.(20, 'Using scraper config');
    const comments = await selectorExtractor.extractWithConfig(
      config.selectors,
      config.scrollConfig,
      maxComments,
      platform,
      (message: string, count: number) => onProgress?.(60, `${message} (${count})`),
    );
    onProgress?.(80, 'Validating extracted data...');
    const validComments = this.validateComments(comments, platform);
    const limitedComments = validComments.slice(0, maxComments);
    onProgress?.(100, 'Extraction complete!');
    return limitedComments;
  }

  // AI 提取已移除，改为配置驱动

  /**
   * Validate and clean extracted comments
   * @param comments - Raw comments from AI
   * @param platform - Platform name
   * @returns Validated comments
   */
  private validateComments(comments: Comment[], platform: Platform): Comment[] {
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

        return true;
      })
      .map((comment) => ({
        ...comment,
        platform, // Ensure platform is set
        likes: Math.max(0, comment.likes || 0), // Ensure non-negative
        replies: comment.replies || [], // Ensure replies array exists
      }));
  }

  /**
   * Extract comments from current page
   * @param maxComments - Maximum number of comments to extract
   * @returns Array of comments
   */
  async extract(maxComments: number): Promise<Comment[]> {
    Logger.info('[CommentExtractor] Starting extraction', { maxComments });

    // Wait for comments section to load
    await this.pageController.waitForElement(
      SELECTORS.COMMON_COMMENT_CONTAINER,
      TIMEOUT.COMMENTS_SECTION_MS,
    );

    // Scroll to load more comments
    await this.pageController.scrollToLoadMore(3);

    // Try to expand replies (platform-specific selectors would be better)
    await this.pageController.expandReplies('[aria-label*="repl"], .show-replies, .load-replies');

    // Extract comments from DOM
    const comments = this.extractCommentsFromDOM();

    Logger.info('[CommentExtractor] Extracted comments', { count: comments.length });

    // Limit to maxComments
    return comments.slice(0, maxComments);
  }

  /**
   * Extract comments from DOM (simplified version)
   * In production, this would use AI to identify comment structure
   * @returns Array of comments
   */
  private extractCommentsFromDOM(): Comment[] {
    const comments: Comment[] = [];

    // Use Shadow DOM-aware query to find comment elements
    // This will traverse into Shadow DOM (e.g., Bilibili's bili-comments)
    const commentElements = this.domAnalyzer.querySelectorAllDeep(
      document,
      SELECTORS.COMMENT_ELEMENTS,
    );

    commentElements.forEach((element, index) => {
      try {
        const comment = this.parseCommentElement(element, index);
        if (comment) {
          comments.push(comment);
        }
      } catch (error) {
        Logger.warn('[CommentExtractor] Failed to parse comment', { error });
      }
    });

    return comments;
  }

  /**
   * Parse a single comment element
   * @param element - Comment element
   * @param index - Comment index
   * @returns Comment object or null
   */
  private parseCommentElement(element: Element, index: number): Comment | null {
    // This is a very basic parser
    // Real implementation would be platform-specific or AI-driven

    const textContent = element.textContent?.trim() || '';

    if (textContent.length === 0) {
      return null;
    }

    return {
      id: `comment_${index}_${Date.now()}`,
      username: 'User', // Would extract from element
      timestamp: new Date().toISOString(),
      likes: 0, // Would extract from element
      content: textContent.substring(0, 500), // Limit length
      replies: [],
    };
  }
}
import { Logger } from '@/utils/logger';
