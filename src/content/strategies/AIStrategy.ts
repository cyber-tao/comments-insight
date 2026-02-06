import { ExtractionStrategy, ProgressCallback } from './ExtractionStrategy';
import { Comment, Platform, Settings } from '../../types';
import { PageController } from '../PageController';
import { DOMSimplifier } from '../DOMSimplifier';
import { Chunker } from '../utils/Chunker';
import { Tokenizer } from '@/utils/tokenizer';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import {
  EXTRACTION_PROGRESS,
  CONFIG_GENERATION_PROGRESS,
  MESSAGES,
  AI,
  TIMING,
  DOM,
  DOM_ANALYSIS_DEFAULTS,
  SCROLL,
} from '@/config/constants';
import {
  PROMPT_DETECT_COMMENTS_SECTION,
  PROMPT_EXTRACT_COMMENTS_FROM_HTML,
  PROMPT_GENERATE_CRAWLING_CONFIG,
} from '@/utils/prompts';
import { sendMessage } from '@/utils/chrome-message';
import { isExtractionActive } from '../extractionState';
import { getCurrentHostname } from '@/utils/url';
import { CrawlingConfig } from '../../types';
import { ConfiguredStrategy } from './ConfiguredStrategy';

const SITE_SELECTORS: Record<string, string> = {
  'youtube.com': '#comments',
  'reddit.com': 'shreddit-comments',
  'bilibili.com': '#comment, .comment-list, .comment-container',
  'twitter.com': '[aria-label="Timeline: Conversation"]',
  'x.com': '[aria-label="Timeline: Conversation"]',
  'juejin.cn': '#comment-box',
  'zhihu.com': '.Comments-container',
  'github.com': '.js-discussion',
};

export type ConfigGenerationCallback = (progress: number, message: string) => void;

export class AIStrategy implements ExtractionStrategy {
  private aiPort: chrome.runtime.Port | null = null;

  constructor(private pageController: PageController) {}

  /**
   * 清理资源，断开端口连接
   * 应在策略不再需要时调用
   */
  cleanup(): void {
    if (this.aiPort) {
      try {
        this.aiPort.disconnect();
      } catch (e) {
        Logger.debug('[AIStrategy] Error disconnecting port', { error: e });
      }
      this.aiPort = null;
    }
  }

  /**
   * Check if extraction should be aborted
   * @throws ExtensionError if extraction is cancelled
   */
  private checkAborted(): void {
    if (!isExtractionActive()) {
      throw new ExtensionError(ErrorCode.TASK_CANCELLED, 'Extraction cancelled by user', {}, false);
    }
  }

  async execute(
    maxComments: number,
    platform: Platform,
    onProgress?: ProgressCallback,
  ): Promise<Comment[]> {
    const hostname = getCurrentHostname();
    Logger.info('[AIStrategy] Starting execution', { hostname });

    // 1. Check for existing Crawling Config
    try {
      const resp = await sendMessage<{ config: CrawlingConfig | null }>({
        type: MESSAGES.GET_CRAWLING_CONFIG,
        payload: { domain: hostname },
      });

      if (resp && resp.config) {
        Logger.info('[AIStrategy] Found valid crawling config. Delegating to ConfiguredStrategy.', {
          domain: hostname,
        });
        const strategy = new ConfiguredStrategy(this.pageController, resp.config);
        return await strategy.execute(maxComments, platform, onProgress);
      }
    } catch (e) {
      Logger.warn('[AIStrategy] Failed to check crawling config', { error: e });
    }

    // 2. If no config, fall back to "Legacy" AI Detection + Generation
    Logger.info('[AIStrategy] No config found. Using AI for detection and config generation.');
    return await this.executeLegacyAI(maxComments, platform, onProgress);
  }

