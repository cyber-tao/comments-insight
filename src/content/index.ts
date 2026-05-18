import { PageController } from './PageController';
import {
  MESSAGES,
  DOM,
  SCRAPER_GENERATION,
  LIMITS,
  REGEX,
  DEFAULTS,
  TEXT,
} from '@/config/constants';
import { SimplifiedNode } from '@/types';
import { CommentExtractor } from './CommentExtractor';
import { Logger } from '@/utils/logger';
import { getCurrentHostname } from '@/utils/url';
import { DOMAnalyzer } from './DOMAnalyzer';
import { DOMSimplifier } from './DOMSimplifier';
import { globalExtractionState } from './extractionState';
import { AIStrategy } from './strategies/AIStrategy';
import { queryXPathAll } from '@/utils/dom-query';

import {
  ExtractionResponse,
  ConfigGenerationResponse,
  DomStructureResponse,
  SelectorTestResponse,
} from '@/types/messages';

interface GlobalWithInsight {
  __COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED?: boolean;
}

const globalInsight = globalThis as GlobalWithInsight;

let domAnalyzer: DOMAnalyzer | null = null;
let pageController: PageController | null = null;
let commentExtractor: CommentExtractor | null = null;

const getTools = () => {
  if (!domAnalyzer) domAnalyzer = new DOMAnalyzer();
  if (!pageController) pageController = new PageController(domAnalyzer);
  if (!commentExtractor) commentExtractor = new CommentExtractor(pageController);
  return { domAnalyzer, commentExtractor };
};

function sendCancelledCompletion(taskId: string, taskType: 'extract' | 'config'): void {
  const type =
    taskType === 'config' ? MESSAGES.CONFIG_GENERATION_COMPLETED : MESSAGES.EXTRACTION_COMPLETED;
  chrome.runtime
    .sendMessage({
      type,
      payload: {
        taskId,
        success: false,
        error: TEXT.EXTRACTION_CANCELLED_BY_USER,
      },
    })
    .catch((e) => {
      Logger.debug('[Content] send message failed', { error: e });
    });
}

if (!globalInsight.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED) {
  globalInsight.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED = true;

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
        return true;

      case MESSAGES.START_CONFIG_GENERATION:
        handleStartConfigGeneration(message.payload, sendResponse);
        return true;

      case MESSAGES.CANCEL_EXTRACTION:
        handleCancelExtraction(message.payload.taskId);
        sendResponse({ success: true });
        break;

      case MESSAGES.GET_DOM_STRUCTURE:
        handleGetDOMStructure(sendResponse);
        return true; // Keep channel open for async response

      case MESSAGES.TEST_SELECTOR:
        handleTestSelector(message.payload, sendResponse);
        return true;

      default:
        sendResponse({ status: 'received' });
    }

    return true;
  });

  // Expose test hook only in unpacked/development runtime
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    update_url?: string;
  };
  const isDevelopmentRuntime = !manifest.update_url;
  if (isDevelopmentRuntime) {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.type === 'COMMENTS_INSIGHT_TEST_TRIGGER') {
        Logger.info('[Content] 🚀 TEST TRIGGER RECEIVED', event.data);

        const maxComments = event.data.maxComments || DEFAULTS.TEST_MAX_COMMENTS;
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

  const controller = globalExtractionState.beginTask(taskId, 'extract');

  try {
    // Use the unified extractor interface
    const { commentExtractor } = getTools();
    const comments = await commentExtractor.extractWithAI(
      maxComments,
      getCurrentHostname(),
      (
        progress: number,
        message: string,
        stage?: import('@/types').ProgressStage,
        current?: number,
        total?: number,
      ) => {
        if (!globalExtractionState.isCurrentTask(taskId, controller)) {
          return;
        }
        chrome.runtime.sendMessage({
          type: MESSAGES.EXTRACTION_PROGRESS,
          payload: { taskId, progress, message, stage, current, total },
        });
      },
      controller.signal,
    );

    // Check if task was cancelled
    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Extraction cancelled');
      return;
    }

    // Get post info from page
    const postInfo = await getPostInfo();

    // 2. Send completion message
    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Extraction cancelled before completion');
      return;
    }

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
    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Extraction cancelled', { taskId });
      return;
    }

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
    globalExtractionState.finishTask(taskId, controller);
  }
}

/**
 * Handle CANCEL_EXTRACTION message
 * @param taskId - Task ID to cancel
 */
function handleCancelExtraction(taskId: string) {
  const cancelled = globalExtractionState.cancelTaskById(taskId);
  if (cancelled) {
    Logger.info('[Content] Cancelling extraction', { taskId });
    sendCancelledCompletion(cancelled.taskId, cancelled.taskType);
  }
}

