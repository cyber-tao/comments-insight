import { Logger } from '../../utils/logger';
import { ErrorCode, ExtensionError } from '@/utils/error-types';
import { CrawlingConfig, FieldSelector, ReplyConfig, SelectorRule, Settings } from '../../types';
import {
  EXTRACTION_PROGRESS,
  CONFIG_GENERATION_PROGRESS,
  MESSAGES,
  AI,
  DOM,
  LIMITS,
} from '@/config/constants';
import {
  PROMPT_DETECT_COMMENTS_SECTION,
  PROMPT_GENERATE_CRAWLING_CONFIG,
  PROMPT_GENERATE_CRAWLING_META_CONFIG,
} from '../prompts';
import { sendMessage } from '@/utils/chrome-message';
import { getCurrentHostname } from '@/utils/url';
import { DOMSimplifier } from '../DOMSimplifier';
import { Tokenizer } from '@/utils/tokenizer';
import { ContentAIService } from '../ContentAIService';
import { querySelectorDeep } from '@/utils/dom-query';
import { findElementByRule, findElementsByRule, readField } from '../utils/selector-rule';
import { checkAborted } from '../utils/abort';

export type ConfigGenerationCallback = (progress: number, message: string) => void;
type MetaConfigSubset = Pick<CrawlingConfig, 'videoTime' | 'postContent'>;

export class AIConfigGenerator {
  constructor(private aiService: ContentAIService) {}

  async detectCommentSection(
    maxDepth: number,
    maxNodes: number,
    maxTokens: number,
    signal?: AbortSignal,
    timeoutMs: number = AI.DEFAULT_TIMEOUT,
  ): Promise<string | null> {
    try {
      checkAborted(signal);
      const hostname = getCurrentHostname();

      // 1. Check Cache & Heuristics
      try {
        const settingsResp = await sendMessage<{ settings: Settings }>({
          type: MESSAGES.GET_SETTINGS,
        });
        const selectorCache = settingsResp?.settings?.selectorCache || [];
        const cached = selectorCache.find((item) => item.domain === hostname);

        if (cached && cached.selectors && cached.selectors.commentContainer) {
          const selector = cached.selectors.commentContainer;
          const element = document.querySelector(selector);
          if (element) {
            Logger.info('[AIConfigGenerator] Using cached selector', { selector });
            return selector;
          } else {
            Logger.warn('[AIConfigGenerator] Cached selector invalid (element not found)', {
              selector,
            });
          }
        }

        const cacheMap: Record<string, string> = {};
        for (const item of selectorCache) {
          if (item.domain && item.selectors?.commentContainer) {
            cacheMap[item.domain] = item.selectors.commentContainer;
          }
        }
        const heuristicSelector = this.checkHeuristics(hostname, cacheMap);
        if (heuristicSelector) {
          Logger.info('[AIConfigGenerator] Using cached heuristic selector', {
            selector: heuristicSelector,
          });
          return heuristicSelector;
        }
      } catch (err) {
        Logger.warn('[AIConfigGenerator] Failed to check cache', { error: err });
      }

      // 3. AI Detection
      // Simplify body (shallow but wide enough to find the container)
      const simplifier = new DOMSimplifier();
      const simplifiedBody = simplifier.simplifyElement(document.body, {
        maxDepth: Math.max(
          DOM.DETECT_MIN_DEPTH,
          Math.floor(maxDepth * DOM.DETECT_SHALLOW_DEPTH_RATIO),
        ), // Use shallower depth for detection
        includeText: true,
        maxNodes: maxNodes,
      });

      const domStr = simplifier.nodeToString(simplifiedBody);

      const part1 = PROMPT_DETECT_COMMENTS_SECTION;
      const part2 =
        '\n\nIMPORTANT: Return JSON with a "selectors" object containing "commentContainer".\nExample: { "selectors": { "commentContainer": "#comments" }, "confidence": 1.0 }\n\nDOM Structure:\n';
      const part3 = '```html\n';
      const part4 = domStr; // We will chunk this
      const part5 = '\n```';

      const overhead = part1 + part2 + part3 + part5; // Suffix is part of overhead for calculation

      // Chunk the DOM structure
      const chunks = Tokenizer.chunkTextWithOverhead(part4, maxTokens, overhead);

      Logger.info('[AIConfigGenerator] Analyzing DOM structure in chunks', {
        chunks: chunks.length,
      });

      let bestCandidate = {
        selector: null as string | null,
        confidence: 0,
      };

      for (let i = 0; i < chunks.length; i++) {
        checkAborted(signal);
        const chunk = chunks[i];
        // Reconstruct prompt with the chunk
        const prompt = part1 + part2 + part3 + chunk + part5;

        try {
          // Use Port for long-running AI request to avoid message timeout
          const response = await this.aiService.callAI<{
            data?: { selectors?: { commentContainer?: string }; confidence?: number };
          }>(
            {
              type: MESSAGES.AI_ANALYZE_STRUCTURE,
              payload: { prompt },
            },
            signal,
            timeoutMs,
          );

          if (response?.data?.selectors?.commentContainer) {
            const conf = response.data.confidence || AI.DEFAULT_CONFIDENCE;
            Logger.info(`[AIConfigGenerator] Candidate found in chunk ${i + 1}`, {
              selector: response.data.selectors.commentContainer,
              confidence: conf,
            });

            if (conf > bestCandidate.confidence) {
              bestCandidate = {
                selector: response.data.selectors.commentContainer,
                confidence: conf,
              };
            }

            // Early exit if very high confidence
            if (conf >= AI.CONFIDENCE_EARLY_EXIT_THRESHOLD) {
              break;
            }
          }
        } catch (err) {
          Logger.warn(`[AIConfigGenerator] Failed to analyze chunk ${i + 1}`, { error: err });
        }
      }

      if (bestCandidate.selector) {
        // Cache the result
        this.cacheSelector(hostname, bestCandidate.selector);
      }

      return bestCandidate.selector;
    } catch (e) {
      Logger.warn('[AIConfigGenerator] Detection failed', { error: e });
      return null;
    }
  }

