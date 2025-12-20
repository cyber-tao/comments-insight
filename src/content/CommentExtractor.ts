import { Comment, Platform } from '../types';
import { PageController } from './PageController';
import { Logger } from '@/utils/logger';
import { AIStrategy } from './strategies/AIStrategy';
import type { ProgressCallback } from './strategies/ExtractionStrategy';

/**
 * CommentExtractor extracts comments from web pages using AI-powered strategies.
 *
 * This class acts as a high-level coordinator using the Strategy pattern,
 * delegating the actual extraction work to specialized strategies (e.g., AIStrategy).
 *
 * Features:
 * - AI-powered comment detection and extraction
 * - Automatic validation and deduplication
 * - Progress reporting for UI feedback
 * - Resource cleanup after extraction
 *
 * @example
 * ```typescript
 * const extractor = new CommentExtractor(pageController);
 * const comments = await extractor.extractWithAI(100, 'youtube.com', (progress, msg) => {
 *   console.log(`${progress}%: ${msg}`);
 * });
 * ```
 */
export class CommentExtractor {
  /**
   * Creates a new CommentExtractor instance.
   * @param pageController - PageController for DOM interactions
   */
  constructor(private pageController: PageController) {}

  /**
   * Extracts comments from the current page using AI-powered discovery.
   *
   * This method uses AI to detect comment sections and extract structured
   * comment data, including usernames, timestamps, likes, and content.
   *
   * @param maxComments - Maximum number of comments to extract
   * @param platform - Platform identifier (e.g., 'youtube.com', 'reddit.com')
   * @param onProgress - Optional callback for progress updates
   * @returns Promise resolving to an array of validated comments
   * @throws {ExtensionError} When extraction fails or is cancelled
   *
   * @example
   * ```typescript
   * const comments = await extractor.extractWithAI(
   *   100,
   *   'youtube.com',
   *   (progress, message, stage, current, total) => {
   *     updateUI({ progress, message, stage, current, total });
   *   }
   * );
   * ```
   */
  async extractWithAI(
    maxComments: number,
    platform: Platform,
    onProgress?: ProgressCallback,
  ): Promise<Comment[]> {
    Logger.info('[CommentExtractor] Starting pure AI extraction');

    // Always use AI Strategy
    const strategy = new AIStrategy(this.pageController);

    try {
      // Execute strategy
      const comments = await strategy.execute(maxComments, platform, onProgress);

      onProgress?.(80, 'validating');
      const validComments = this.validateComments(comments, platform);
      const limitedComments = validComments.slice(0, maxComments);
      onProgress?.(100, 'complete');

      return limitedComments;
    } finally {
      // 确保清理策略资源
      strategy.cleanup();
    }
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
}
