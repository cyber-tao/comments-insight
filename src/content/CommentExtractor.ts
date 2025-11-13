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
    console.log('[CommentExtractor] Starting AI-driven extraction');

    try {
      // Step 1: Analyze selectors first
      onProgress?.(10, 'Analyzing page structure with AI...');
      const selectorExtractor = new CommentExtractorSelector(this.pageController);
      const comments = await selectorExtractor.extractWithAI(
        maxComments,
        platform,
        (message: string, count: number) => onProgress?.(60, `${message} (${count})`),
      );

      // Step 3: Validate and finish
      onProgress?.(80, 'Validating extracted data...');
      const validComments = this.validateComments(comments, platform);
      const limitedComments = validComments.slice(0, maxComments);
      onProgress?.(100, 'Extraction complete!');
      console.log(
        '[CommentExtractor] Selector-based extraction complete:',
        limitedComments.length,
        'comments',
      );
      return limitedComments;
    } catch (error) {
      console.error(
        '[CommentExtractor] Selector-based extraction failed, trying DOM extraction:',
        error,
      );
      try {
        const domContent = this.domAnalyzer.analyzePage();
        onProgress?.(60, 'Extracting comments with AI (fallback)...');
        const comments = await this.callAIExtraction(domContent, platform);
        const validComments = this.validateComments(comments, platform);
        const limitedComments = validComments.slice(0, maxComments);
        onProgress?.(100, 'Extraction complete!');
        return limitedComments;
      } catch (err) {
        console.error('[CommentExtractor] Fallback AI extraction failed, using basic method:', err);
        onProgress?.(50, 'AI extraction failed, using fallback method...');
        return this.extract(maxComments);
      }
    }
  }

  /**
   * Call AI extraction via background service
   * @param prompt - Extraction prompt
   * @param platform - Platform name
   * @returns Extracted comments
   */
  private async callAIExtraction(domStructure: string, platform: Platform): Promise<Comment[]> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: MESSAGES.AI_EXTRACT_COMMENTS,
          data: { domStructure, platform },
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

          resolve(response.comments || []);
        },
      );
    });
  }

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
    console.log('[CommentExtractor] Starting extraction, max:', maxComments);

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

    console.log('[CommentExtractor] Extracted', comments.length, 'comments');

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
        console.warn('[CommentExtractor] Failed to parse comment:', error);
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