  async generateIntelligentConfig(
    hostname: string,
    domConfig: { maxDepth: number },
    detectMaxNodes: number,
    onProgress?: ConfigGenerationCallback,
    knownSectionSelector?: string | null,
    signal?: AbortSignal,
    timeoutMs: number = AI.DEFAULT_TIMEOUT,
  ): Promise<CrawlingConfig | null> {
    Logger.info('[AIConfigGenerator] Starting intelligent config generation');
    onProgress?.(EXTRACTION_PROGRESS.CONFIG_ANALYZING, 'Analyzing page macro structure...');
    checkAborted(signal);

    // Phase 1: Meta Config Generation (Shallow DOM)
    let metaConfig: Partial<MetaConfigSubset> = {};
    const simplifier = new DOMSimplifier();
    try {
      const shallowSimplified = simplifier.simplifyElement(document.body, {
        maxDepth: Math.max(
          DOM.DETECT_MIN_DEPTH,
          Math.floor(domConfig.maxDepth * DOM.DETECT_SHALLOW_DEPTH_RATIO),
        ),
        includeText: true,
        maxNodes: detectMaxNodes,
      });
      const shallowDomStr = simplifier.nodeToString(shallowSimplified);

      const metaPrompt =
        PROMPT_GENERATE_CRAWLING_META_CONFIG +
        `\n\nPage URL: ${window.location.href}\nDomain: ${hostname}\n\nDOM Structure:\n\`\`\`html\n${shallowDomStr}\n\`\`\``;

      onProgress?.(
        EXTRACTION_PROGRESS.CONFIG_ANALYZING + CONFIG_GENERATION_PROGRESS.STEPS.META_CONFIG,
        'Asking AI for post metadata schemas...',
      );
      const response = await this.aiService.callAI<{
        config?: Partial<MetaConfigSubset>;
        error?: string;
      }>(
        {
          type: MESSAGES.GENERATE_CRAWLING_CONFIG,
          payload: { prompt: metaPrompt },
        },
        signal,
        timeoutMs,
      );

      if (response && response.config) {
        metaConfig = response.config;
        Logger.info('[AIConfigGenerator] Obtained meta config', { metaConfig });
      }
    } catch (err) {
      Logger.warn('[AIConfigGenerator] Failed to generate meta config, ignoring', { error: err });
    }

    // Phase 2: Detecting Section Selector if missing
    let sectionSelector = knownSectionSelector;
    if (!sectionSelector) {
      onProgress?.(
        EXTRACTION_PROGRESS.CONFIG_ANALYZING + CONFIG_GENERATION_PROGRESS.STEPS.LOCATING_SECTION,
        'Locating primary comment section...',
      );
      const tokenChunks =
        AI.DEFAULT_CONTEXT_WINDOW - AI.DEFAULT_MAX_OUTPUT_TOKENS - AI.INPUT_TOKEN_BUFFER;
      sectionSelector = await this.detectCommentSection(
        domConfig.maxDepth,
        detectMaxNodes,
        tokenChunks,
        signal,
        timeoutMs,
      );
    }

    if (!sectionSelector) {
      throw new ExtensionError(ErrorCode.DOM_ANALYSIS_FAILED, 'Could not detect comment container');
    }

    const sectionElement = querySelectorDeep(document, sectionSelector, { signal });
    if (!sectionElement) {
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        `Comment section element not found: ${sectionSelector}`,
      );
    }