  /**
   * Original AI Logic - now wrapped as a fallback/generator
   */
  async executeLegacyAI(
    maxComments: number,
    platform: Platform,
    onProgress?: ProgressCallback,
  ): Promise<Comment[]> {
    Logger.info('[AIStrategy] Starting Pure AI Extraction (Legacy Mode)');
    onProgress?.(EXTRACTION_PROGRESS.AI_ANALYZING, 'loading settings', 'initializing', 0, 1);

    // Check if extraction is still active
    this.checkAborted();

    // 0. Load Settings
    const hostname = getCurrentHostname();
    let domConfig = DOM_ANALYSIS_DEFAULTS;
    let aiConfig = {
      contextWindowSize: AI.DEFAULT_CONTEXT_WINDOW,
      maxOutputTokens: AI.DEFAULT_MAX_OUTPUT_TOKENS,
    };

    try {
      const resp = await sendMessage<{ settings: Settings }>({ type: MESSAGES.GET_SETTINGS });
      if (resp?.settings) {
        if (resp.settings.domAnalysisConfig) {
          domConfig = resp.settings.domAnalysisConfig;
        }
        if (resp.settings.aiModel) {
          aiConfig = {
            contextWindowSize: resp.settings.aiModel.contextWindowSize || AI.DEFAULT_CONTEXT_WINDOW,
            maxOutputTokens: resp.settings.aiModel.maxOutputTokens || AI.DEFAULT_MAX_OUTPUT_TOKENS,
          };
        }
      }
    } catch (e) {
      Logger.warn('[AIStrategy] Failed to load settings, using defaults', { error: e });
    }

    // Check abort status after settings load
    this.checkAborted();
    onProgress?.(EXTRACTION_PROGRESS.AI_ANALYZING, 'settings loaded', 'initializing', 1, 1);

    // Calculate safe max input tokens for chunking
    // Context - Output - Safety Buffer, then multiply by safety factor to handle estimation variance
    const maxChunkTokens = Math.floor(
      Math.max(
        AI.MIN_AVAILABLE_TOKENS,
        aiConfig.contextWindowSize - aiConfig.maxOutputTokens - AI.INPUT_TOKEN_BUFFER,
      ) * AI.TOKEN_SAFETY_FACTOR,
    );

    // Dynamic node limits based on depth
    const detectMaxNodes = Math.max(
      DOM.DETECT_MAX_NODES_BASE,
      domConfig.maxDepth * DOM.DETECT_MAX_NODES_FACTOR,
    );
    const extractMaxNodes = Math.max(
      DOM.EXTRACT_MAX_NODES_BASE,
      domConfig.maxDepth * DOM.EXTRACT_MAX_NODES_FACTOR,
    );

    onProgress?.(EXTRACTION_PROGRESS.AI_ANALYZING, 'detecting comment section', 'detecting', 0, 1);

    // Step 1: Detect Comment Section (Macro)
    const sectionSelector = await this.detectCommentSection(
      domConfig.maxDepth,
      detectMaxNodes,
      maxChunkTokens,
    );

    // Check abort status after detection
    this.checkAborted();

    if (!sectionSelector) {
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        'Failed to detect comment section via AI',
      );
    }

    Logger.info('[AIStrategy] Detected comment section', { sectionSelector });
    onProgress?.(EXTRACTION_PROGRESS.AI_ANALYZING + 5, 'comment section found', 'detecting', 1, 1);

    // --- NEW: Generate Config Step ---
    // We found the container. Now let's try to generate the full config for future use.
    // We do this in parallel or just before starting the loop.
    // To be safe, we do it now. If it fails, we continue with Legacy loop.
    this.generateAndSaveConfig(sectionSelector, hostname, domConfig.maxDepth, detectMaxNodes).catch(
      (err) => {
        Logger.warn('[AIStrategy] Background config generation failed', { error: err });
      },
    );
    // ---------------------------------

    // Locate the element
    let sectionElement = document.querySelector(sectionSelector);
    if (!sectionElement) {
      // Fallback: re-query after a short wait, maybe it loaded late
      await this.delay(TIMING.SHORT_WAIT_MS);
      sectionElement = document.querySelector(sectionSelector);
      if (!sectionElement) {
        throw new ExtensionError(
          ErrorCode.DOM_ANALYSIS_FAILED,
          `Comment section element not found: ${sectionSelector}`,
          { selector: sectionSelector },
        );
      }
    }

    const allComments: Comment[] = [];
    const seenHashes = new Set<string>();
    let noNewCommentsCount = 0;
    let scrollCount = 0;
    let unchangedScrollCount = 0;

