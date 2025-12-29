// Content Script for Comments Insight Extension
import { PageController } from './PageController';
import { MESSAGES, DOM, SCRAPER_GENERATION } from '@/config/constants';
import { Comment, SimplifiedNode } from '@/types';
import { CommentExtractor } from './CommentExtractor';
import { Logger } from '@/utils/logger';
import { getCurrentHostname } from '@/utils/url';
import { DOMAnalyzer } from './DOMAnalyzer';
import { DOMSimplifier } from './DOMSimplifier';
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

const globalAny = globalThis as any;

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

      default:
        sendResponse({ status: 'received' });
    }

    return true;
  });

  // Expose test hook via window message
  // Expose test hook via window message
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'COMMENTS_INSIGHT_TEST_TRIGGER') {
      Logger.info('[Content] 🚀 TEST TRIGGER RECEIVED', event.data);

      const maxComments = event.data.maxComments || 10;
      const taskId = 'test-' + Date.now();

      handleStartExtraction({ taskId, maxComments }, (response) => {
        Logger.debug('[Content] Test extraction completed', {
          success: response.success,
          commentsCount: response.comments?.length || 0,
          error: response.error,
        });
      });
    }
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
  // 1. Immediately acknowledge receipt to prevent message timeout
  sendResponse({ success: true });

  const { taskId, maxComments } = data;

  Logger.info('[Content] Starting extraction', { taskId });

  // Set current task
  currentTaskId = taskId;
  setExtractionActive(true);

  try {
    // Use the unified extractor interface
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
      return;
    }

    // Get post info from page
    const postInfo = getPostInfo();

    // 2. Send completion message
    await chrome.runtime.sendMessage({
      type: MESSAGES.EXTRACTION_COMPLETED,
      payload: {
        taskId,
        success: true,
        comments,
        postInfo,
      },
    });

    Logger.info('[Content] Extraction complete', { count: comments.length });
  } catch (error) {
    Logger.error('[Content] Extraction failed', { error });
    await chrome.runtime.sendMessage({
      type: MESSAGES.EXTRACTION_COMPLETED,
      payload: {
        taskId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
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
 * Get post information
 */
function getPostInfo(): { url: string; title: string; videoTime?: string } {
  const url = window.location.href;
  const title = document.title;
  return { url, title };
}

/**
 * Handle GET_DOM_STRUCTURE message
 * Get simplified DOM structure for AI analysis
 */
async function handleGetDOMStructure(sendResponse: (response: DomStructureResponse) => void) {
  try {
    Logger.info('[Content] Getting DOM structure for AI analysis');

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
