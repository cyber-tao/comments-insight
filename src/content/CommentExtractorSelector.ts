import { Comment, Platform } from '../types';
import { PageController } from './PageController';

/**
 * Selector mapping returned by AI
 */
interface SelectorMap {
  commentContainer: string;
  commentItem: string;
  username: string;
  content: string;
  timestamp: string;
  likes: string;
  avatar?: string;
  replyContainer?: string;
  replyItem?: string;
}

/**
 * AI response structure
 */
interface AIAnalysisResponse {
  selectors: SelectorMap;
  structure: {
    hasReplies: boolean;
    repliesNested: boolean;
    needsExpand: boolean;
  };
  confidence: number;
}

/**
 * Selector-based Comment Extractor
 * One-time AI analysis to get selectors, then direct extraction
 */
export class CommentExtractorSelector {
  constructor(private pageController: PageController) {}

  /**
   * Extract comments using selector-based approach
   */
  async extractWithAI(
    maxComments: number,
    platform: Platform,
    onProgress?: (message: string, count: number) => void
  ): Promise<Comment[]> {
    console.log('[CommentExtractorSelector] Starting selector-based extraction');
    
    try {
      // Step 1: Analyze page structure with AI (with retry)
      const analysis = await this.analyzePage(platform, onProgress);
      
      console.log('[CommentExtractorSelector] AI Analysis:', analysis);
      
      if (analysis.confidence < 0.5) {
        throw new Error('Low confidence in structure analysis');
      }
      
      // Step 2: Extract comments with scrolling
      const comments = await this.extractWithScrolling(
        analysis.selectors,
        analysis.structure,
        maxComments,
        platform,
        onProgress
      );
      
      onProgress?.('✅ Extraction complete!', comments.length);
      console.log('[CommentExtractorSelector] Extraction complete:', comments.length, 'comments');
      
      return comments;
      
    } catch (error) {
      console.error('[CommentExtractorSelector] Extraction failed:', error);
      throw error;
    }
  }

  /**
   * Analyze page structure with AI to get selectors (with retry)
   */
  private async analyzePage(
    platform: Platform,
    onProgress?: (message: string, count: number) => void
  ): Promise<AIAnalysisResponse> {
    // Get retry attempts from settings
    const settings = await this.getSettings();
    const maxRetries = settings?.selectorRetryAttempts || 3;
    
    // Extract simplified DOM structure
    const domStructure = this.extractDOMStructure(document.body);
    
    console.log('[CommentExtractorSelector] DOM Structure length:', domStructure.length);
    console.log('[CommentExtractorSelector] DOM Structure preview:', domStructure.substring(0, 500));
    
    let lastError = '';
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      onProgress?.(`🔍 Analyzing page structure (attempt ${attempt}/${maxRetries})...`, 0);
      
      // Build prompt (include previous error if retrying)
      const prompt = this.buildAnalysisPrompt(domStructure, platform, lastError);
      
      // Call AI
      const response = await this.callAI(prompt);
      
      console.log(`[CommentExtractorSelector] Attempt ${attempt}: AI returned selectors:`, response.selectors);
      
      // Validate selectors by testing them
      const testResult = this.testSelectors(response.selectors);
      console.log(`[CommentExtractorSelector] Attempt ${attempt}: Selector test results:`, testResult);
      
      // Check if selectors are valid
      const isValid = this.validateSelectorResults(testResult);
      
      if (isValid) {
        console.log(`[CommentExtractorSelector] Selectors validated successfully on attempt ${attempt}`);
        onProgress?.('✅ Page structure analyzed successfully', 0);
        return response;
      }
      
      // Build error message for next attempt
      lastError = this.buildValidationError(testResult);
      console.warn(`[CommentExtractorSelector] Attempt ${attempt} failed:`, lastError);
      
      if (attempt < maxRetries) {
        onProgress?.(`⚠️ Retrying analysis (${attempt}/${maxRetries})...`, 0);
        await this.delay(1000); // Wait before retry
      }
    }
    
    // All attempts failed, but return the last response anyway
    console.error('[CommentExtractorSelector] All validation attempts failed, using last response');
    onProgress?.('⚠️ Using best-effort selectors', 0);
    
