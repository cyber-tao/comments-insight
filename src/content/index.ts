// Content Script for Comments Insight Extension
import { PageController } from './PageController';
import { MESSAGES, DOM, SCRAPER_GENERATION } from '@/config/constants';
import { Comment, SimplifiedNode } from '@/types';
import { CommentExtractor } from './CommentExtractor';
import { Logger } from '@/utils/logger';
import { getCurrentHostname } from '@/utils/url';
import { DOMAnalyzer } from './DOMAnalyzer';
import { setExtractionActive } from './extractionState';

interface ExtractionResponse {
  success: boolean;
  error?: string;
  comments?: Comment[];
  postInfo?: {
    url?: string;
    title?: string;
    videoTime?: string;
  };
}

interface DomStructureResponse {
  success: boolean;
  domStructure?: string;
  textSamples?: string[];
  error?: string;
}

interface TestSelectorPayload {
  selector?: string;
}

const globalAny = globalThis as unknown as { __COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED?: boolean };

let domAnalyzer: DOMAnalyzer | null = null;
let pageController: PageController | null = null;
let commentExtractor: CommentExtractor | null = null;

const getTools = () => {
  if (!domAnalyzer) domAnalyzer = new DOMAnalyzer();
  if (!pageController) pageController = new PageController(domAnalyzer);
  if (!commentExtractor) commentExtractor = new CommentExtractor(pageController);
  return { domAnalyzer, commentExtractor };
};

// Track current extraction task
let currentTaskId: string | null = null;

if (!globalAny.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED) {
  globalAny.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED = true;

  Logger.debug('Comments Insight Content Script loaded');
  Logger.debug('[Content] Page loaded', { href: window.location.href });

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    Logger.debug('[Content] Received message', { type: message.type });

    // Handle different message types
    switch (message.type) {
      case MESSAGES.GET_PLATFORM_INFO:
        sendResponse({
          url: window.location.href,
          title: document.title,
        });
        break;

      case MESSAGES.START_EXTRACTION:
        handleStartExtraction(message.payload, sendResponse);
        return true; // Keep channel open for async response

      case MESSAGES.CANCEL_EXTRACTION:
        handleCancelExtraction(message.payload.taskId);
        sendResponse({ success: true });
        break;

      case MESSAGES.GET_DOM_STRUCTURE:
        handleGetDOMStructure(sendResponse);
        return true; // Keep channel open for async response

      case MESSAGES.TEST_SELECTOR_QUERY: {
        try {
          const payload = message.payload as TestSelectorPayload;
          const selector = payload?.selector;
          if (!selector) {
            sendResponse({ success: false, error: 'Missing selector' });
            return true;
          }
          const { domAnalyzer } = getTools();
          const nodes = domAnalyzer.querySelectorAllDeep(document, selector);
          const items = nodes.map((el: Element, i: number) => ({
            index: i,
            tag: el.tagName.toLowerCase(),
            id: (el as HTMLElement).id || '',
            className: (el as HTMLElement).className || '',
            text: (el.textContent || '').trim().slice(0, DOM.HTML_PREVIEW_LENGTH),
            html: el.outerHTML.slice(0, DOM.HTML_PREVIEW_LENGTH),
          }));
          sendResponse({ success: true, total: nodes.length, items });
        } catch (e) {
          sendResponse({ success: false, error: e instanceof Error ? e.message : 'Query failed' });
        }
        return true;
      }

      default:
        sendResponse({ status: 'received' });
    }

    return true;
  });
}

/**
 * Handle START_EXTRACTION message
 * @param data - Extraction parameters
 * @param sendResponse - Response callback
 */
