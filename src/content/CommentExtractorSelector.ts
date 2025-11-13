import { Comment, Platform, SelectorMap } from '../types';
import { DOM } from '@/config/constants';
import { REGEX } from '@/config/constants';
import { MESSAGES, TIMING, SCROLL } from '@/config/constants';
import { PageController } from './PageController';
import { ScrollConfig } from '../types/scraper';

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
    onProgress?: (message: string, count: number) => void,
  ): Promise<Comment[]> {
    console.log('[CommentExtractorSelector] Starting selector-based extraction');

    try {
      // Step 1: Analyze page structure with AI (with retry)
      const analysis = await this.analyzePage(platform, onProgress);

      console.log('[CommentExtractorSelector] AI Analysis:', analysis);

      if (analysis.confidence < 0.5) {
        throw new Error('Low confidence in structure analysis');
      }

      // Load scroll config for current URL
      const url = window.location.href;
      const cfgResponse = await new Promise<any>((resolve) => {
        chrome.runtime.sendMessage(
          { type: MESSAGES.CHECK_SCRAPER_CONFIG, payload: { url } },
          resolve,
        );
      });
      const scrollCfg: ScrollConfig | undefined = cfgResponse?.config?.scrollConfig;

      // Step 2: Extract comments with scrolling
      const comments = await this.extractWithScrolling(
        analysis.selectors,
        analysis.structure,
        maxComments,
        platform,
        onProgress,
        scrollCfg,
      );

      // Step 3: Update selector validation status based on extraction results
      await this.updateSelectorValidation(analysis.selectors, comments.length > 0);

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
    onProgress?: (message: string, count: number) => void,
  ): Promise<AIAnalysisResponse> {
    // Get current domain
    const domain = this.getDomain();

    // Check if we have cached selectors for this domain
    const cachedSelectors = await this.getCachedSelectors(domain, platform);

    if (cachedSelectors) {
      console.log('[CommentExtractorSelector] Using cached selectors for', domain);
      onProgress?.('✅ Using cached selectors', 0);

      // Test cached selectors
      const testResult = this.testSelectors(cachedSelectors);
      const isValid = this.validateSelectorResults(testResult);

      if (isValid) {
        console.log('[CommentExtractorSelector] Cached selectors are still valid');
        // Update last used time
        await this.updateSelectorCacheUsage(domain, platform);

        return {
          selectors: cachedSelectors,
          structure: {
            hasReplies: !!cachedSelectors.replyItem,
            repliesNested: true,
            needsExpand: false,
          },
          confidence: 1.0,
        };
      } else {
        console.warn(
          '[CommentExtractorSelector] Cached selectors are no longer valid, analyzing again',
        );
      }
    }

    // Get retry attempts from settings
    const settings = await this.getSettings();
    const maxRetries = settings?.selectorRetryAttempts || 3;
    const analysisDepth = settings?.domAnalysisConfig?.maxDepth ?? DOM.SIMPLIFY_MAX_DEPTH;
    const domStructure = this.extractDOMStructureForComments(analysisDepth);
    const maxModelTokens = settings?.analyzerModel?.maxTokens ?? 4000;
    const chunks = this.chunkDomStructure(domStructure, maxModelTokens);

    console.log('[CommentExtractorSelector] DOM Structure length:', domStructure.length);
    console.log(
      '[CommentExtractorSelector] DOM Structure preview:',
      domStructure.substring(0, 500),
    );

    let successfulSelectors: Partial<SelectorMap> = {};
    let lastError = '';
    let lastResponse: AIAnalysisResponse | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      onProgress?.(`🔍 Analyzing page structure (attempt ${attempt}/${maxRetries})...`, 0);

      const successfulInfo =
        Object.keys(successfulSelectors).length > 0
          ? `\n\n## Previous Successful Selectors (KEEP THESE):\n${JSON.stringify(successfulSelectors, null, 2)}\n\n## Only provide selectors for these missing fields:\n${this.getMissingFields(successfulSelectors).join(', ')}`
          : '';
      const errorInfo = lastError
        ? `\n\n## Previous Attempt Failed:\n${lastError}\n\nPlease analyze more carefully and provide different, more accurate selectors.`
        : '';

      // Paginate large DOM structure and aggregate
      let aggregatedSelectors: Partial<SelectorMap> = { ...successfulSelectors };
      let aggregatedStructure = { hasReplies: false, repliesNested: true, needsExpand: false };
      let aggregatedConfidence = 0.0;

      for (let i = 0; i < chunks.length; i++) {
        const header = `Part ${i + 1}/${chunks.length}`;
        const prompt = `You are a web scraping expert. Analyze this page structure (${header}, domain: ${platform}) and provide CSS selectors for extracting comments.${successfulInfo}${errorInfo}

## DOM Structure (partial):
\`\`\`html
${chunks[i]}
\`\`\`

## Task:
Identify the comment section and provide CSS selectors for each field.

## Response Format (STRICT JSON ONLY, NO MARKDOWN):
{
  "selectors": {
    "commentContainer": "css_selector_for_comment_list_container",
    "commentItem": "css_selector_for_each_comment_item",
    "username": "css_selector_for_username_relative_to_item",
    "content": "css_selector_for_content_relative_to_item",
    "timestamp": "css_selector_for_time_relative_to_item",
    "likes": "css_selector_for_likes_relative_to_item",
    "avatar": "css_selector_for_avatar_relative_to_item",
    "replyToggle": "css_selector_for_show_more_replies_button",
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

## CRITICAL RULES:
- Return ONLY valid JSON, NO markdown code blocks, NO explanations
- Start your response with { and end with }
- Selectors for username/content/timestamp/likes should be relative to commentItem
- Use specific selectors (prefer class/id over generic tags)
- For nested replies, replyItem selector should be relative to replyContainer
- Set confidence between 0.0-1.0 based on certainty`;

        const response = await this.callAI(prompt);
        lastResponse = response;
        const partSelectors = response?.selectors || {};
        aggregatedSelectors = { ...aggregatedSelectors, ...partSelectors };
        if (response?.structure) aggregatedStructure = response.structure;
        if (typeof response?.confidence === 'number') {
          aggregatedConfidence = Math.max(aggregatedConfidence, response.confidence);
        }
      }

      // Validate aggregated selectors
      const testResult = this.testSelectors(aggregatedSelectors);
      const { successful, failed } = this.categorizeSelectors(aggregatedSelectors, testResult);
      successfulSelectors = successful;

      const isValid = this.validateSelectorResults(testResult);
      if (isValid) {
        onProgress?.('✅ Page structure analyzed successfully', 0);
        await this.saveSelectorCache(domain, platform, successfulSelectors as SelectorMap);
        return {
          selectors: successfulSelectors as SelectorMap,
          structure: aggregatedStructure,
          confidence: aggregatedConfidence || 0.8,
        };
      }

      lastError = this.buildValidationError(testResult);
      if (attempt < maxRetries) {
        onProgress?.(
          `⚠️ Retrying analysis for ${failed.length} failed selectors (${attempt}/${maxRetries})...`,
          0,
        );
        await this.delay(1000);
      }
    }

    // All attempts exhausted, return what we have
    console.warn('[CommentExtractorSelector] Max retries reached, using best-effort selectors');
    console.warn(
      '[CommentExtractorSelector] Successful selectors:',
      Object.keys(successfulSelectors),
    );
    onProgress?.('⚠️ Using partial selectors', 0);

    return {
      selectors: successfulSelectors as SelectorMap,
      structure: lastResponse?.structure || {
        hasReplies: !!successfulSelectors.replyItem,
        repliesNested: true,
        needsExpand: false,
      },
      confidence: Object.keys(successfulSelectors).length >= 6 ? 0.7 : 0.3,
    };
  }

  /**
   * Get settings from storage
   */
  private async getSettings(): Promise<any> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS }, (response) => {
        resolve(response?.settings || null);
      });
    });
  }

  /**
   * Get current domain
   */
  private getDomain(): string {
    return window.location.hostname;
  }

  /**
   * Get cached selectors for domain
   */
  private async getCachedSelectors(
    domain: string,
    platform: Platform,
  ): Promise<SelectorMap | null> {
    const settings = await this.getSettings();
    if (!settings?.selectorCache) {
      return null;
    }

    const cached = settings.selectorCache.find(
      (cache: any) => cache.domain === domain && cache.platform === platform,
    );

    return cached ? cached.selectors : null;
  }

  /**
   * Save selector cache
   */
  private async saveSelectorCache(
    domain: string,
    platform: Platform,
    selectors: SelectorMap,
  ): Promise<void> {
    const settings = await this.getSettings();
    if (!settings) return;

    const selectorCache = settings.selectorCache || [];

    // Check if cache already exists for this domain
    const existingIndex = selectorCache.findIndex(
      (cache: any) => cache.domain === domain && cache.platform === platform,
    );

    if (existingIndex >= 0) {
      // Update existing cache
      selectorCache[existingIndex] = {
        domain,
        platform,
        selectors,
        lastUsed: Date.now(),
        successCount: selectorCache[existingIndex].successCount + 1,
      };
    } else {
      // Add new cache
      selectorCache.push({
        domain,
        platform,
        selectors,
        lastUsed: Date.now(),
        successCount: 1,
      });
    }

    // Save updated settings
    await new Promise<void>((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: MESSAGES.SAVE_SETTINGS,
          payload: { settings: { ...settings, selectorCache } },
        },
        () => resolve(),
      );
    });

    console.log('[CommentExtractorSelector] Saved selector cache for', domain);
  }

  /**
   * Update selector cache usage
   */
  private async updateSelectorCacheUsage(domain: string, platform: Platform): Promise<void> {
    const settings = await this.getSettings();
    if (!settings?.selectorCache) return;

    const selectorCache = settings.selectorCache;
    const existingIndex = selectorCache.findIndex(
      (cache: any) => cache.domain === domain && cache.platform === platform,
    );

    if (existingIndex >= 0) {
      selectorCache[existingIndex].lastUsed = Date.now();
      selectorCache[existingIndex].successCount++;

      // Save updated settings
      await new Promise<void>((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: MESSAGES.SAVE_SETTINGS,
            payload: { settings: { ...settings, selectorCache } },
          },
          () => resolve(),
        );
      });
    }
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
   * Extract DOM structure focused on comment section
   */
  private extractDOMStructureForComments(maxDepth: number): string {
    const root = document.body || document.documentElement;
    return this.extractDOMStructure(root, 0, maxDepth);
  }

  private chunkDomStructure(structure: string, maxTokens: number): string[] {
    const reserveRatio = 0.4; // align with AI.TOKEN_RESERVE_RATIO
    const limit = Math.max(100, Math.floor(maxTokens * (1 - reserveRatio)));
    const estimate = (text: string): number => {
      const cleaned = text.replace(/\s+/g, ' ').trim();
      const words = cleaned ? cleaned.split(/\s+/).length : 0;
      const punct = (cleaned.match(/[,.!?;:]/g) || []).length;
      const chars = cleaned.length;
      const approx = Math.ceil(words * 0.75 + punct * 0.25 + chars / 10);
      return Math.max(1, approx);
    };
    const parts: string[] = [];
    let current: string[] = [];
    let tokens = 0;
    for (const line of structure.split('\n')) {
      const t = estimate(line) + 1;
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
    return parts;
  }

  /**
   * Extract DOM structure with smart sampling to capture different parts of the page
   */

  /**
   * Extract simplified DOM structure (only tags, ids, classes)
   */
  private extractDOMStructure(element: any, depth: number = 0, maxDepth: number = 20): string {
    // Limit depth to avoid huge output
    if (depth > maxDepth) {
      return '';
    }

    // Handle DocumentFragment (Shadow DOM root) - it doesn't have tagName
    if (!element.tagName) {
      let html = '';
      if (element.children) {
        const children = Array.from(element.children) as Element[];
        for (const child of children) {
          html += this.extractDOMStructure(child, depth, maxDepth);
        }
      }
      return html;
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
      const children = Array.from(element.children) as Element[];

      // Smart sampling: if many children, sample from beginning, middle, and end
      let childrenToShow: Element[];
      if (children.length <= 30) {
        childrenToShow = children;
      } else {
        // Sample: first 10, middle 10, last 10
        const first10 = children.slice(0, 10);
        const middle10 = children.slice(
          Math.floor(children.length / 2) - 5,
          Math.floor(children.length / 2) + 5,
        );
        const last10 = children.slice(-10);
        childrenToShow = [...first10, ...middle10, ...last10];

        html +=
          '  '.repeat(depth + 1) +
          `<!-- Showing 30 of ${children.length} children (sampled from start, middle, end) -->\n`;
      }

      for (const child of childrenToShow) {
        html += this.extractDOMStructure(child, depth + 1, maxDepth);
      }
    }

    html += '  '.repeat(depth) + `</${tag}>\n`;

    return html;
  }

  /**
   * Test selectors to see if they find elements
   */
  private testSelectors(selectors: Partial<SelectorMap>): Record<string, number> {
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
   * Categorize selectors into successful and failed
   */
  private categorizeSelectors(
    selectors: Partial<SelectorMap>,
    testResults: Record<string, number>,
  ): { successful: Partial<SelectorMap>; failed: string[] } {
    const successful: Partial<SelectorMap> = {};
    const failed: string[] = [];

    const requiredFields = [
      'commentContainer',
      'commentItem',
      'username',
      'content',
      'timestamp',
      'likes',
    ];

    for (const [key, selector] of Object.entries(selectors)) {
      if (!selector) continue;

      const count = testResults[key] || 0;

      // For required fields, need at least 1 element
      if (requiredFields.includes(key)) {
        if (count > 0) {
          successful[key as keyof SelectorMap] = selector;
        } else {
          failed.push(key);
        }
      } else {
        // Optional fields are considered successful even if not found
        successful[key as keyof SelectorMap] = selector;
      }
    }

    return { successful, failed };
  }

  /**
   * Get missing required fields
   */
  private getMissingFields(selectors: Partial<SelectorMap>): string[] {
    const requiredFields = [
      'commentContainer',
      'commentItem',
      'username',
      'content',
      'timestamp',
      'likes',
    ];
    const missing: string[] = [];

    for (const field of requiredFields) {
      if (!selectors[field as keyof SelectorMap]) {
        missing.push(field);
      }
    }

    return missing;
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
   * Expand reply sections
   */
  private async expandReplies(
    selectors: SelectorMap,
    onProgress?: (message: string, count: number) => void,
    scrollCfg?: ScrollConfig,
  ): Promise<void> {
    try {
      let totalExpanded = 0;

      // Step 1: Click "Reply" buttons to show reply sections
      if (selectors.replyButton) {
        onProgress?.('💬 Opening reply sections...', 0);
        const replyButtons = document.querySelectorAll(selectors.replyButton);
        console.log(`[CommentExtractorSelector] Found ${replyButtons.length} reply buttons`);

        let clickedReplyButtons = 0;
        for (let i = 0; i < replyButtons.length; i++) {
          const button = replyButtons[i] as HTMLElement;

          // Check if button is visible and clickable
          if (button.offsetParent !== null && !button.hasAttribute('aria-pressed')) {
            try {
              button.click();
              clickedReplyButtons++;

              // Wait a bit for reply section to appear
              if (i % 5 === 0) {
                await this.delay(scrollCfg?.scrollDelay || TIMING.SM);
                onProgress?.(
                  `💬 Opening reply sections... (${clickedReplyButtons}/${replyButtons.length})`,
                  0,
                );
              }
            } catch (error) {
              console.warn('[CommentExtractorSelector] Failed to click reply button:', error);
            }
          }
        }

        // Wait for reply sections to load
        await this.delay(scrollCfg?.scrollDelay || TIMING.LG);
        console.log(`[CommentExtractorSelector] Clicked ${clickedReplyButtons} reply buttons`);
      }

      // Step 2: Click "Show more replies" buttons to expand collapsed replies
      if (selectors.replyToggle) {
        onProgress?.('🔽 Expanding replies...', 0);

        // Re-query for reply toggle buttons (they might have appeared after clicking reply buttons)
        const replyToggleButtons = document.querySelectorAll(selectors.replyToggle);
        console.log(
          `[CommentExtractorSelector] Found ${replyToggleButtons.length} reply toggle buttons`,
        );

        let expandedCount = 0;
        for (let i = 0; i < replyToggleButtons.length; i++) {
          const button = replyToggleButtons[i] as HTMLElement;

          // Check if button is visible and clickable
          if (button.offsetParent !== null) {
            try {
              button.click();
              expandedCount++;
              totalExpanded++;

              // Wait a bit for replies to load
              if (i % 5 === 0) {
                await this.delay(scrollCfg?.scrollDelay || TIMING.MD);
                onProgress?.(
                  `🔽 Expanding replies... (${expandedCount}/${replyToggleButtons.length})`,
                  0,
                );
              }
            } catch (error) {
              console.warn(
                '[CommentExtractorSelector] Failed to click reply toggle button:',
                error,
              );
            }
          }
        }

        console.log(`[CommentExtractorSelector] Expanded ${expandedCount} reply toggle buttons`);
      }

      // Final wait for all replies to load
      if (totalExpanded > 0) {
        await this.delay(scrollCfg?.scrollDelay || TIMING.XL);
      }

      console.log(`[CommentExtractorSelector] Total reply expansion completed`);
    } catch (error) {
      console.error('[CommentExtractorSelector] Error expanding replies:', error);
    }
  }

  /**
   * Extract comments with scrolling
   */
  private async extractWithScrolling(
    selectors: SelectorMap,
    _structure: any,
    maxComments: number,
    platform: Platform,
    onProgress?: (message: string, count: number) => void,
    scrollCfg?: ScrollConfig,
  ): Promise<Comment[]> {
    const allComments: Comment[] = [];
    const seenIds = new Set<string>();
    let noNewCommentsCount = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = scrollCfg?.enabled
      ? scrollCfg.maxScrolls || SCROLL.SELECTOR_MAX_SCROLL_ATTEMPTS
      : SCROLL.SELECTOR_MAX_SCROLL_ATTEMPTS;

    while (allComments.length < maxComments && scrollAttempts < maxScrollAttempts) {
      // Expand replies before extracting
      if (scrollAttempts === 0 || scrollAttempts % 5 === 0) {
        await this.expandReplies(selectors, onProgress, scrollCfg);
      }

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

      console.log(
        `[CommentExtractorSelector] Extracted ${addedCount} new comments (total: ${allComments.length})`,
      );

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
      await this.delay(scrollCfg?.scrollDelay || TIMING.XXL);

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
      console.log(
        `[CommentExtractorSelector] Found ${items.length} comment items with selector: ${selectors.commentItem}`,
      );

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
    index: number,
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
    };
  }

  /**
   * Extract replies from comment
   */
  private extractReplies(
    commentItem: Element,
    selectors: SelectorMap,
    platform: Platform,
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
    const cleaned = text.replace(REGEX.LIKES_SANITIZE, '');

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
  private generateCommentId(
    username: string,
    content: string,
    timestamp: string,
    _index: number,
  ): string {
    // Use content hash as primary ID to avoid duplicates
    // Don't use Date.now() as it changes every time
    const hash = this.simpleHash(username + content + timestamp);
    return `comment_${hash}`;
  }

  /**
   * Simple hash function
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Update selector validation status
   */
  private async updateSelectorValidation(selectors: SelectorMap, _success: boolean): Promise<void> {
    try {
      // Get current URL to find matching config
      const url = window.location.href;

      // Request config ID from background
      const configResponse = await new Promise<any>((resolve) => {
        chrome.runtime.sendMessage(
          { type: MESSAGES.CHECK_SCRAPER_CONFIG, payload: { url } },
          resolve,
        );
      });

      if (!configResponse?.config?.id) {
        console.log('[CommentExtractorSelector] No config found for validation update');
        return;
      }

      const configId = configResponse.config.id;

      // Test each selector individually to determine its status
      const testResults = this.testSelectors(selectors);

      // Update validation status for each selector based on test results
      for (const [key, value] of Object.entries(selectors)) {
        if (value) {
          const count = testResults[key] || 0;
          let status: 'success' | 'failed';

          // Required fields must have at least 1 element
          const requiredFields = [
            'commentContainer',
            'commentItem',
            'username',
            'content',
            'timestamp',
            'likes',
          ];
          if (requiredFields.includes(key)) {
            status = count > 0 ? 'success' : 'failed';
          } else {
            // Optional fields: if selector exists and finds elements, it's success
            // If selector exists but finds no elements, it's failed (selector might be wrong)
            // This helps identify if optional selectors like replyToggle are working
            status = count > 0 ? 'success' : 'failed';
          }

          await new Promise<void>((resolve) => {
            chrome.runtime.sendMessage(
              {
                type: MESSAGES.UPDATE_SELECTOR_VALIDATION,
                payload: { configId, selectorKey: key, status },
              },
              () => resolve(),
            );
          });

          console.log(
            `[CommentExtractorSelector] Selector ${key}: ${status} (found ${count} elements)`,
          );
        }
      }

      console.log('[CommentExtractorSelector] Updated selector validation for config:', configId);
    } catch (error) {
      console.error('[CommentExtractorSelector] Failed to update selector validation:', error);
    }
  }

  /**
   * Call AI service
   */
  private async callAI(prompt: string): Promise<AIAnalysisResponse> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: MESSAGES.AI_ANALYZE_STRUCTURE,
          data: { prompt },
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
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
