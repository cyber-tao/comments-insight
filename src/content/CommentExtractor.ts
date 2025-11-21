import { Comment, Platform } from '../types';
import { MESSAGES } from '@/config/constants';
import { PageController } from './PageController';
import { CommentExtractorSelector } from './CommentExtractorSelector';
import { Logger } from '@/utils/logger';
import { ExtractionStrategy } from './strategies/ExtractionStrategy';
import { ConfigStrategy } from './strategies/ConfigStrategy';
import { AIStrategy } from './strategies/AIStrategy';

/**
 * CommentExtractor extracts comments from web pages
 * This class acts as a high-level coordinator using Strategy pattern
 */
export class CommentExtractor {
  constructor(private pageController: PageController) {}

  /**
   * Extract comments using configuration or AI discovery
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
    Logger.info('[CommentExtractor] Starting extraction');
    
    // Initialize the extraction engine
    const selectorExtractor = new CommentExtractorSelector(this.pageController);
    
    // Check for existing config to decide strategy
    const cfgResponse = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage(
        { type: MESSAGES.CHECK_SCRAPER_CONFIG, payload: { url: window.location.href } },
        resolve,
      );
    });
    
    const config = cfgResponse?.config;
    let strategy: ExtractionStrategy;

    if (config && config.selectors) {
      Logger.info('[CommentExtractor] Strategy: Config-based extraction');
      strategy = new ConfigStrategy(selectorExtractor, config);
    } else {
      Logger.info('[CommentExtractor] Strategy: AI Discovery extraction');
      strategy = new AIStrategy(selectorExtractor);
    }

    // Execute strategy
    const comments = await strategy.execute(
      maxComments, 
      platform, 
      onProgress
    );
      
    onProgress?.(80, 'Validating extracted data...');
    const validComments = this.validateComments(comments, platform);
    const limitedComments = validComments.slice(0, maxComments);
    onProgress?.(100, 'Extraction complete!');
    
    return limitedComments;
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