async function handleStartConfigGeneration(
  data: { taskId: string },
  sendResponse: (response: ConfigGenerationResponse) => void,
) {
  sendResponse({ success: true });

  const { taskId } = data;
  Logger.info('[Content] Starting config generation', { taskId });

  const controller = globalExtractionState.beginTask(taskId, 'config');

  try {
    const { domAnalyzer } = getTools();
    const localPageController = new PageController(domAnalyzer);
    const strategy = new AIStrategy(localPageController);

    try {
      await strategy.generateConfig((progress: number, message: string) => {
        if (!globalExtractionState.isCurrentTask(taskId, controller)) {
          return;
        }
        chrome.runtime.sendMessage({
          type: MESSAGES.EXTRACTION_PROGRESS,
          payload: { taskId, progress, message },
        });
      }, controller.signal);

      if (!globalExtractionState.isCurrentTask(taskId, controller)) {
        Logger.info('[Content] Config generation cancelled');
        return;
      }

      await chrome.runtime.sendMessage({
        type: MESSAGES.CONFIG_GENERATION_COMPLETED,
        payload: { taskId, success: true },
      });

      Logger.info('[Content] Config generation complete');
    } finally {
      strategy.cleanup();
    }
  } catch (error) {
    if (!globalExtractionState.isCurrentTask(taskId, controller)) {
      Logger.info('[Content] Config generation cancelled', { taskId });
      return;
    }

    Logger.error('[Content] Config generation failed', { error });
    await chrome.runtime.sendMessage({
      type: MESSAGES.CONFIG_GENERATION_COMPLETED,
      payload: {
        taskId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  } finally {
    globalExtractionState.finishTask(taskId, controller);
  }
}

function handleTestSelector(
  data: { selector: string; selectorType: 'css' | 'xpath' },
  sendResponse: (response: SelectorTestResponse) => void,
) {
  try {
    const selector = data?.selector?.trim() || '';
    const selectorType = data?.selectorType;

    if (!selector || !selectorType) {
      sendResponse({ success: false, error: 'Selector and selectorType are required' });
      return;
    }

    const { domAnalyzer } = getTools();
    const elements =
      selectorType === 'xpath'
        ? queryXPathAll(document, selector)
        : domAnalyzer.querySelectorAllDeep(document, selector);
    const total = elements.length;
    const limited = elements.slice(0, LIMITS.SELECTOR_TEST_MAX_RESULTS);
    const items = limited.map((element) => {
      const normalized = (element.textContent || '').replace(REGEX.WHITESPACE, ' ').trim();
      if (normalized.length <= LIMITS.SELECTOR_TEST_MAX_TEXT_LENGTH) {
        return normalized;
      }
      return normalized.slice(0, LIMITS.SELECTOR_TEST_MAX_TEXT_LENGTH);
    });

    sendResponse({ success: true, total, items });
  } catch (error) {
    Logger.error('[Content] Selector test failed', { error });
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get post information
 */
async function getPostInfo(): Promise<{
  url: string;
  title: string;
  videoTime?: string;
  postContent?: string;
}> {
  const url = window.location.href;
  const title = document.title;
  let videoTime: string | undefined;
  let postContent: string | undefined;

  const queryElement = (selectorRule: {
    selector: string;
    type: 'css' | 'xpath';
  }): Element | null => {
    if (selectorRule.type === 'xpath') {
      const results = queryXPathAll(document, selectorRule.selector);
      return results.length > 0 ? results[0] : null;
    }
    return document.querySelector(selectorRule.selector);
  };

  try {
    const hostname = getCurrentHostname();
    const response = await chrome.runtime.sendMessage({
      type: MESSAGES.GET_CRAWLING_CONFIG,
      payload: { domain: hostname },
    });

    if (response?.config?.videoTime?.selector) {
      const element = queryElement(response.config.videoTime);
      if (element) {
        videoTime = element.textContent?.trim() || undefined;
        Logger.debug('[Content] Extracted videoTime from config selector', { videoTime });
      }
    }

    if (response?.config?.postContent?.selector) {
      const element = queryElement(response.config.postContent);
      if (element) {
        postContent = element.textContent?.trim() || undefined;
        Logger.debug('[Content] Extracted postContent from config selector', {
          length: postContent?.length || 0,
        });
      }
    }
  } catch (e) {
    Logger.warn('[Content] Failed to get post info from config', { error: e });
  }

  return { url, title, videoTime, postContent };
}

/**
 * Handle GET_DOM_STRUCTURE message
 * Get simplified DOM structure for AI analysis
 */
async function handleGetDOMStructure(sendResponse: (response: DomStructureResponse) => void) {
  try {
    Logger.info('[Content] Getting DOM structure for AI analysis');

    // Get simplified DOM structure
    const simplifier = new DOMSimplifier();
    const domStructure = simplifier.simplifyElement(document.body, {
      maxDepth: DOM.SIMPLIFY_MAX_DEPTH,
      maxNodes: DOM.SIMPLIFY_MAX_NODES,
      includeText: true,
    });

    const textSamples: string[] = [];
    collectTextSamples(domStructure, SCRAPER_GENERATION.MAX_TEXT_SAMPLES, textSamples);

    // Convert to string format
    const domString = simplifier.nodeToString(domStructure);

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