    // Phase 3: Detailed Comments Config Generation
    onProgress?.(
      EXTRACTION_PROGRESS.CONFIG_ANALYZING + CONFIG_GENERATION_PROGRESS.STEPS.EXTRACTING_DOM,
      'Extracting detailed comment DOM structure...',
    );
    const deepSimplified = simplifier.simplifyElement(sectionElement, {
      maxDepth: domConfig.maxDepth,
      includeText: true,
      maxNodes: DOM.SIMPLIFY_MAX_NODES,
    });
    let deepDomStr = simplifier.nodeToString(deepSimplified);
    if (deepSimplified.truncated) {
      const replySample = this.extractTruncatedReplySample(
        sectionElement,
        simplifier,
        domConfig.maxDepth,
        deepDomStr,
      );
      if (replySample) {
        deepDomStr += `\n\n<!-- Additional Reply Structure Sample -->\n${replySample}`;
      }
    }

    const prompt =
      PROMPT_GENERATE_CRAWLING_CONFIG +
      `\n\nPage URL: ${window.location.href}\nDomain: ${hostname}\n\nDOM Structure (Container: ${sectionSelector}):\n\`\`\`html\n${deepDomStr}\n\`\`\``;

    onProgress?.(
      EXTRACTION_PROGRESS.CONFIG_ANALYZING + CONFIG_GENERATION_PROGRESS.STEPS.GENERATING_FIELDS,
      'Asking AI for comment fields schemas...',
    );
    const response = await this.aiService.callAI<{ config?: CrawlingConfig; error?: string }>(
      {
        type: MESSAGES.GENERATE_CRAWLING_CONFIG,
        payload: { prompt },
      },
      signal,
      timeoutMs,
    );