    // Step 2: Loop - Scroll & Extract
    while (allComments.length < maxComments) {
      // Check abort status at the start of each iteration
      this.checkAborted();

      if (noNewCommentsCount >= DOM.NO_NEW_COMMENTS_THRESHOLD) {
        Logger.info('[AIStrategy] No new comments found after multiple attempts. Stopping.');
        break;
      }

      if (unchangedScrollCount >= SCROLL.UNCHANGED_SCROLL_THRESHOLD) {
        Logger.info('[AIStrategy] Comment container stopped loading new content. Stopping.');
        break;
      }

      const currentProgress = Math.min(
        EXTRACTION_PROGRESS.NORMALIZING,
        EXTRACTION_PROGRESS.MIN + (allComments.length / maxComments) * EXTRACTION_PROGRESS.RANGE,
      );

      // 2.1 Scroll first to load more content before extraction
      if (scrollCount > 0) {
        onProgress?.(
          currentProgress,
          `scrolling (${scrollCount})`,
          'scrolling',
          allComments.length,
          maxComments,
        );

        const { contentChanged } = await this.pageController.scrollContainer(sectionElement);

        if (!contentChanged) {
          unchangedScrollCount++;
          Logger.debug('[AIStrategy] Scroll did not load new content', { unchangedScrollCount });
        } else {
          unchangedScrollCount = 0;
        }
      }
      scrollCount++;

      onProgress?.(
        currentProgress,
        `extracting:${allComments.length}:${maxComments}`,
        'extracting',
        allComments.length,
        maxComments,
      );

      // 2.1 Get current content of the section
      // We assume the section grows as we scroll.
      // Simplify the section
      const simplifiedRoot = DOMSimplifier.simplifyForAI(sectionElement, {
        maxDepth: domConfig.maxDepth, // Use configured depth
        includeText: true,
        maxNodes: extractMaxNodes,
      });

      // 2.2 Chunking
      const chunks = Chunker.chunkSimplifiedNode(simplifiedRoot, maxChunkTokens);
      Logger.debug('[AIStrategy] Chunked section', { chunks: chunks.length });

      // 2.3 AI Extraction (Sequential or batch)
      onProgress?.(
        currentProgress,
        `analyzing chunks (${chunks.length})`,
        'analyzing',
        allComments.length,
        maxComments,
      );

      const newComments = await this.extractFromChunks(chunks);

      // Check abort status after AI extraction
      this.checkAborted();

      // 2.4 Merge & Dedup
      let added = 0;
      for (const comment of newComments) {
        const hash = this.generateHash(comment);
        if (!seenHashes.has(hash)) {
          seenHashes.add(hash);
          // Ensure platform is set
          comment.platform = platform;
          comment.id = comment.id || hash; // Assign hash if ID is missing
          allComments.push(comment);
          added++;
        }
      }

      Logger.info('[AIStrategy] Extracted batch', {
        found: newComments.length,
        new: added,
        total: allComments.length,
      });

      if (added === 0) {
        noNewCommentsCount++;
      } else {
        noNewCommentsCount = 0;
      }

      if (allComments.length >= maxComments) break;
    }

    onProgress?.(95, 'validating results', 'validating', allComments.length, maxComments);

