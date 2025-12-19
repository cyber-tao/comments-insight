import { ExtractionStrategy } from './ExtractionStrategy';
import { Comment, Platform, Settings } from '../../types';
import { PageController } from '../PageController';
import { DOMSimplifier } from '../DOMSimplifier';
import { Chunker } from '../utils/Chunker';
import { Tokenizer } from '@/utils/tokenizer';
import { Logger } from '../../utils/logger';
import {
  EXTRACTION_PROGRESS,
  MESSAGES,
  AI,
  TIMING,
  DOM,
  DOM_ANALYSIS_DEFAULTS,
} from '@/config/constants';
import { PROMPT_DETECT_COMMENTS_SECTION, PROMPT_EXTRACT_COMMENTS_FROM_HTML } from '@/utils/prompts';
import { sendMessage } from '@/utils/chrome-message';

export class AIStrategy implements ExtractionStrategy {
  private aiPort: chrome.runtime.Port | null = null;

  constructor(private pageController: PageController) {}

  async execute(
    maxComments: number,
    platform: Platform,
    onProgress?: (progress: number, message: string) => void,
  ): Promise<Comment[]> {
    Logger.info('[AIStrategy] Starting Pure AI Extraction');
    onProgress?.(EXTRACTION_PROGRESS.AI_ANALYZING, 'loading settings');

    // 0. Load Settings
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

    onProgress?.(EXTRACTION_PROGRESS.AI_ANALYZING, 'detecting comment section');

    // Step 1: Detect Comment Section (Macro)
    const sectionSelector = await this.detectCommentSection(
      domConfig.maxDepth,
      detectMaxNodes,
      maxChunkTokens,
    );
    if (!sectionSelector) {
      throw new Error('Failed to detect comment section via AI');
    }

    Logger.info('[AIStrategy] Detected comment section', { sectionSelector });

    // Locate the element
    let sectionElement = document.querySelector(sectionSelector);
    if (!sectionElement) {
      // Fallback: re-query after a short wait, maybe it loaded late
      await this.delay(TIMING.SHORT_WAIT_MS);
      sectionElement = document.querySelector(sectionSelector);
      if (!sectionElement) {
        throw new Error(`Comment section element not found: ${sectionSelector}`);
      }
    }

    const allComments: Comment[] = [];
    const seenHashes = new Set<string>();
    let noNewCommentsCount = 0;

    // Step 2: Loop - Scroll & Extract
    while (allComments.length < maxComments) {
      if (noNewCommentsCount >= DOM.NO_NEW_COMMENTS_THRESHOLD) {
        Logger.info('[AIStrategy] No new comments found after multiple attempts. Stopping.');
        break;
      }

      onProgress?.(
        Math.min(90, EXTRACTION_PROGRESS.MIN + (allComments.length / maxComments) * 70),
        `extracting (${allComments.length}/${maxComments})`,
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

      const newComments = await this.extractFromChunks(chunks);

      // 2.4 Merge & Dedup
      let added = 0;
      for (const comment of newComments) {
        const hash = this.generateHash(comment);
        if (!seenHashes.has(hash)) {
          seenHashes.add(hash);
          // Ensure platform is set
          comment.platform = platform;
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

      // 2.5 Scroll to load more
      onProgress?.(
        Math.min(90, EXTRACTION_PROGRESS.MIN + (allComments.length / maxComments) * 70),
        'scrolling',
      );

      await this.pageController.scrollToBottom();

      await this.delay(TIMING.SCROLL_DELAY_MS);
    }

    return allComments.slice(0, maxComments);
  }

  private async detectCommentSection(
    maxDepth: number,
    maxNodes: number,
    maxTokens: number,
  ): Promise<string | null> {
    try {
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