async function handleStartExtraction(
  data: { taskId: string; maxComments: number },
  sendResponse: (response: ExtractionResponse) => void,
) {
  const { taskId, maxComments } = data;

  Logger.info('[Content] Starting extraction', { taskId });

  // Set current task
  currentTaskId = taskId;
  setExtractionActive(true);

  try {
    // Use the unified extractor interface
    // It will try to use config first, then fallback to AI discovery
    const { commentExtractor } = getTools();
    const comments = await commentExtractor.extractWithAI(
      maxComments,
      getCurrentHostname(),
      (progress: number, message: string) => {
        chrome.runtime.sendMessage({
          type: MESSAGES.EXTRACTION_PROGRESS,
          payload: { taskId, progress, message },
        });
      },
    );

    // Check if task was cancelled
    if (currentTaskId !== taskId) {
      Logger.info('[Content] Extraction cancelled');
      sendResponse({
        success: false,
        error: 'Extraction cancelled',
      });
      return;
    }

    // Get post info from page (including video time if available)
    const postInfo = await getPostInfo();

    // Send success response
    sendResponse({
      success: true,
      comments,
      postInfo,
    });

    Logger.info('[Content] Extraction complete', { count: comments.length });
  } catch (error) {
    Logger.error('[Content] Extraction failed', { error });
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    currentTaskId = null;
    setExtractionActive(false);
  }
}

/**
 * Handle CANCEL_EXTRACTION message
 * @param taskId - Task ID to cancel
 */
function handleCancelExtraction(taskId: string) {
  if (currentTaskId === taskId) {
    Logger.info('[Content] Cancelling extraction', { taskId });
    currentTaskId = null;
    setExtractionActive(false);
  }
}

/**
 * Get post information including video time
 */
async function getPostInfo(): Promise<{ url: string; title: string; videoTime?: string }> {
  const url = window.location.href;
  const title = document.title;

  // Try to get video time from scraper config
  try {
    const configResponse = await chrome.runtime.sendMessage({
      type: MESSAGES.CHECK_SCRAPER_CONFIG,
      payload: { url },
    });

    if (configResponse?.config?.selectors?.videoTime) {
      const videoTimeSelector = configResponse.config.selectors.videoTime;
      const videoTimeElement = document.querySelector(videoTimeSelector);

      if (videoTimeElement) {
        const videoTime =
          videoTimeElement.textContent?.trim() || videoTimeElement.getAttribute('datetime');
        if (videoTime) {
          Logger.info('[Content] Extracted video time', { videoTime });
          return { url, title, videoTime };
        }
      }
    }
  } catch (error) {
    Logger.warn('[Content] Failed to extract video time', { error });
  }

  return { url, title };
}

/**
 * Handle GET_DOM_STRUCTURE message
 * Get simplified DOM structure for AI analysis
 */
async function handleGetDOMStructure(sendResponse: (response: DomStructureResponse) => void) {
  try {
    Logger.info('[Content] Getting DOM structure for AI analysis');

    // Import DOMSimplifier
    const { DOMSimplifier } = await import('./DOMSimplifier');

    // Get simplified DOM structure
    const domStructure = DOMSimplifier.simplifyForAI(document.body, {
      maxDepth: DOM.SIMPLIFY_MAX_DEPTH,
      maxNodes: DOM.SIMPLIFY_MAX_NODES,
      includeText: true,
    });

    const textSamples: string[] = [];
    collectTextSamples(domStructure, SCRAPER_GENERATION.MAX_TEXT_SAMPLES, textSamples);

    // Convert to string format
    const domString = DOMSimplifier.toStringFormat(domStructure);

    Logger.info('[Content] DOM structure generated', {
      length: domString.length,
      samples: textSamples.length,
    });

    sendResponse({
      success: true,
      domStructure: domString,
      textSamples,
    });
  } catch (error) {
    Logger.error('[Content] Failed to get DOM structure', { error });
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

function collectTextSamples(node: SimplifiedNode, limit: number, results: string[]): void {
  if (results.length >= limit) return;

  if (node.text) {
    results.push(node.text);
  }

  if (results.length >= limit || !node.children) return;

  for (const child of node.children) {
    collectTextSamples(child, limit, results);
    if (results.length >= limit) return;
  }
}