    return allComments.slice(0, maxComments);
  }

  private async detectCommentSection(
    maxDepth: number,
    maxNodes: number,
    maxTokens: number,
  ): Promise<string | null> {
    try {
      const hostname = getCurrentHostname();

      // 1. Check Cache
      try {
        const settingsResp = await sendMessage<{ settings: Settings }>({
          type: MESSAGES.GET_SETTINGS,
        });
        const cache = settingsResp?.settings?.selectorCache || [];
        const cached = cache.find((item) => item.domain === hostname);

        if (cached && cached.selectors && cached.selectors.commentContainer) {
          const selector = cached.selectors.commentContainer;
          const element = document.querySelector(selector);
          if (element) {
            Logger.info('[AIStrategy] Using cached selector', { selector });
            return selector;
          } else {
            Logger.warn('[AIStrategy] Cached selector invalid (element not found)', { selector });
          }
        }
      } catch (err) {
        Logger.warn('[AIStrategy] Failed to check cache', { error: err });
      }

      // 2. Check Heuristics
      const heuristicSelector = this.checkHeuristics(hostname);
      if (heuristicSelector) {
        Logger.info('[AIStrategy] Using heuristic selector', { selector: heuristicSelector });
        // Save to cache for future consistency
        this.cacheSelector(hostname, heuristicSelector);
        return heuristicSelector;
      }

      // 3. AI Detection
      // Simplify body (shallow but wide enough to find the container)
      const simplifiedBody = DOMSimplifier.simplifyForAI(document.body, {
        maxDepth: Math.max(DOM.DETECT_MIN_DEPTH, Math.floor(maxDepth / 2)), // Use shallower depth for detection
        includeText: true,
        maxNodes: maxNodes,
      });

      const domStr = DOMSimplifier.toStringFormat(simplifiedBody);

      const part1 = PROMPT_DETECT_COMMENTS_SECTION;
      const part2 =
        '\n\nIMPORTANT: Return JSON with a "selectors" object containing "commentContainer".\nExample: { "selectors": { "commentContainer": "#comments" }, "confidence": 1.0 }\n\nDOM Structure:\n';
      const part3 = '```html\n';
      const part4 = domStr; // We will chunk this
      const part5 = '\n```';

      const overhead = part1 + part2 + part3 + part5; // Suffix is part of overhead for calculation

      // Chunk the DOM structure
      const chunks = Tokenizer.chunkTextWithOverhead(part4, maxTokens, overhead);

      Logger.info('[AIStrategy] Analyzing DOM structure in chunks', { chunks: chunks.length });

      let bestCandidate = {
        selector: null as string | null,
        confidence: 0,
      };

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        // Reconstruct prompt with the chunk
        const prompt = part1 + part2 + part3 + chunk + part5;

        try {
          // Use Port for long-running AI request to avoid message timeout
          const response = await this.callAIviaPort<any>({
            type: MESSAGES.AI_ANALYZE_STRUCTURE,
            payload: { prompt },
          });

          if (response?.data?.selectors?.commentContainer) {
            const conf = response.data.confidence || AI.DEFAULT_CONFIDENCE;
            Logger.info(`[AIStrategy] Candidate found in chunk ${i + 1}`, {
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
            if (conf >= AI.CONFIDENCE_HIGH_THRESHOLD) {
              break;
            }
          }
        } catch (err) {
          Logger.warn(`[AIStrategy] Failed to analyze chunk ${i + 1}`, { error: err });
        }
      }

      if (bestCandidate.selector) {
        // Cache the result
        this.cacheSelector(hostname, bestCandidate.selector);
      }

      return bestCandidate.selector;
    } catch (e) {
      Logger.warn('[AIStrategy] Detection failed', { error: e });
      return null;
    }
  }

  private async extractFromChunks(chunks: string[]): Promise<Comment[]> {
    try {
      // Use Port for long-running AI extraction to avoid message timeout
      const response = await this.callAIviaPort<any>({
        type: MESSAGES.AI_EXTRACT_CONTENT,
        payload: {
          chunks,
          systemPrompt: PROMPT_EXTRACT_COMMENTS_FROM_HTML,
        },
      });

      if (response?.error) {
        Logger.warn('[AIStrategy] Chunk extraction error', { error: response.error });
        return [];
      }

      return response?.comments || [];
    } catch (err) {
      Logger.error('[AIStrategy] Port call failed for extraction', { error: err });
      return [];
    }
  }

  private getAIPort(): chrome.runtime.Port {
    if (!this.aiPort) {
      this.aiPort = chrome.runtime.connect({ name: 'ai-bridge' });
      this.aiPort.onDisconnect.addListener(() => {
        Logger.debug('[AIStrategy] AI Bridge Port disconnected');
        this.aiPort = null;
      });
    }
    return this.aiPort;
  }

  private async callAIviaPort<T>(message: any): Promise<T> {
    return new Promise((resolve, reject) => {
      try {
        const port = this.getAIPort();
        const id = Math.random().toString(36).slice(2);

        // Create a listener for this specific message ID
        const listener = (msg: any) => {
          if (msg.id === id) {
            port.onMessage.removeListener(listener);
            resolve(msg.response as T);
          }
        };

        port.onMessage.addListener(listener);
        port.postMessage({ ...message, id });
      } catch (err) {
        reject(err);
      }
    });
  }

  private generateHash(comment: Comment): string {
    // Simple hash to dedup
    const str = `${comment.username}|${comment.content}|${comment.timestamp}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private cacheSelector(hostname: string, selector: string): void {
    sendMessage({
      type: MESSAGES.CACHE_SELECTOR,
      payload: { hostname, selector },
    }).catch((err) => {
      Logger.warn('[AIStrategy] Failed to cache selector', { error: err });
    });
  }

  private checkHeuristics(hostname: string): string | null {
    // Exact match
    if (SITE_SELECTORS[hostname]) {
      const selector = SITE_SELECTORS[hostname];
      if (document.querySelector(selector)) {
        return selector;
      }
    }

    // Suffix match (e.g. m.youtube.com matching youtube.com)
    for (const [domain, selector] of Object.entries(SITE_SELECTORS)) {
      if (hostname.endsWith(domain)) {
        if (document.querySelector(selector)) {
          return selector;
        }
      }
    }

    return null;
  }

  private async generateAndSaveConfig(
    sectionSelector: string,
    hostname: string,
    maxDepth: number,
    maxNodes: number,
  ): Promise<void> {
    Logger.info('[AIStrategy] Attempting to generate crawling config via AI...');

    const sectionElement = document.querySelector(sectionSelector);
    if (!sectionElement) return;

    const simplified = DOMSimplifier.simplifyForAI(sectionElement, {
      maxDepth: maxDepth || DOM_ANALYSIS_DEFAULTS.initialDepth,
      includeText: true,
      maxNodes: maxNodes || DOM.SIMPLIFY_MAX_NODES,
    });
    const domStr = DOMSimplifier.toStringFormat(simplified);

    const prompt =
      PROMPT_GENERATE_CRAWLING_CONFIG +
      `\n\nDOM Structure (Container: ${sectionSelector}):\n\`\`\`html\n${domStr}\n\`\`\``;

    const response = await this.callAIviaPort<any>({
      type: MESSAGES.GENERATE_CRAWLING_CONFIG,
      payload: { prompt },
    });

    if (response && response.config) {
      const config: any = response.config;

      if (config.container && config.item && config.fields) {
        const normalizedDomain = hostname.startsWith('www.') ? hostname.slice(4) : hostname;
        config.domain = normalizedDomain;
        config.id = normalizedDomain + '_' + Date.now();
        config.lastUpdated = Date.now();

        await sendMessage({
          type: MESSAGES.SAVE_CRAWLING_CONFIG,
          payload: { config },
        });
        Logger.info('[AIStrategy] Automatically generated and saved crawling config!', { config });
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async generateConfig(onProgress?: ConfigGenerationCallback): Promise<boolean> {
    Logger.info('[AIStrategy] Starting config generation');
    onProgress?.(EXTRACTION_PROGRESS.AI_ANALYZING, 'initializing');

    const hostname = getCurrentHostname();
    let domConfig = DOM_ANALYSIS_DEFAULTS;

    try {
      const resp = await sendMessage<{ settings: Settings }>({ type: MESSAGES.GET_SETTINGS });
      if (resp?.settings?.domAnalysisConfig) {
        domConfig = resp.settings.domAnalysisConfig;
      }
    } catch (e) {
      Logger.warn('[AIStrategy] Failed to load settings, using defaults', { error: e });
    }

    onProgress?.(EXTRACTION_PROGRESS.CONFIG_ANALYZING, 'scrolling to load content');

    await this.pageController.scrollToBottom();
    await this.delay(TIMING.SCROLL_DELAY_MS);

    onProgress?.(CONFIG_GENERATION_PROGRESS.ANALYZING, 'analyzing page structure');

    const detectMaxNodes = Math.max(
      DOM.DETECT_MAX_NODES_BASE,
      domConfig.maxDepth * DOM.DETECT_MAX_NODES_FACTOR,
    );

    const simplified = DOMSimplifier.simplifyForAI(document.body, {
      maxDepth: domConfig.maxDepth,
      includeText: true,
      maxNodes: detectMaxNodes,
    });
    const domStr = DOMSimplifier.toStringFormat(simplified);

    onProgress?.(CONFIG_GENERATION_PROGRESS.GENERATING, 'generating config via AI');

    const prompt =
      PROMPT_GENERATE_CRAWLING_CONFIG +
      `\n\nPage URL: ${window.location.href}\nDomain: ${hostname}\n\nDOM Structure:\n\`\`\`html\n${domStr}\n\`\`\``;

    const response = await this.callAIviaPort<any>({
      type: MESSAGES.GENERATE_CRAWLING_CONFIG,
      payload: { prompt },
    });

    if (!response || !response.config) {
      throw new ExtensionError(ErrorCode.DOM_ANALYSIS_FAILED, 'AI failed to generate config');
    }

    const config: any = response.config;

    if (!config.container || !config.item || !config.fields) {
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        'Generated config missing required fields',
      );
    }

    onProgress?.(CONFIG_GENERATION_PROGRESS.SAVING, 'saving config');

    const normalizedDomain = hostname.startsWith('www.') ? hostname.slice(4) : hostname;
    config.domain = normalizedDomain;
    config.id = normalizedDomain + '_' + Date.now();
    config.lastUpdated = Date.now();

    await sendMessage({
      type: MESSAGES.SAVE_CRAWLING_CONFIG,
      payload: { config },
    });

    onProgress?.(100, 'complete');
    Logger.info('[AIStrategy] Config generation completed', { config });

    return true;
  }
}
