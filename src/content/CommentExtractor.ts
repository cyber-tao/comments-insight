import { Comment, Platform } from '../types';
import { DOMAnalyzer } from './DOMAnalyzer';
import { PageController } from './PageController';
import { buildExtractionPrompt } from '../utils/prompts';

/**
 * CommentExtractor extracts comments from web pages
 */
export class CommentExtractor {
  constructor(
    private domAnalyzer: DOMAnalyzer,
    private pageController: PageController
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
    onProgress?: (progress: number, message: string) => void
  ): Promise<Comment[]> {
    console.log('[CommentExtractor] Starting AI-driven extraction');
    
    try {
      // Step 1: Wait for comments section (10%)
      onProgress?.(10, 'Waiting for comments section...');
      await this.pageController.waitForElement('[role="article"], .comment, .reply', 5000);
      
      // Step 2: Scroll to load more comments (30%)
      onProgress?.(30, 'Loading more comments...');
      await this.pageController.scrollToLoadMore(3);
      
      // Step 3: Expand replies (40%)
      onProgress?.(40, 'Expanding replies...');
      await this.pageController.expandReplies('[aria-label*="repl"], .show-replies, .load-replies');
      
      // Step 4: Analyze DOM structure (50%)
      onProgress?.(50, 'Analyzing page structure...');
      const domContent = this.domAnalyzer.analyzePage();
      
      // Step 5: Build AI prompt (60%)
      onProgress?.(60, 'Preparing AI extraction...');
      const prompt = buildExtractionPrompt(domContent);
      
      // Step 6: Call AI service via background (70%)
      onProgress?.(70, 'Extracting comments with AI...');
      const comments = await this.callAIExtraction(prompt, platform);
      
      // Step 7: Validate and clean data (90%)
      onProgress?.(90, 'Validating extracted data...');
      const validComments = this.validateComments(comments, platform);
      
      // Step 8: Limit to maxComments (100%)
      onProgress?.(100, 'Extraction complete!');
      const limitedComments = validComments.slice(0, maxComments);
      
      console.log('[CommentExtractor] AI extraction complete:', limitedComments.length, 'comments');
      return limitedComments;
      
    } catch (error) {
      console.error('[CommentExtractor] AI extraction failed:', error);
      // Fallback to basic extraction
      onProgress?.(50, 'AI extraction failed, using fallback method...');
      return this.extract(maxComments);
    }
  }

  /**
   * Call AI extraction via background service
   * @param prompt - Extraction prompt
   * @param platform - Platform name
   * @returns Extracted comments
   */
  private async callAIExtraction(prompt: string, platform: Platform): Promise<Comment[]> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'AI_EXTRACT_COMMENTS',
          data: { prompt, platform }
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
        }
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
      .filter(comment => {
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
      .map(comment => ({
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
    await this.pageController.waitForElement('[role="article"], .comment, .reply', 5000);
    
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
    
    // This is a simplified extraction
    // Real implementation would use AI to identify comment elements
    const commentElements = document.querySelectorAll(
      '[role="article"], .comment, .ytd-comment-thread-renderer, .reply-item'
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
      platform: 'unknown',
    };
  }
}
