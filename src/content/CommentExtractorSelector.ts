import { Comment, Platform, SelectorMap } from '../types';
import { DOM } from '@/config/constants';
import { MESSAGES, TIMING, SCROLL } from '@/config/constants';
import { PageController } from './PageController';
import { ScrollConfig } from '../types/scraper';
import { Logger } from '@/utils/logger';

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
  async extractWithDiscovery(
    maxComments: number,
    platform: Platform,
    onProgress?: (message: string, count: number) => void,
  ): Promise<Comment[]> {
    Logger.info('[CommentExtractorSelector] Starting selector-based extraction');

    try {
      // Step 1: Analyze page structure with AI (with retry)
      const analysis = await this.analyzePage(platform, onProgress);

      Logger.debug('[CommentExtractorSelector] AI Analysis', { analysis });

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
      Logger.info('[CommentExtractorSelector] Extraction complete', { count: comments.length });

      return comments;
    } catch (error) {
      Logger.error('[CommentExtractorSelector] Extraction failed', { error });
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
      Logger.info('[CommentExtractorSelector] Using cached selectors', { domain });
      onProgress?.('✅ Using cached selectors', 0);

      // Test cached selectors
      const testResult = this.testSelectors(cachedSelectors);
      const isValid = this.validateSelectorResults(testResult);

      if (isValid) {
        Logger.info('[CommentExtractorSelector] Cached selectors are still valid');
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
        Logger.warn('[CommentExtractorSelector] Cached selectors are no longer valid, analyzing again');
      }
    }

    // Get retry attempts from settings
    const settings = await this.getSettings();
    const maxRetries = settings?.selectorRetryAttempts || 3;
    const analysisDepth = settings?.domAnalysisConfig?.maxDepth ?? DOM.SIMPLIFY_MAX_DEPTH;
    const domStructure = this.extractDOMStructureForComments(analysisDepth);
    const maxModelTokens = settings?.aiModel?.maxTokens ?? 4000;
    const chunks = this.chunkDomStructure(domStructure, maxModelTokens);

    Logger.debug('[CommentExtractorSelector] DOM Structure length', { length: domStructure.length });
    Logger.debug('[CommentExtractorSelector] DOM Structure preview', { preview: domStructure.substring(0, 500) });

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
    "commentContainer": "selector_for_container_holding_one_comment_and_its_replies",
    "commentItem": "selector_for_comment_body_inside_container",
    "replyToggle": "selector_for_expand_replies_button_inside_container_or_null",
    "replyContainer": "selector_for_block_that_holds_replies_inside_container_or_null",
    "replyItem": "selector_for_each_reply_inside_reply_container_or_null",
    "username": "selector_for_username_relative_to_comment_item",
    "content": "selector_for_content_relative_to_comment_item",
    "timestamp": "selector_for_timestamp_relative_to_comment_item",
    "likes": "selector_for_likes_relative_to_comment_item"
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
    Logger.warn('[CommentExtractorSelector] Max retries reached, using best-effort selectors');
    Logger.warn('[CommentExtractorSelector] Successful selectors', { selectors: Object.keys(successfulSelectors) });
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

    Logger.info('[CommentExtractorSelector] Saved selector cache', { domain });
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

    const appendChildren = (nodes: Element[], indentDepth: number) => {
      if (nodes.length === 0) {
        return;
      }

      let nodesToShow: Element[];
      if (nodes.length <= 30) {
        nodesToShow = nodes;
      } else {
        const first10 = nodes.slice(0, 10);
        const middle10 = nodes.slice(
          Math.floor(nodes.length / 2) - 5,
          Math.floor(nodes.length / 2) + 5,
        );
        const last10 = nodes.slice(-10);
        nodesToShow = [...first10, ...middle10, ...last10];

        html +=
          '  '.repeat(indentDepth) +
          `<!-- Showing 30 of ${nodes.length} nodes (sampled from start, middle, end) -->\n`;
      }

      for (const child of nodesToShow) {
        html += this.extractDOMStructure(child, indentDepth, maxDepth);
      }
    };

    // Add light DOM children
    if (hasChildren) {
      const children = Array.from(element.children) as Element[];
      appendChildren(children, depth + 1);
    }

    // Add shadow DOM children if present
    const shadowRoot = (element as any).shadowRoot as ShadowRoot | null;
    if (shadowRoot && shadowRoot.children.length > 0) {
      const shadowChildren = Array.from(shadowRoot.children) as Element[];
      html += '  '.repeat(depth + 1) + '<shadow-root>\n';
      appendChildren(shadowChildren, depth + 2);
      html += '  '.repeat(depth + 1) + '</shadow-root>\n';
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
          const elements = this.querySelectorAllDeep(document, selector);
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
  ): Promise<number> {
    try {
      let totalExpanded = 0;

      if (!selectors.commentContainer || !selectors.replyToggle) {
        return 0;
      }

      const containers = this.querySelectorAllDeep(document, selectors.commentContainer);
      
      // Collect all valid toggle buttons first
      const buttonsToClick: HTMLElement[] = [];
      for (const container of containers) {
        const toggles = this.querySelectorAllDeep(container, selectors.replyToggle);
        for (const toggle of toggles) {
          const button = toggle as HTMLElement;
          // Check visibility more loosely - if it has dimensions, it's likely visible
          // Also check if it's not hidden/none
          const style = window.getComputedStyle(button);
          const isVisible = 
            style.display !== 'none' && 
            style.visibility !== 'hidden' && 
            (button.offsetParent !== null || button.getBoundingClientRect().height > 0);

          if (isVisible) {
             buttonsToClick.push(button);
          }
        }
      }

      if (buttonsToClick.length === 0) {
        return 0;
      }

      onProgress?.(`🔽 Found ${buttonsToClick.length} replies to expand...`, containers.length);
      Logger.info('[CommentExtractorSelector] Found reply toggles', { count: buttonsToClick.length });
      
      // Process buttons sequentially with scrolling
      const baseDelay = scrollCfg?.scrollDelay ? Math.min(scrollCfg.scrollDelay, TIMING.EXPAND_REPLY_MAX) : TIMING.LG;

      for (let i = 0; i < buttonsToClick.length; i++) {
        const button = buttonsToClick[i];
        
        // Skip if button is no longer in document
        if (!document.contains(button)) continue;

        try {
          // Scroll button into view to trigger lazy loading and ensure visibility
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Wait for scroll
          await this.delay(TIMING.MD);

          // Simulate full click sequence
          const clickOpts = { bubbles: true, cancelable: true, view: window };
          button.dispatchEvent(new MouseEvent('mousedown', clickOpts));
          button.dispatchEvent(new MouseEvent('mouseup', clickOpts));
          button.click();
          
          totalExpanded++;
          
          // Report progress
          if (i > 0 && i % SCROLL.REPLY_EXPAND_REPORT_INTERVAL === 0) {
             onProgress?.(`🔽 Expanding replies... ${i}/${buttonsToClick.length}`, totalExpanded);
          }

          // Wait for content expansion
          await this.delay(baseDelay);
        } catch (error) {
          Logger.warn('[CommentExtractorSelector] Failed to click reply toggle button', { error });
        }
      }

      if (totalExpanded > 0) {
        // Final wait to ensure last expansions render
        await this.delay(TIMING.XL);
        Logger.info('[CommentExtractorSelector] Total reply expansion completed', { totalExpanded });
      }

      return totalExpanded;
    } catch (error) {
      Logger.error('[CommentExtractorSelector] Error expanding replies', { error });
      return 0;
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
      // Expand more frequently: every time we scroll (attempt 0) or every 3rd scroll
      if (scrollAttempts === 0 || scrollAttempts % SCROLL.REPLY_EXPAND_SCROLL_FREQUENCY === 0) {
        const expandedCount = await this.expandReplies(selectors, onProgress, scrollCfg);
        
        // If replies were expanded, wait a bit for content to render
        if (expandedCount > 0) {
           // No need to scroll to bottom here as expandReplies already scrolled us around
           // Just wait for any final rendering
           await this.delay(TIMING.LG);
        }
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

      Logger.info('[CommentExtractorSelector] Extracted new comments', { addedCount, total: allComments.length });

      // Check if we got new comments
      if (addedCount === 0) {
        noNewCommentsCount++;
        if (noNewCommentsCount >= 3) {
          Logger.info('[CommentExtractorSelector] No new comments after 3 attempts, stopping');
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

  async extractWithConfig(
    selectors: SelectorMap,
    scrollCfg: ScrollConfig | undefined,
    maxComments: number,
    platform: Platform,
    onProgress?: (message: string, count: number) => void,
  ): Promise<Comment[]> {
    const selectorTestResults = this.testSelectors(selectors);
    this.logSelectorMatches('Pre-extraction selector test', selectors, selectorTestResults);

    // 按配置提取一次，不进行 AI 重试
    const comments = await this.extractWithScrolling(selectors, {}, maxComments, platform, onProgress, scrollCfg);

    // 根据实际提取结果标注 selector 成功/失败
    const metrics: Record<string, number> = {
      commentContainer: selectors.commentContainer
        ? this.querySelectorAllDeep(document, selectors.commentContainer).length
        : 0,
      commentItem: comments.length,
      username: comments.filter((c) => c.username && c.username.trim().length > 0).length,
      content: comments.filter((c) => c.content && c.content.trim().length > 0).length,
      timestamp: comments.filter((c) => !!c.timestamp).length,
      likes: comments.filter((c) => (c.likes || 0) > 0).length,
      replyItem: comments.reduce((acc, c) => acc + (c.replies ? c.replies.length : 0), 0),
    };

    const configId = await this.getActiveConfigIdSafe();
    this.logExtractionMetrics(metrics, configId);

    if (configId) {
      const allKeys = Object.keys(selectors);
      const measuredKeys = new Set(Object.keys(metrics));
      const optionalKeys = new Set(['replyToggle', 'replyContainer', 'postTitle', 'videoTime', 'replyItem']);
      for (const key of allKeys) {
        const selectorValue = (selectors as any)[key];
        if (!selectorValue) {
          continue;
        }
        let isValid: boolean;
        if (optionalKeys.has(key)) {
          const count = selectorTestResults[key];
          isValid = typeof count === 'number' ? count >= 0 : true;
        } else if (measuredKeys.has(key)) {
          isValid = (metrics[key] || 0) > 0;
        } else {
          const count = selectorTestResults[key];
          isValid = typeof count === 'number' ? count > 0 : false;
        }
        const status: 'success' | 'failed' = isValid ? 'success' : 'failed';
        await new Promise<void>((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: MESSAGES.UPDATE_SELECTOR_VALIDATION,
              payload: { configId, selectorKey: key, status },
            },
            () => resolve(),
          );
        });
      }
    } else {
      Logger.warn('[CommentExtractorSelector] Unable to update selector validation without configId');
    }

    return comments;
  }

  private async getActiveConfigIdSafe(): Promise<string | undefined> {
    try {
      const url = window.location.href;
      const resp = await new Promise<any>((resolve) => {
        chrome.runtime.sendMessage(
          { type: MESSAGES.CHECK_SCRAPER_CONFIG, payload: { url } },
          resolve,
        );
      });
      return resp?.config?.id;
    } catch {
      return undefined;
    }
  }

  /**
   * Extract comments by selector
   */
  private extractCommentsBySelector(selectors: SelectorMap, platform: Platform): Comment[] {
    const comments: Comment[] = [];

    if (!selectors.commentContainer || !selectors.commentItem) {
      return comments;
    }

    try {
      const containers = this.querySelectorAllDeep(document, selectors.commentContainer);
      Logger.info('[CommentExtractorSelector] Found comment containers', {
        count: containers.length,
        selector: selectors.commentContainer,
      });

      containers.forEach((container, containerIndex) => {
        const items = this.querySelectorAllDeep(container, selectors.commentItem);
        items.forEach((item, itemIndex) => {
          try {
            const comment = this.extractSingleComment(
              container,
              item,
              selectors,
              platform,
              containerIndex * 1000 + itemIndex,
            );
            if (comment) {
              comments.push(comment);
            }
          } catch (error) {
            Logger.warn('[CommentExtractorSelector] Failed to extract comment', { error });
          }
        });
      });
    } catch (error) {
      Logger.error('[CommentExtractorSelector] Failed to query comments', { error });
    }

    return comments;
  }

  /**
   * Extract single comment from element
   */
  private extractSingleComment(
    container: Element,
    item: Element,
    selectors: SelectorMap,
    platform: Platform,
    index: number,
  ): Comment | null {
    // Extract username
    const usernameEl = selectors.username
      ? this.querySelectorDeep(item, selectors.username)
      : null;
    const username = (usernameEl as HTMLElement)?.innerText?.trim() || '';

    // Extract content
    const contentEl = selectors.content ? this.querySelectorDeep(item, selectors.content) : null;
    const content = (contentEl as HTMLElement)?.innerText?.trim() || '';

    // Must have content
    if (!content) {
      return null;
    }

    // Extract timestamp
    const timestampEl = selectors.timestamp
      ? this.querySelectorDeep(item, selectors.timestamp)
      : null;
    const timestamp = (timestampEl as HTMLElement)?.innerText?.trim() || '';

    // Extract likes
    const likesEl = selectors.likes ? this.querySelectorDeep(item, selectors.likes) : null;
    const likes = this.parseLikes((likesEl as HTMLElement)?.innerText?.trim() || '0');

    // Extract replies
    const replies = this.extractReplies(container, selectors, platform);

    // Generate ID
    const id = this.generateCommentId(username, content, timestamp, index);

    return {
      id,
      username: username || 'Anonymous',
      content,
      timestamp,
      likes,
      replies,
    };
  }

  /**
   * Extract replies from comment
   */
  private extractReplies(
    commentContainer: Element,
    selectors: SelectorMap,
    platform: Platform,
  ): Comment[] {
    if (!selectors.replyContainer || !selectors.replyItem) {
      return [];
    }

    const replies: Comment[] = [];
    const replyContainerSelector = selectors.replyContainer;
    const replyItemSelector = selectors.replyItem;

    try {
      const replyContainers = this.querySelectorAllDeep(commentContainer, replyContainerSelector);

      replyContainers.forEach((container) => {
        const replyItems = this.querySelectorAllDeep(container, replyItemSelector);

        replyItems.forEach((replyItem, index) => {
          const reply = this.extractSingleComment(container, replyItem, selectors, platform, index);
          if (reply) {
            replies.push(reply);
          }
        });
      });
    } catch (error) {
      Logger.warn('[CommentExtractorSelector] Failed to extract replies', { error });
    }

    return replies;
  }

  /**
   * Parse likes count from text
   */
  private parseLikes(text: string): number {
    if (!text) return 0;

    // Remove non-numeric characters except K, M, k, m, 万, 亿
    const cleaned = text.replace(/[^0-9KMkm万亿.]/g, '');

    // Handle Chinese units
    if (cleaned.includes('亿')) {
      return Math.floor(parseFloat(cleaned) * 100000000);
    }
    if (cleaned.includes('万')) {
      return Math.floor(parseFloat(cleaned) * 10000);
    }

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
    index: number,
  ): string {
    // Use content hash + index as primary ID to avoid duplicates and collisions
    const hash = this.simpleHash(username + content + timestamp + index);
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
        Logger.info('[CommentExtractorSelector] No config found for validation update');
        return;
      }

      const configId = configResponse.config.id;

      // Test each selector individually to determine its status
      const testResults = this.testSelectors(selectors);

      // Update validation status for each selector based on test results
      const optionalKeys = new Set(['replyToggle', 'replyContainer', 'postTitle', 'videoTime', 'replyItem']);
      for (const [key, value] of Object.entries(selectors)) {
        if (value) {
          const count = typeof testResults[key] === 'number' ? testResults[key] : 0;
          const status: 'success' | 'failed' = optionalKeys.has(key)
            ? (count === -1 ? 'failed' : 'success')
            : (count > 0 ? 'success' : 'failed');

          await new Promise<void>((resolve) => {
            chrome.runtime.sendMessage(
              {
                type: MESSAGES.UPDATE_SELECTOR_VALIDATION,
                payload: { configId, selectorKey: key, status, count },
              },
              () => resolve(),
            );
          });

          Logger.info('[CommentExtractorSelector] Selector status', { key, status, count });
        }
      }

      Logger.info('[CommentExtractorSelector] Updated selector validation for config', { configId });
    } catch (error) {
      Logger.warn('[CommentExtractorSelector] Failed to update selector validation', { error });
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

  private querySelectorAllDeep(
    root: Document | Element | ShadowRoot,
    selector: string,
  ): Element[] {
    const trimmedSelector = selector.trim();
    if (!trimmedSelector) {
      return [];
    }

    const results: Element[] = [];
    try {
      results.push(...Array.from(root.querySelectorAll(trimmedSelector)));
    } catch {
      // ignore invalid selectors
    }

    if (root instanceof Element && root.shadowRoot) {
      results.push(...this.querySelectorAllDeep(root.shadowRoot, trimmedSelector));
    }

    const split = this.splitSelector(trimmedSelector);
    if (split.rest) {
      let candidates: NodeListOf<Element> = [] as any;
      try {
        candidates = root.querySelectorAll(split.current);
      } catch {
        candidates = [] as any;
      }

      for (const candidate of Array.from(candidates)) {
        results.push(...this.querySelectorAllDeep(candidate, split.rest));
        const shadowRoot = (candidate as any).shadowRoot as ShadowRoot | null;
        if (shadowRoot) {
          results.push(...this.querySelectorAllDeep(shadowRoot, split.rest));
        }
      }
    }

    const descendants = root.querySelectorAll('*');
    for (const el of Array.from(descendants)) {
      const shadowRoot = (el as any).shadowRoot as ShadowRoot | undefined;
      if (shadowRoot) {
        results.push(...this.querySelectorAllDeep(shadowRoot, trimmedSelector));
      }
    }

    return Array.from(new Set(results));
  }

  private querySelectorDeep(
    root: Document | Element | ShadowRoot,
    selector: string,
  ): Element | null {
    const trimmedSelector = selector.trim();
    if (!trimmedSelector) {
      return null;
    }

    let directHit: Element | null = null;
    try {
      directHit = root.querySelector(trimmedSelector);
    } catch {
      directHit = null;
    }
    if (directHit) {
      return directHit;
    }

    const split = this.splitSelector(trimmedSelector);
    if (split.rest) {
      let candidates: NodeListOf<Element> = [] as any;
      try {
        candidates = root.querySelectorAll(split.current);
      } catch {
        candidates = [] as any;
      }

      for (const candidate of Array.from(candidates)) {
        const fromLightDom = this.querySelectorDeep(candidate, split.rest);
        if (fromLightDom) {
          return fromLightDom;
        }

        const shadowRoot = (candidate as any).shadowRoot as ShadowRoot | null;
        if (shadowRoot) {
          const fromShadow = this.querySelectorDeep(shadowRoot, split.rest);
          if (fromShadow) {
            return fromShadow;
          }
        }
      }
    }

    if (root instanceof Element && root.shadowRoot) {
      const fromCurrentShadow = this.querySelectorDeep(root.shadowRoot, trimmedSelector);
      if (fromCurrentShadow) {
        return fromCurrentShadow;
      }
    }

    const descendants = root.querySelectorAll('*');
    for (const el of Array.from(descendants)) {
      const shadowRoot = (el as any).shadowRoot as ShadowRoot | undefined;
      if (shadowRoot) {
        const shadowMatch = this.querySelectorDeep(shadowRoot, trimmedSelector);
        if (shadowMatch) {
          return shadowMatch;
        }
      }
    }

    return null;
  }

  private splitSelector(selector: string): { current: string; rest?: string } {
    const trimmed = selector.trim();
    let inAttr = false;
    let parenDepth = 0;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (char === '[') {
        inAttr = true;
        continue;
      }
      if (char === ']') {
        inAttr = false;
        continue;
      }
      if (char === '(') {
        parenDepth++;
        continue;
      }
      if (char === ')') {
        parenDepth = Math.max(parenDepth - 1, 0);
        continue;
      }

      if (inAttr || parenDepth > 0) {
        continue;
      }

      if (char === '>' || char === ' ') {
        let nextIndex = i + 1;
        while (nextIndex < trimmed.length && trimmed[nextIndex] === ' ') {
          nextIndex++;
        }

        const current = trimmed.substring(0, i).trim();
        const rest = trimmed.substring(nextIndex).trim();
        if (current && rest) {
          return { current, rest };
        }
      }
    }

    return { current: trimmed };
  }

  private logSelectorMatches(
    title: string,
    selectors: Partial<SelectorMap>,
    counts: Record<string, number>,
  ): void {
    Logger.info('[CommentExtractorSelector] Selector test', { title });
    for (const [key, selector] of Object.entries(selectors)) {
      if (!selector) continue;
      const count = counts[key] ?? 0;
      const status = count === -1 ? 'invalid' : count > 0 ? 'success' : 'failed';
      Logger.info('[CommentExtractorSelector] Selector test item', { key, selector, count, status });
    }
  }

  private logExtractionMetrics(metrics: Record<string, number>, configId?: string): void {
    const label = configId ? `config ${configId}` : undefined;
    Logger.info('[CommentExtractorSelector] Extraction metrics', { label });
    for (const [key, value] of Object.entries(metrics)) {
      Logger.info('[CommentExtractorSelector] Metric', { key, value });
    }
  }
}