    const finalPrompt = this.buildAnalysisPrompt(domStructure, platform, lastError);
    return await this.callAI(finalPrompt);
  }
  
  /**
   * Get settings from storage
   */
  private async getSettings(): Promise<any> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
        resolve(response?.settings || null);
      });
    });
  }
  
  /**
   * Validate selector test results
   */
  private validateSelectorResults(testResult: Record<string, number>): boolean {
    // Must find at least one comment item
    if (!testResult.commentItem || testResult.commentItem === 0) {
      return false;
    }
    
    // Must find username and content
    if (!testResult.username || testResult.username === 0) {
      return false;
    }
    
    if (!testResult.content || testResult.content === 0) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Build validation error message
   */
  private buildValidationError(testResult: Record<string, number>): string {
    const errors: string[] = [];
    
    if (!testResult.commentItem || testResult.commentItem === 0) {
      errors.push('commentItem selector found 0 elements');
    }
    
    if (!testResult.username || testResult.username === 0) {
      errors.push('username selector found 0 elements');
    }
    
    if (!testResult.content || testResult.content === 0) {
      errors.push('content selector found 0 elements');
    }
    
    if (testResult.timestamp === 0) {
      errors.push('timestamp selector found 0 elements (optional but recommended)');
    }
    
    return errors.join('; ');
  }

  /**
   * Extract simplified DOM structure (only tags, ids, classes)
   */
  private extractDOMStructure(element: Element, depth: number = 0, maxDepth: number = 20): string {
    // Limit depth to avoid huge output
    if (depth > maxDepth) {
      return '';
    }
    
    const tag = element.tagName.toLowerCase();
    let html = '  '.repeat(depth) + `<${tag}`;
    
    // Add id
    if (element.id) {
      html += ` id="${element.id}"`;
    }
    
    // Add classes
    const classes = this.getClasses(element);
    if (classes && classes.length > 0) {
      html += ` class="${classes.join(' ')}"`;
    }
    
    // Check if element has text content (but no children)
    const hasChildren = element.children.length > 0;
    if (!hasChildren && element.textContent && element.textContent.trim()) {
      html += '>...</' + tag + '>\n';
      return html;
    }
    
    html += '>\n';
    
    // Add children
    if (hasChildren) {
      // Limit number of children to show (sample first 20)
      const childrenToShow = Array.from(element.children).slice(0, 20);
      for (const child of childrenToShow) {
        html += this.extractDOMStructure(child, depth + 1, maxDepth);
      }
      
      if (element.children.length > 20) {
        html += '  '.repeat(depth + 1) + `<!-- ... ${element.children.length - 20} more children -->\n`;
      }
    }
    
    html += '  '.repeat(depth) + `</${tag}>\n`;
    
    return html;
  }

  /**
   * Test selectors to see if they find elements
   */
  private testSelectors(selectors: SelectorMap): Record<string, number> {
    const results: Record<string, number> = {};
    
    for (const [key, selector] of Object.entries(selectors)) {
      if (selector) {
        try {
          const elements = document.querySelectorAll(selector);
          results[key] = elements.length;
        } catch (error) {
          results[key] = -1; // Invalid selector
        }
      }
    }
    
    return results;
  }

  /**
   * Get classes from element
   */
  private getClasses(element: Element): string[] | null {
    try {
      if (element.classList && element.classList.length > 0) {
        return Array.from(element.classList);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Build analysis prompt for AI
   */
  private buildAnalysisPrompt(domStructure: string, platform: Platform, previousError?: string): string {
    const errorSection = previousError ? `

## Previous Attempt Failed:
${previousError}

Please analyze the structure more carefully and provide different, more accurate selectors.` : '';

    return `You are a web scraping expert. Analyze this ${platform} page structure and provide CSS selectors for extracting comments.${errorSection}

## DOM Structure:
\`\`\`html
${domStructure.substring(0, 15000)}
\`\`\`

## Task:
Identify the comment section and provide CSS selectors for each field.

## Response Format (strict JSON, no markdown):
{
  "selectors": {
    "commentContainer": "css_selector_for_comment_list_container",
    "commentItem": "css_selector_for_each_comment_item",
    "username": "css_selector_for_username_relative_to_item",
    "content": "css_selector_for_content_relative_to_item",
    "timestamp": "css_selector_for_time_relative_to_item",
    "likes": "css_selector_for_likes_relative_to_item",
    "avatar": "css_selector_for_avatar_relative_to_item",
    "replyContainer": "css_selector_for_reply_container_relative_to_item",
    "replyItem": "css_selector_for_each_reply_item"
  },
  "structure": {
    "hasReplies": true,
    "repliesNested": true,
    "needsExpand": false
  },
  "confidence": 0.95
}

## Important Rules:
- Return ONLY valid JSON, no markdown code blocks
- Selectors for username/content/timestamp/likes should be relative to commentItem
- Use specific selectors (prefer class/id over generic tags)
- For nested replies, replyItem selector should be relative to replyContainer
- Set confidence between 0.0-1.0 based on how certain you are
- If no replies exist, set hasReplies to false and omit reply selectors`;
  }

  /**
   * Extract comments with scrolling
   */
  private async extractWithScrolling(
    selectors: SelectorMap,
    _structure: any,
    maxComments: number,
    platform: Platform,
    onProgress?: (message: string, count: number) => void
  ): Promise<Comment[]> {
    const allComments: Comment[] = [];
    const seenIds = new Set<string>();
    let noNewCommentsCount = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 20;
    
    while (allComments.length < maxComments && scrollAttempts < maxScrollAttempts) {
      // Extract current visible comments
      onProgress?.('📥 Extracting comments...', allComments.length);
      const newComments = this.extractCommentsBySelector(selectors, platform);
      
      // Deduplicate and respect maxComments limit
      let addedCount = 0;
      for (const comment of newComments) {
        // Stop if we've reached the limit
        if (allComments.length >= maxComments) {
          break;
        }
        
        if (!seenIds.has(comment.id)) {
          seenIds.add(comment.id);
          allComments.push(comment);
          addedCount++;
        }
      }
      
      console.log(`[CommentExtractorSelector] Extracted ${addedCount} new comments (total: ${allComments.length})`);
      
      // Check if we got new comments
      if (addedCount === 0) {
        noNewCommentsCount++;
        if (noNewCommentsCount >= 3) {
          console.log('[CommentExtractorSelector] No new comments after 3 attempts, stopping');
          break;
        }
      } else {
        noNewCommentsCount = 0;
      }
      
      // Check if we have enough
      if (allComments.length >= maxComments) {
        break;
      }
      
      // Scroll to load more
      onProgress?.('⬇️ Scrolling for more...', allComments.length);
      await this.pageController.scrollToBottom();
      await this.delay(1500); // Wait for content to load
      
      scrollAttempts++;
    }
    
    return allComments.slice(0, maxComments);
  }

  /**
   * Extract comments by selector
   */
  private extractCommentsBySelector(selectors: SelectorMap, platform: Platform): Comment[] {
    const comments: Comment[] = [];
    
    try {
      const items = document.querySelectorAll(selectors.commentItem);
      console.log(`[CommentExtractorSelector] Found ${items.length} comment items with selector: ${selectors.commentItem}`);
      
      items.forEach((item, index) => {
        try {
          const comment = this.extractSingleComment(item, selectors, platform, index);
          if (comment) {
            comments.push(comment);
          }
        } catch (error) {
          console.warn('[CommentExtractorSelector] Failed to extract comment:', error);
        }
      });
      
    } catch (error) {
      console.error('[CommentExtractorSelector] Failed to query comments:', error);
    }
    
    return comments;
  }

  /**
   * Extract single comment from element
   */
  private extractSingleComment(
    item: Element,
    selectors: SelectorMap,
    platform: Platform,
    index: number
  ): Comment | null {
    // Extract username
    const usernameEl = item.querySelector(selectors.username);
    const username = usernameEl?.textContent?.trim() || '';
    
    // Extract content
    const contentEl = item.querySelector(selectors.content);
    const content = contentEl?.textContent?.trim() || '';
    
    // Must have content
    if (!content) {
      return null;
    }
    
    // Extract timestamp
    const timestampEl = item.querySelector(selectors.timestamp);
    const timestamp = timestampEl?.textContent?.trim() || '';
    
    // Extract likes
    const likesEl = item.querySelector(selectors.likes);
    const likes = this.parseLikes(likesEl?.textContent?.trim() || '0');
    
    // Extract avatar
    let avatar: string | undefined;
    if (selectors.avatar) {
      const avatarEl = item.querySelector(selectors.avatar);
      if (avatarEl) {
        avatar = avatarEl.getAttribute('src') || avatarEl.getAttribute('data-src') || undefined;
      }
    }
    
    // Extract replies
    const replies = this.extractReplies(item, selectors, platform);
    
    // Generate ID
    const id = this.generateCommentId(username, content, timestamp, index);
    
    return {
      id,
      username: username || 'Anonymous',
      content,
      timestamp,
      likes,
      avatar,
      replies,
      platform,
    };
  }

  /**
   * Extract replies from comment
   */
  private extractReplies(
    commentItem: Element,
    selectors: SelectorMap,
    platform: Platform
  ): Comment[] {
    if (!selectors.replyItem) {
      return [];
    }
    
    const replies: Comment[] = [];
    
    try {
      const replyItems = commentItem.querySelectorAll(selectors.replyItem);
      
      replyItems.forEach((replyItem, index) => {
        const reply = this.extractSingleComment(replyItem, selectors, platform, index);
        if (reply) {
          replies.push(reply);
        }
      });
      
    } catch (error) {
      console.warn('[CommentExtractorSelector] Failed to extract replies:', error);
    }
    
    return replies;
  }

  /**
   * Parse likes count from text
   */
  private parseLikes(text: string): number {
    if (!text) return 0;
    
    // Remove non-numeric characters except K, M, k, m
    const cleaned = text.replace(/[^0-9KMkm.]/g, '');
    
    // Handle K (thousands)
    if (cleaned.includes('K') || cleaned.includes('k')) {
      return Math.floor(parseFloat(cleaned) * 1000);
    }
    
    // Handle M (millions)
    if (cleaned.includes('M') || cleaned.includes('m')) {
      return Math.floor(parseFloat(cleaned) * 1000000);
    }
    
    // Parse as number
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Generate unique comment ID
   */
  private generateCommentId(username: string, content: string, timestamp: string, index: number): string {
    const hash = this.simpleHash(username + content + timestamp);
    return `comment_${hash}_${index}_${Date.now()}`;
  }

  /**
   * Simple hash function
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Call AI service
   */
  private async callAI(prompt: string): Promise<AIAnalysisResponse> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'AI_ANALYZE_STRUCTURE',
          data: { prompt }
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
        }
      );
    });
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
