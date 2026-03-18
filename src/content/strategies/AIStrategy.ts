import { ExtractionStrategy, ProgressCallback } from './ExtractionStrategy';
import { Comment, Platform, Settings, CrawlingConfig } from '../../types';
import { PageController } from '../PageController';
import { DOMSimplifier } from '../DOMSimplifier';
import { Chunker } from '../utils/Chunker';
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
import { PROMPT_EXTRACT_COMMENTS_FROM_HTML } from '@/utils/prompts';
import { sendMessage } from '@/utils/chrome-message';
import { isExtractionActive } from '../extractionState';
import { getCurrentHostname } from '@/utils/url';
import { runWithConcurrencyLimit } from '@/utils/promise';
import { generateCommentHash } from '@/utils/comment-hash';
import { ContentAIService } from '../services/ContentAIService';
import { AIConfigGenerator, ConfigGenerationCallback } from './AIConfigGenerator';

export class AIStrategy implements ExtractionStrategy {
  private aiService: ContentAIService;
  private configGenerator: AIConfigGenerator;

  constructor(private pageController: PageController) {
    this.aiService = new ContentAIService();
    this.configGenerator = new AIConfigGenerator(this.aiService);
  }

  /**
   * Clean up resources, disconnect port
   * Should be called when strategy is no longer needed
   */
  cleanup(): void {
    this.aiService.disconnect();
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
    const sectionSelector = await this.configGenerator.detectCommentSection(
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
    onProgress?.(
      EXTRACTION_PROGRESS.AI_ANALYZING + EXTRACTION_PROGRESS.STEPS.AI_DETECTING,
      'comment section found',
      'detecting',
      1,
      1,
    );

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
      const config = await this.configGenerator.generateIntelligentConfig(
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

  private async extractFromChunks(chunks: string[]): Promise<Comment[]> {
    const allComments: Comment[] = [];

    const tasks = chunks.map((chunk, i) => async () => {
      try {
        const response = await this.aiService.callAI<{ comments?: Comment[]; error?: string }>({
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

    const config = await this.configGenerator.generateIntelligentConfig(
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
