import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { CrawlingConfig, Settings } from '../../types';
import { EXTRACTION_PROGRESS, MESSAGES, AI, DOM } from '@/config/constants';
import {
  PROMPT_DETECT_COMMENTS_SECTION,
  PROMPT_GENERATE_CRAWLING_CONFIG,
  PROMPT_GENERATE_CRAWLING_META_CONFIG,
} from '@/utils/prompts';
import { sendMessage } from '@/utils/chrome-message';
import { getCurrentHostname } from '@/utils/url';
import { DOMSimplifier } from '../DOMSimplifier';
import { Tokenizer } from '@/utils/tokenizer';
import { ContentAIService } from '../services/ContentAIService';
import { isExtractionActive } from '../extractionState';

export type ConfigGenerationCallback = (progress: number, message: string) => void;
type MetaConfigSubset = Pick<CrawlingConfig, 'videoTime' | 'postContent'>;

export class AIConfigGenerator {
  constructor(private aiService: ContentAIService) {}

  /**
   * Check if extraction should be aborted
   * @throws ExtensionError if extraction is cancelled
   */
  private checkAborted(): void {
    if (!isExtractionActive()) {
      throw new ExtensionError(ErrorCode.TASK_CANCELLED, 'Extraction cancelled by user', {}, false);
    }
  }

  async detectCommentSection(
    maxDepth: number,
    maxNodes: number,
    maxTokens: number,
  ): Promise<string | null> {
    try {
      this.checkAborted();
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

      Logger.info('[AIConfigGenerator] Analyzing DOM structure in chunks', {
        chunks: chunks.length,
      });

      let bestCandidate = {
        selector: null as string | null,
        confidence: 0,
      };

      for (let i = 0; i < chunks.length; i++) {
        this.checkAborted();
        const chunk = chunks[i];
        // Reconstruct prompt with the chunk
        const prompt = part1 + part2 + part3 + chunk + part5;

        try {
          // Use Port for long-running AI request to avoid message timeout
          const response = await this.aiService.callAI<{
            data?: { selectors?: { commentContainer?: string }; confidence?: number };
          }>({
            type: MESSAGES.AI_ANALYZE_STRUCTURE,
            payload: { prompt },
          });

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
  ): Promise<CrawlingConfig | null> {
    Logger.info('[AIConfigGenerator] Starting intelligent config generation');
    onProgress?.(EXTRACTION_PROGRESS.CONFIG_ANALYZING, 'Analyzing page macro structure...');
    this.checkAborted();

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
      const response = await this.aiService.callAI<{
        config?: Partial<MetaConfigSubset>;
        error?: string;
      }>({
        type: MESSAGES.GENERATE_CRAWLING_CONFIG,
        payload: { prompt: metaPrompt },
      });

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
    const response = await this.aiService.callAI<{ config?: CrawlingConfig; error?: string }>({
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
          '[AIConfigGenerator] Self-correction failed: Generated config item selector found NO elements.',
          { selector: config.item.selector },
        );
        throw new ExtensionError(
          ErrorCode.DOM_ANALYSIS_FAILED,
          'Generated configuration is invalid (hallucination detected: zero matched elements).',
        );
      }
      Logger.info(
        `[AIConfigGenerator] Self-correction passed: Found ${items.length} items using AI generated selector.`,
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
}