    if (!response || !response.config) {
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        'AI failed to generate comment fields config',
      );
    }

    const config = response.config;
    if (!config.container || !config.item || !Array.isArray(config.fields)) {
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        'Generated config missing required fields (container, item, fields)',
      );
    }

    // Combine with meta config
    if (metaConfig.videoTime) config.videoTime = metaConfig.videoTime;
    if (metaConfig.postContent) config.postContent = metaConfig.postContent;

    // Phase 4: Self-Correction / Validation
    onProgress?.(
      EXTRACTION_PROGRESS.CONFIG_ANALYZING + CONFIG_GENERATION_PROGRESS.STEPS.VERIFYING,
      'Verifying AI-generated schema on live page...',
    );
    try {
      checkAborted(signal);
      const container = findElementByRule(document, config.container);
      const items = container
        ? findElementsByRule(container, config.item, LIMITS.SELECTOR_TEST_MAX_RESULTS)
        : [];
      if (items.length === 0) {
        Logger.warn(
          '[AIConfigGenerator] Self-correction failed: Generated config item selector found NO elements.',
          { selector: config.item.selector, type: config.item.type },
        );
        throw new ExtensionError(
          ErrorCode.DOM_ANALYSIS_FAILED,
          'Generated configuration is invalid (hallucination detected: zero matched elements).',
        );
      }
      const requiredFields = ['username', 'content'].map((name) =>
        config.fields.find((field) => field && field.name === name),
      );
      if (!items.some((item) => requiredFields.every((field) => Boolean(readField(item, field))))) {
        throw new ExtensionError(
          ErrorCode.DOM_ANALYSIS_FAILED,
          'Generated configuration cannot extract username and content from the same comment',
        );
      }

      this.normalizeConfigInPlace(config, items);
      if (!config.replies) {
        const detectedReplies = this.detectRepliesFallback(config, items);
        if (detectedReplies) {
          config.replies = detectedReplies;
        }
      }

      Logger.info(
        `[AIConfigGenerator] Self-correction passed: Found ${items.length} items using AI generated selector.`,
      );
    } catch (err) {
      if (err instanceof ExtensionError) {
        throw err;
      }
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        `Invalid ${config.item.type === 'xpath' ? 'XPath' : 'CSS'} selector syntax from AI: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    return config;
  }

  private cacheSelector(hostname: string, selector: string): void {
    sendMessage({
      type: MESSAGES.CACHE_SELECTOR,
      payload: { hostname, selector },
    }).catch((err) => {
      Logger.warn('[AIConfigGenerator] Failed to cache selector', { error: err });
    });
  }

  private checkHeuristics(hostname: string, selectorCache?: Record<string, string>): string | null {
    if (!selectorCache) return null;

    const cached = selectorCache[hostname];
    if (cached && document.querySelector(cached)) {
      return cached;
    }

    for (const [domain, selector] of Object.entries(selectorCache)) {
      if (hostname.endsWith(domain) && document.querySelector(selector)) {
        return selector;
      }
    }

    return null;
  }

  private extractTruncatedReplySample(
    sectionElement: Element,
    simplifier: DOMSimplifier,
    maxDepth: number,
    existingDomStr: string,
  ): string | null {
    try {
      const hintEl = sectionElement.querySelector(
        '[class*="repl" i], [id*="repl" i], [data-testid*="repl" i], [aria-label*="repl" i]',
      );
      if (!hintEl) {
        return null;
      }

      const targetEl =
        hintEl.closest('article, li, [role="article"], [class*="comment"]') ||
        hintEl.parentElement ||
        hintEl;
      if (!sectionElement.contains(targetEl) || targetEl === sectionElement) {
        return null;
      }

      const simplified = simplifier.simplifyElement(targetEl, {
        maxDepth: Math.min(maxDepth, 12),
        includeText: true,
        maxNodes: 300,
      });
      const sampleStr = simplifier.nodeToString(simplified);
      if (!sampleStr || existingDomStr.includes(sampleStr)) {
        return null;
      }
      return sampleStr;
    } catch {
      return null;
    }
  }

  private isValidRule(rule: unknown): rule is SelectorRule {
    return Boolean(
      rule &&
      typeof rule === 'object' &&
      typeof (rule as SelectorRule).selector === 'string' &&
      (rule as SelectorRule).selector.trim().length > 0,
    );
  }

  private normalizeRule(rule: SelectorRule): SelectorRule {
    return {
      selector: rule.selector.trim(),
      type: rule.type === 'xpath' ? 'xpath' : 'css',
    };
  }

  private sanitizeFieldSelectors(fields: FieldSelector[]): FieldSelector[] {
    const cleaned: FieldSelector[] = [];
    for (const field of fields) {
      if (!field || typeof field.name !== 'string' || !field.name.trim()) continue;
      if (!this.isValidRule(field.rule)) continue;
      const sanitized: FieldSelector = {
        name: field.name.trim(),
        rule: this.normalizeRule(field.rule),
      };
      if (typeof field.attribute === 'string' && field.attribute.trim()) {
        sanitized.attribute = field.attribute.trim();
      }
      cleaned.push(sanitized);
    }
    return cleaned;
  }

  private cloneFieldSelectors(fields: FieldSelector[]): FieldSelector[] {
    return fields.map((field) => ({
      name: field.name,
      rule: { ...field.rule },
      ...(field.attribute ? { attribute: field.attribute } : {}),
    }));
  }

  private normalizeConfigInPlace(config: CrawlingConfig, items: Element[]): void {
    config.fields = this.sanitizeFieldSelectors(config.fields);

    if (!this.isValidRule(config.videoTime)) {
      delete config.videoTime;
    } else {
      config.videoTime = this.normalizeRule(config.videoTime);
    }

    if (!this.isValidRule(config.postContent)) {
      delete config.postContent;
    } else {
      config.postContent = this.normalizeRule(config.postContent);
    }

    if (config.replies == null) {
      delete config.replies;
      return;
    }

    if (typeof config.replies !== 'object') {
      delete config.replies;
      return;
    }

    const replies = config.replies;
    if (!this.isValidRule(replies.expandBtn)) {
      delete replies.expandBtn;
    } else {
      replies.expandBtn = this.normalizeRule(replies.expandBtn);
    }

    const cleanedFields = Array.isArray(replies.fields)
      ? this.sanitizeFieldSelectors(replies.fields)
      : [];
    replies.fields =
      cleanedFields.length > 0 ? cleanedFields : this.cloneFieldSelectors(config.fields);

    // Ensure required comment fields exist in reply fields when main comment fields define them.
    for (const requiredName of ['username', 'content'] as const) {
      if (!replies.fields.some((f) => f.name === requiredName)) {
        const fallbackField = config.fields.find((f) => f.name === requiredName);
        if (fallbackField) {
          replies.fields.push({
            name: fallbackField.name,
            rule: { ...fallbackField.rule },
            ...(fallbackField.attribute ? { attribute: fallbackField.attribute } : {}),
          });
        }
      }
    }

    if (!this.isValidRule(replies.item)) {
      if (
        this.isValidRule(replies.container) &&
        this.hasValidReplyMatches(items, replies.container, config.item, replies.fields)
      ) {
        replies.item = { ...config.item };
      } else {
        delete config.replies;
        return;
      }
    } else {
      replies.item = this.normalizeRule(replies.item);
    }

    if (!this.isValidRule(replies.container)) {
      if (this.hasValidReplyMatches(items, replies.item, replies.item, replies.fields)) {
        replies.container = { ...replies.item };
      } else {
        delete config.replies;
        return;
      }
    } else {
      replies.container = this.normalizeRule(replies.container);
      // Repair container selector when nested replies are matched directly by item selector
      // while the AI-supplied container selector fails on the live DOM.
      const hasExpandBtn =
        Boolean(replies.expandBtn) &&
        items.some((parent) => findElementsByRule(parent, replies.expandBtn).length > 0);
      if (
        !hasExpandBtn &&
        !this.hasValidReplyMatches(items, replies.container, replies.item, replies.fields) &&
        this.hasValidReplyMatches(items, replies.item, replies.item, replies.fields)
      ) {
        replies.container = { ...replies.item };
      }
    }

    if (replies.fields.length === 0) {
      delete config.replies;
    }
  }

  private hasValidReplyMatches(
    items: Element[],
    containerRule: SelectorRule,
    itemRule: SelectorRule,
    fields: FieldSelector[],
  ): boolean {
    const usernameField = fields.find((f) => f.name === 'username');
    const contentField = fields.find((f) => f.name === 'content');
    if (!usernameField || !contentField) {
      return false;
    }

    try {
      for (const parentItem of items) {
        const directItemMatches = new Set(findElementsByRule(parentItem, itemRule));
        for (const container of findElementsByRule(parentItem, containerRule)) {
          const candidates = directItemMatches.has(container)
            ? [container, ...findElementsByRule(container, itemRule)]
            : findElementsByRule(container, itemRule);
          for (const candidate of candidates) {
            if (candidate === parentItem) continue;
            if (readField(candidate, usernameField) && readField(candidate, contentField)) {
              return true;
            }
          }
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  private detectExpandButtonRule(items: Element[]): SelectorRule | undefined {
    const candidates = [
      '.more-replies',
      '.show-replies',
      '.view-replies',
      'button[class*="repl" i]',
      'a[class*="repl" i]',
      '[class*="more-repl" i]',
      '[class*="view-repl" i]',
      '[class*="show-repl" i]',
      'button[aria-label*="repl" i]',
    ];

    for (const selector of candidates) {
      const rule: SelectorRule = { selector, type: 'css' };
      try {
        const matched = items.some((parent) =>
          findElementsByRule(parent, rule).some((el) => {
            const text = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`.trim();
            return /repl|回复/i.test(text);
          }),
        );
        if (matched) {
          return rule;
        }
      } catch {
        // Ignore invalid selector on edge DOM
      }
    }
    return undefined;
  }

  private detectRepliesFallback(config: CrawlingConfig, items: Element[]): ReplyConfig | undefined {
    const expandBtn = this.detectExpandButtonRule(items);

    // 1. Nested/recursive comment items reusing the top-level item selector
    if (this.hasValidReplyMatches(items, config.item, config.item, config.fields)) {
      Logger.info('[AIConfigGenerator] Detected nested comment replies via fallback heuristic');
      return {
        container: { ...config.item },
        item: { ...config.item },
        fields: this.cloneFieldSelectors(config.fields),
        ...(expandBtn ? { expandBtn } : {}),
      };
    }

    // 2. Dedicated reply container & reply item structures inside top-level comments
    const containerSelectors = [
      '.replies',
      '.reply-list',
      '.comment-replies',
      '[data-testid*="repl" i]',
      '[class*="replies"]',
      '[class*="reply-list"]',
      '[class*="sub-comment"]',
      '[class*="subcomment"]',
      '[class*="child-comment"]',
      '[class*="nested-comment"]',
    ];
    const itemSelectors = [
      config.item.selector,
      '.reply-item',
      '.reply',
      '[class*="reply-item"]',
      '[class*="sub-comment-item"]',
      '[class*="reply"]',
      '[class*="comment"]',
      '[role="article"]',
      'article',
      'li',
    ];

    for (const containerSelector of containerSelectors) {
      const containerRule: SelectorRule = { selector: containerSelector, type: 'css' };
      for (const itemSelector of itemSelectors) {
        const itemRule: SelectorRule = {
          selector: itemSelector,
          type: itemSelector === config.item.selector ? config.item.type : 'css',
        };
        if (this.hasValidReplyMatches(items, containerRule, itemRule, config.fields)) {
          Logger.info('[AIConfigGenerator] Detected dedicated reply container via fallback', {
            container: containerRule.selector,
            item: itemRule.selector,
          });
          return {
            container: containerRule,
            item: itemRule,
            fields: this.cloneFieldSelectors(config.fields),
            ...(expandBtn ? { expandBtn } : {}),
          };
        }
      }
    }

    return undefined;
  }
}
