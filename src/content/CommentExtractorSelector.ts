import { Comment, Platform, SelectorMap } from '../types';
import { DOM, AI, RETRY, MESSAGES, TIMING, SCROLL } from '@/config/constants';
import { PageController } from './PageController';
import { ScrollConfig, ScraperConfig } from '../types/scraper';
import { Logger } from '@/utils/logger';
import { Tokenizer } from '@/utils/tokenizer';
import { getShadowRoot, querySelectorAllDeep } from '@/utils/dom-query';
import { sendMessage, sendMessageVoid } from '@/utils/chrome-message';
import { performanceMonitor } from '@/utils/performance';
import { selectorValidator, selectorCacheManager, commentParser } from './extractors';

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

    return performanceMonitor.measureAsync(
      'extractWithDiscovery',
      async () => {
        const analysis = await performanceMonitor.measureAsync(
          'analyzePage',
          () => this.analyzePage(platform, onProgress),
          { platform },
        );

        Logger.debug('[CommentExtractorSelector] AI Analysis', { analysis });

        if (analysis.confidence < AI.CONFIDENCE_THRESHOLD) {
          throw new Error('Low confidence in structure analysis');
        }

        const url = window.location.href;
        const cfgResponse = await sendMessage<{ config?: ScraperConfig }>({
          type: MESSAGES.CHECK_SCRAPER_CONFIG,
          payload: { url },
        });
        const scrollCfg: ScrollConfig | undefined = cfgResponse?.config?.scrollConfig;

        const comments = await performanceMonitor.measureAsync(
          'extractWithScrolling',
          () =>
            this.extractWithScrolling(
              analysis.selectors,
              analysis.structure,
              maxComments,
              platform,
              onProgress,
              scrollCfg,
            ),
          { platform, maxComments },
        );

        await this.updateSelectorValidation(analysis.selectors, comments.length > 0);

        onProgress?.('complete', comments.length);
        Logger.info('[CommentExtractorSelector] Extraction complete', { count: comments.length });

        performanceMonitor.logSummary();

        return comments;
      },
      { platform, maxComments },
    );
  }

  /**
   * Analyze page structure with AI to get selectors (with retry)
   */
  private async analyzePage(
    platform: Platform,
    onProgress?: (message: string, count: number) => void,
  ): Promise<AIAnalysisResponse> {
    const domain = selectorCacheManager.getDomain();

    const cachedSelectors = await selectorCacheManager.getCachedSelectors(domain, platform);

    if (cachedSelectors) {
      Logger.info('[CommentExtractorSelector] Using cached selectors', { domain });
      onProgress?.('analyzing', -1);

      const testResult = selectorValidator.testSelectors(cachedSelectors);
      const isValid = selectorValidator.validateSelectorResults(testResult);

      if (isValid) {
        Logger.info('[CommentExtractorSelector] Cached selectors are still valid');
        await selectorCacheManager.updateSelectorCacheUsage(domain, platform);

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
        Logger.warn(
          '[CommentExtractorSelector] Cached selectors are no longer valid, analyzing again',
        );
      }
    }

    const settings = await selectorCacheManager.getSettings();
    const maxRetries = settings?.selectorRetryAttempts || RETRY.SELECTOR_ATTEMPTS;
    const analysisDepth = settings?.domAnalysisConfig?.maxDepth ?? DOM.SIMPLIFY_MAX_DEPTH;
    const domStructure = this.extractDOMStructureForComments(analysisDepth);
    const maxModelTokens = settings?.aiModel?.maxTokens ?? AI.DEFAULT_MAX_TOKENS;
    const chunks = this.chunkDomStructure(domStructure, maxModelTokens);

    Logger.debug('[CommentExtractorSelector] DOM Structure length', {
      length: domStructure.length,
    });
    // Logger.debug('[CommentExtractorSelector] DOM Structure preview', { preview: domStructure.substring(0, 500) });

    let successfulSelectors: Partial<SelectorMap> = {};
    let lastError = '';
    let lastResponse: AIAnalysisResponse | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      onProgress?.('analyzing', -1);

      const successfulInfo =
        Object.keys(successfulSelectors).length > 0
          ? `\n\n## Previous Successful Selectors (KEEP THESE):\n${JSON.stringify(successfulSelectors, null, 2)}\n\n## Only provide selectors for these missing fields:\n${selectorValidator.getMissingFields(successfulSelectors).join(', ')}`
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

      const testResult = selectorValidator.testSelectors(aggregatedSelectors);
      const { successful } = selectorValidator.categorizeSelectors(aggregatedSelectors, testResult);
      successfulSelectors = successful;

      const isValid = selectorValidator.validateSelectorResults(testResult);
      if (isValid) {
        onProgress?.('analyzing', -1);
        await selectorCacheManager.saveSelectorCache(
          domain,
          platform,
          successfulSelectors as SelectorMap,
        );
        return {
          selectors: successfulSelectors as SelectorMap,
          structure: aggregatedStructure,
          confidence: aggregatedConfidence || AI.DEFAULT_CONFIDENCE,
        };
      }

      lastError = selectorValidator.buildValidationError(testResult);
      if (attempt < maxRetries) {
        onProgress?.('analyzing', -1);
        await this.delay(TIMING.AI_RETRY_DELAY_MS);
      }
    }

    Logger.warn('[CommentExtractorSelector] Max retries reached, using best-effort selectors');
    Logger.warn('[CommentExtractorSelector] Successful selectors', {
      selectors: Object.keys(successfulSelectors),
    });
    onProgress?.('analyzing', -1);

    return {
      selectors: successfulSelectors as SelectorMap,
      structure: lastResponse?.structure || {
        hasReplies: !!successfulSelectors.replyItem,
        repliesNested: true,
        needsExpand: false,
      },
      confidence:
        Object.keys(successfulSelectors).length >= 6
          ? AI.HIGH_CONFIDENCE_THRESHOLD
          : AI.LOW_CONFIDENCE_THRESHOLD,
    };
  }

  /**
   * Extract DOM structure focused on comment section
   */
  private extractDOMStructureForComments(maxDepth: number): string {
    const root = document.body || document.documentElement;
    return this.extractDOMStructure(root, 0, maxDepth);
  }

  private chunkDomStructure(structure: string, maxTokens: number): string[] {
    return Tokenizer.chunkText(structure, maxTokens);
  }

  /**
   * Extract DOM structure with smart sampling to capture different parts of the page
   */

  /**
   * Extract simplified DOM structure (only tags, ids, classes)
   */
  private extractDOMStructure(
    element: Element | DocumentFragment,
    depth: number = 0,
    maxDepth: number = 20,
  ): string {
    // Limit depth to avoid huge output
    if (depth > maxDepth) {
      return '';
    }

    // Handle DocumentFragment (Shadow DOM root) - it doesn't have tagName
    if (!(element instanceof Element)) {
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
    const shadowRoot = getShadowRoot(element as Element);
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
    currentCommentCount: number,
    onProgress?: (message: string, count: number) => void,
    scrollCfg?: ScrollConfig,
  ): Promise<number> {
    try {
      let totalExpanded = 0;

      if (!selectors.commentContainer || !selectors.replyToggle) {
        return 0;
      }

      const containers = querySelectorAllDeep(document, selectors.commentContainer);

      const buttonsToClick: HTMLElement[] = [];
      for (const container of containers) {
        const toggles = querySelectorAllDeep(container, selectors.replyToggle);
        for (const toggle of toggles) {
          const button = toggle as HTMLElement;
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

      onProgress?.('expanding', currentCommentCount);
      Logger.info('[CommentExtractorSelector] Found reply toggles', {
        count: buttonsToClick.length,
      });

      const baseDelay = scrollCfg?.scrollDelay
        ? Math.min(scrollCfg.scrollDelay, TIMING.EXPAND_REPLY_MAX)
        : TIMING.SCROLL_BASE_DELAY_MS;

      for (let i = 0; i < buttonsToClick.length; i++) {
        const button = buttonsToClick[i];

        if (!document.contains(button)) continue;

        try {
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });

          await this.delay(TIMING.DOM_SETTLE_MS);

          const clickOpts = { bubbles: true, cancelable: true, view: window };
          button.dispatchEvent(new MouseEvent('mousedown', clickOpts));
          button.dispatchEvent(new MouseEvent('mouseup', clickOpts));
          button.click();

          totalExpanded++;

          await this.delay(baseDelay);
        } catch (error) {
          Logger.warn('[CommentExtractorSelector] Failed to click reply toggle button', { error });
        }
      }

      if (totalExpanded > 0) {
        await this.delay(TIMING.AI_RETRY_DELAY_MS);
        Logger.info('[CommentExtractorSelector] Total reply expansion completed', {
          totalExpanded,
        });
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
    _structure: Record<string, unknown>,
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
      if (scrollAttempts === 0 || scrollAttempts % SCROLL.REPLY_EXPAND_SCROLL_FREQUENCY === 0) {
        const expandedCount = await this.expandReplies(
          selectors,
          allComments.length,
          onProgress,
          scrollCfg,
        );

        if (expandedCount > 0) {
          await this.delay(TIMING.SCROLL_BASE_DELAY_MS);
        }
      }

      onProgress?.('extracting', allComments.length);
      const newComments = performanceMonitor.measure(
        'extractCommentsBySelector',
        () => commentParser.extractCommentsBySelector(selectors, platform),
        { platform, scrollAttempts },
      );

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

      Logger.info('[CommentExtractorSelector] Extracted new comments', {
        addedCount,
        total: allComments.length,
      });

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
      onProgress?.('scrolling', allComments.length);
      await this.pageController.scrollToBottom();
      await this.delay(scrollCfg?.scrollDelay || TIMING.SCROLL_DELAY_MS);

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
    const selectorTestResults = selectorValidator.testSelectors(selectors);
    this.logSelectorMatches('Pre-extraction selector test', selectors, selectorTestResults);

    // 按配置提取一次，不进行 AI 重试
    const comments = await this.extractWithScrolling(
      selectors,
      {},
      maxComments,
      platform,
      onProgress,
      scrollCfg,
    );

    // 根据实际提取结果标注 selector 成功/失败
    const metrics: Record<string, number> = {
      commentContainer: selectors.commentContainer
        ? querySelectorAllDeep(document, selectors.commentContainer).length
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
      const allKeys = Object.keys(selectors) as (keyof SelectorMap)[];
      const measuredKeys = new Set(Object.keys(metrics));
      const optionalKeys = new Set([
        'replyToggle',
        'replyContainer',
        'postTitle',
        'videoTime',
        'replyItem',
      ]);
      for (const key of allKeys) {
        const selectorValue = selectors[key];
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
        await sendMessageVoid({
          type: MESSAGES.UPDATE_SELECTOR_VALIDATION,
          payload: { configId, selectorKey: key, status },
        });
      }
    } else {
      Logger.warn(
        '[CommentExtractorSelector] Unable to update selector validation without configId',
      );
    }

    return comments;
  }

  private async getActiveConfigIdSafe(): Promise<string | undefined> {
    try {
      const url = window.location.href;
      const resp = await sendMessage<{ config?: ScraperConfig }>({
        type: MESSAGES.CHECK_SCRAPER_CONFIG,
        payload: { url },
      });
      return resp?.config?.id;
    } catch {
      return undefined;
    }
  }

  /**
   * Update selector validation status
   */
  private async updateSelectorValidation(selectors: SelectorMap, _success: boolean): Promise<void> {
    try {
      // Get current URL to find matching config
      const url = window.location.href;

      const configResponse = await sendMessage<{ config?: ScraperConfig }>({
        type: MESSAGES.CHECK_SCRAPER_CONFIG,
        payload: { url },
      });

      if (!configResponse?.config?.id) {
        Logger.info('[CommentExtractorSelector] No config found for validation update');
        return;
      }

      const configId = configResponse.config.id;

      const testResults = selectorValidator.testSelectors(selectors);

      // Update validation status for each selector based on test results
      const optionalKeys = new Set([
        'replyToggle',
        'replyContainer',
        'postTitle',
        'videoTime',
        'replyItem',
      ]);
      for (const [key, value] of Object.entries(selectors)) {
        if (value) {
          const count = typeof testResults[key] === 'number' ? testResults[key] : 0;
          const status: 'success' | 'failed' = optionalKeys.has(key)
            ? count === -1
              ? 'failed'
              : 'success'
            : count > 0
              ? 'success'
              : 'failed';

          await sendMessageVoid({
            type: MESSAGES.UPDATE_SELECTOR_VALIDATION,
            payload: { configId, selectorKey: key, status, count },
          });

          Logger.info('[CommentExtractorSelector] Selector status', { key, status, count });
        }
      }

      Logger.info('[CommentExtractorSelector] Updated selector validation for config', {
        configId,
      });
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

  private logSelectorMatches(
    title: string,
    selectors: Partial<SelectorMap>,
    counts: Record<string, number>,
  ): void {
    const summary = Object.entries(selectors)
      .filter(([_, s]) => !!s)
      .map(([key, selector]) => ({
        key,
        selector,
        count: counts[key] ?? 0,
        status:
          (counts[key] ?? 0) === -1 ? 'invalid' : (counts[key] ?? 0) > 0 ? 'success' : 'failed',
      }));

    Logger.info(`[CommentExtractorSelector] Selector test: ${title}`, { summary });
  }

  private logExtractionMetrics(metrics: Record<string, number>, configId?: string): void {
    const label = configId ? `config ${configId}` : 'unknown config';
    Logger.info('[CommentExtractorSelector] Extraction metrics', { label, metrics });
  }
}
