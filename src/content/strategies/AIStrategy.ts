import { ExtractionStrategy, ProgressCallback } from './ExtractionStrategy';
import { Comment, Platform, Settings } from '../../types';
import { PageController } from '../PageController';
import { DOMSimplifier } from '../DOMSimplifier';
import { Chunker } from '../utils/Chunker';
import { Tokenizer } from '@/utils/tokenizer';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { PortMessage, PortMessageResponse } from '../../types/handlers';
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
  PROMPT_GENERATE_CRAWLING_META_CONFIG,
} from '@/utils/prompts';
import { sendMessage } from '@/utils/chrome-message';
import { isExtractionActive } from '../extractionState';
import { getCurrentHostname } from '@/utils/url';
import { runWithConcurrencyLimit } from '@/utils/promise';
import { CrawlingConfig } from '../../types';
import { generateCommentHash } from '@/utils/comment-hash';

export type ConfigGenerationCallback = (progress: number, message: string) => void;
type MetaConfigSubset = Pick<CrawlingConfig, 'videoTime' | 'postContent'>;

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

    // Incremental extraction setup
    let newElementsToProcess: Element[] = [sectionElement];
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            newElementsToProcess.push(node as Element);
          }
        }
      }
    });
    observer.observe(sectionElement, { childList: true, subtree: true });

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

      onProgress?.(currentProgress, `extracting`, 'extracting', allComments.length, maxComments);

      // 2.1 Get current content of the section
      // Process only new elements to save memory and CPU
      const chunksToProcess: string[] = [];
      const elementsBatch = [...newElementsToProcess];
      newElementsToProcess = [];

      if (elementsBatch.length > 0) {
        // Create a virtual root for the batch to simplify them together
        const virtualRoot = document.createElement('div');
        virtualRoot.id = 'ai-incremental-batch';

        // We just simplify each element and combine them
        const batchSimplifiedNodes = elementsBatch.map((el) =>
          DOMSimplifier.simplifyForAI(el, {
            maxDepth: domConfig.maxDepth,
            includeText: true,
            maxNodes: extractMaxNodes,
          }),
        );

        const simplifiedRoot: import('../../types').SimplifiedNode = {
          tag: 'div',
          id: 'ai-incremental-batch',
          childCount: batchSimplifiedNodes.length,
          expanded: true,
          children: batchSimplifiedNodes,
          selector: '',
          depth: 0,
        };

        // 2.2 Chunking
        const chunks = Chunker.chunkSimplifiedNode(simplifiedRoot, maxChunkTokens);
        chunksToProcess.push(...chunks);
        Logger.debug('[AIStrategy] Chunked incremental section', {
          chunks: chunks.length,
          elements: elementsBatch.length,
        });
      }

      // 2.3 AI Extraction
      let newComments: Comment[] = [];
      if (chunksToProcess.length > 0) {
        onProgress?.(
          currentProgress,
          `analyzing chunks (${chunksToProcess.length})`,
          'analyzing',
          allComments.length,
          maxComments,
        );
        newComments = await this.extractFromChunks(chunksToProcess);
      }

      // Check abort status after AI extraction
      this.checkAborted();

      // 2.4 Merge & Dedup
      let added = 0;
      for (const comment of newComments) {
        const hash = generateCommentHash(comment);
        if (!seenHashes.has(hash)) {
          seenHashes.add(hash);
          comment.platform = platform;
          comment.id = comment.id || hash;
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

    observer.disconnect();

    onProgress?.(95, 'validating results', 'validating', allComments.length, maxComments);

    const result = allComments.slice(0, maxComments);

    try {
      const config = await this.generateIntelligentConfig(
        hostname,
        domConfig,
        detectMaxNodes,
        undefined,
        sectionSelector,
      );
      if (config) {
        await this.saveGeneratedConfig(hostname, config);
      }
    } catch (err) {
      Logger.warn('[AIStrategy] Post-extraction config generation failed', { error: err });
    }

    return result;
  }

  private async detectCommentSection(
    maxDepth: number,
    maxNodes: number,
    maxTokens: number,
  ): Promise<string | null> {
    try {
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
            Logger.info('[AIStrategy] Using cached selector', { selector });
            return selector;
          } else {
            Logger.warn('[AIStrategy] Cached selector invalid (element not found)', { selector });
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
          Logger.info('[AIStrategy] Using cached heuristic selector', {
            selector: heuristicSelector,
          });
          return heuristicSelector;
        }
      } catch (err) {
        Logger.warn('[AIStrategy] Failed to check cache', { error: err });
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
          const response = await this.callAIviaPort<{
            data?: { selectors?: { commentContainer?: string }; confidence?: number };
          }>({
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
            if (conf >= AI.CONFIDENCE_EARLY_EXIT_THRESHOLD) {
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
    const allComments: Comment[] = [];

    const tasks = chunks.map((chunk, i) => async () => {
      try {
        const response = await this.callAIviaPort<{ comments?: Comment[]; error?: string }>({
          type: MESSAGES.AI_EXTRACT_CONTENT,
          payload: {
            chunks: [chunk],
            systemPrompt: PROMPT_EXTRACT_COMMENTS_FROM_HTML,
          },
        });

        if (response?.error) {
          Logger.warn(`[AIStrategy] Chunk ${i + 1}/${chunks.length} extraction error`, {
            error: response.error,
          });
          return [];
        } else if (response?.comments?.length) {
          return response.comments;
        }
      } catch (err) {
        Logger.error(`[AIStrategy] Port call failed for chunk ${i + 1}/${chunks.length}`, {
          error: err,
        });
      }
      return [];
    });

    const results = await runWithConcurrencyLimit(tasks, AI.MAX_CONCURRENT_REQUESTS);
    for (const chunkComments of results) {
      allComments.push(...chunkComments);
    }

    return allComments;
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

  private async callAIviaPort<T>(message: Omit<PortMessage, 'id'>): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      try {
        const port = this.getAIPort();
        const id = Math.random().toString(36).slice(2);

        const finalize = (callback: () => void): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          port.onMessage.removeListener(listener);
          port.onDisconnect.removeListener(disconnectListener);
          callback();
        };

        // Create a listener for this specific message ID
        const listener = (msg: PortMessageResponse) => {
          if (msg.id === id) {
            finalize(() => resolve(msg.response as T));
          }
        };

        const disconnectListener = (): void => {
          const messageText =
            chrome.runtime.lastError?.message || '[AIStrategy] AI Bridge Port disconnected';
          finalize(() => reject(new Error(messageText)));
        };

        port.onMessage.addListener(listener);
        port.onDisconnect.addListener(disconnectListener);
        timer = setTimeout(() => {
          finalize(() => reject(new Error('AI Bridge response timeout')));
        }, AI.DEFAULT_TIMEOUT);
        port.postMessage({ ...message, id });
      } catch (err) {
        if (timer) {
          clearTimeout(timer);
        }
        reject(err);
      }
    });
  }

  private cacheSelector(hostname: string, selector: string): void {
    sendMessage({
      type: MESSAGES.CACHE_SELECTOR,
      payload: { hostname, selector },
    }).catch((err) => {
      Logger.warn('[AIStrategy] Failed to cache selector', { error: err });
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

  private async generateIntelligentConfig(
    hostname: string,
    domConfig: { maxDepth: number },
    detectMaxNodes: number,
    onProgress?: ProgressCallback | ConfigGenerationCallback,
    knownSectionSelector?: string | null,
  ): Promise<CrawlingConfig | null> {
    Logger.info('[AIStrategy] Starting intelligent config generation');
    onProgress?.(EXTRACTION_PROGRESS.CONFIG_ANALYZING, 'Analyzing page macro structure...');

    // Phase 1: Meta Config Generation (Shallow DOM)
    let metaConfig: Partial<MetaConfigSubset> = {};
    try {
      const shallowSimplified = DOMSimplifier.simplifyForAI(document.body, {
        maxDepth: Math.max(DOM.DETECT_MIN_DEPTH, Math.floor(domConfig.maxDepth / 2)),
        includeText: true,
        maxNodes: detectMaxNodes,
      });
      const shallowDomStr = DOMSimplifier.toStringFormat(shallowSimplified);

      const metaPrompt =
        PROMPT_GENERATE_CRAWLING_META_CONFIG +
        `\n\nPage URL: ${window.location.href}\nDomain: ${hostname}\n\nDOM Structure:\n\`\`\`html\n${shallowDomStr}\n\`\`\``;

      onProgress?.(
        EXTRACTION_PROGRESS.CONFIG_ANALYZING + 5,
        'Asking AI for post metadata schemas...',
      );
      const response = await this.callAIviaPort<{
        config?: Partial<MetaConfigSubset>;
        error?: string;
      }>({
        type: MESSAGES.GENERATE_CRAWLING_CONFIG,
        payload: { prompt: metaPrompt },
      });

      if (response && response.config) {
        metaConfig = response.config;
        Logger.info('[AIStrategy] Obtained meta config', { metaConfig });
      }
    } catch (err) {
      Logger.warn('[AIStrategy] Failed to generate meta config, ignoring', { error: err });
    }

    // Phase 2: Detecting Section Selector if missing
    let sectionSelector = knownSectionSelector;
    if (!sectionSelector) {
      onProgress?.(
        EXTRACTION_PROGRESS.CONFIG_ANALYZING + 10,
        'Locating primary comment section...',
      );
      const tokenChunks =
        AI.DEFAULT_CONTEXT_WINDOW - AI.DEFAULT_MAX_OUTPUT_TOKENS - AI.INPUT_TOKEN_BUFFER;
      sectionSelector = await this.detectCommentSection(
        domConfig.maxDepth,
        detectMaxNodes,
        tokenChunks,
      );
    }

    if (!sectionSelector) {
      throw new ExtensionError(ErrorCode.DOM_ANALYSIS_FAILED, 'Could not detect comment container');
    }

    const sectionElement = document.querySelector(sectionSelector);
    if (!sectionElement) {
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        `Comment section element not found: ${sectionSelector}`,
      );
    }

    // Phase 3: Detailed Comments Config Generation
    onProgress?.(
      EXTRACTION_PROGRESS.CONFIG_ANALYZING + 15,
      'Extracting detailed comment DOM structure...',
    );
    const deepSimplified = DOMSimplifier.simplifyForAI(sectionElement, {
      maxDepth: domConfig.maxDepth,
      includeText: true,
      maxNodes: DOM.SIMPLIFY_MAX_NODES,
    });
    const deepDomStr = DOMSimplifier.toStringFormat(deepSimplified);

    const prompt =
      PROMPT_GENERATE_CRAWLING_CONFIG +
      `\n\nPage URL: ${window.location.href}\nDomain: ${hostname}\n\nDOM Structure (Container: ${sectionSelector}):\n\`\`\`html\n${deepDomStr}\n\`\`\``;

    onProgress?.(
      EXTRACTION_PROGRESS.CONFIG_ANALYZING + 20,
      'Asking AI for comment fields schemas...',
    );
    const response = await this.callAIviaPort<{ config?: CrawlingConfig; error?: string }>({
      type: MESSAGES.GENERATE_CRAWLING_CONFIG,
      payload: { prompt },
    });

    if (!response || !response.config) {
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        'AI failed to generate comment fields config',
      );
    }

    const config = response.config;
    if (!config.container || !config.item || !config.fields) {
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
      EXTRACTION_PROGRESS.CONFIG_ANALYZING + 30,
      'Verifying AI-generated schema on live page...',
    );
    try {
      const items = document.querySelectorAll(config.item.selector);
      if (!items || items.length === 0) {
        Logger.warn(
          '[AIStrategy] Self-correction failed: Generated config item selector found NO elements.',
          { selector: config.item.selector },
        );
        throw new ExtensionError(
          ErrorCode.DOM_ANALYSIS_FAILED,
          'Generated configuration is invalid (hallucination detected: zero matched elements).',
        );
      }
      Logger.info(
        `[AIStrategy] Self-correction passed: Found ${items.length} items using AI generated selector.`,
      );
    } catch (err) {
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        'Invalid CSS selector syntax from AI: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    return config;
  }

  private async saveGeneratedConfig(
    hostname: string,
    config: CrawlingConfig,
    onProgress?: ProgressCallback | ConfigGenerationCallback,
  ) {
    onProgress?.(CONFIG_GENERATION_PROGRESS.SAVING, 'Saving verified configuration...');
    const normalizedDomain = hostname.startsWith('www.') ? hostname.slice(4) : hostname;
    config.domain = normalizedDomain;
    config.id = normalizedDomain + '_' + Date.now();
    config.lastUpdated = Date.now();

    await sendMessage({
      type: MESSAGES.SAVE_CRAWLING_CONFIG,
      payload: { config },
    });
    Logger.info('[AIStrategy] Successfully generated, verified, and saved crawling config!', {
      config,
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async generateConfig(onProgress?: ConfigGenerationCallback): Promise<boolean> {
    Logger.info('[AIStrategy] Starting manual config generation');
    onProgress?.(EXTRACTION_PROGRESS.AI_ANALYZING, 'Initializing configuration generator...');

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

    onProgress?.(
      EXTRACTION_PROGRESS.CONFIG_ANALYZING,
      'Scrolling to load dynamically rendered content...',
    );

    await this.pageController.scrollToBottom();
    // Use delay for now, PageController scroll update will augment this later
    await this.delay(TIMING.SCROLL_DELAY_MS);

    const detectMaxNodes = Math.max(
      DOM.DETECT_MAX_NODES_BASE,
      domConfig.maxDepth * DOM.DETECT_MAX_NODES_FACTOR,
    );

    const config = await this.generateIntelligentConfig(
      hostname,
      domConfig,
      detectMaxNodes,
      onProgress,
    );
    if (config) {
      await this.saveGeneratedConfig(hostname, config, onProgress);
      onProgress?.(100, 'Configuration Generation Complete!');
      return true;
    }

    return false;
  }
}
