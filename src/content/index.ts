// Content Script for Comments Insight Extension
import { PageController } from './PageController';
import { MESSAGES, DOM } from '@/config/constants';
import { CommentExtractorSelector } from './CommentExtractorSelector';

console.log('Comments Insight Content Script loaded');

// Get basic page info
console.log('[Content] Page loaded:', window.location.href);

// Initialize extractors with Shadow DOM support
import { DOMAnalyzer } from './DOMAnalyzer';

const domAnalyzer = new DOMAnalyzer();
const pageController = new PageController(domAnalyzer);
const selectorExtractor = new CommentExtractorSelector(pageController);

// Track current extraction task
let currentTaskId: string | null = null;

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Content] Received message:', message.type);

  // Handle different message types
  switch (message.type) {
    case MESSAGES.GET_PLATFORM_INFO:
      sendResponse({
        url: window.location.href,
        title: document.title,
      });
      break;

    case MESSAGES.START_EXTRACTION:
      handleStartExtraction(message.data, sendResponse);
      return true; // Keep channel open for async response

    case MESSAGES.CANCEL_EXTRACTION:
      handleCancelExtraction(message.data.taskId);
      sendResponse({ success: true });
      break;

    case MESSAGES.GET_DOM_STRUCTURE:
      handleGetDOMStructure(sendResponse);
      return true; // Keep channel open for async response

    case MESSAGES.TEST_SELECTOR_QUERY: {
      try {
        const selector = (message as any)?.payload?.selector as string;
        if (!selector) {
          sendResponse({ success: false, error: 'Missing selector' });
          return true;
        }
        const nodes = domAnalyzer.querySelectorAllDeep(document, selector);
        const items = nodes.map((el: Element, i: number) => ({
          index: i,
          tag: el.tagName.toLowerCase(),
          id: (el as HTMLElement).id || '',
          className: (el as HTMLElement).className || '',
          text: (el.textContent || '').trim().slice(0, 200),
          html: el.outerHTML.slice(0, 200),
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

/**
 * Handle START_EXTRACTION message
 * @param data - Extraction parameters
 * @param sendResponse - Response callback
 */
async function handleStartExtraction(
  data: { taskId: string; maxComments: number },
  sendResponse: (response: any) => void,
) {
  const { taskId, maxComments } = data;

  console.log('[Content] Starting extraction, taskId:', taskId);

  // Set current task
  currentTaskId = taskId;

  try {
    // Fetch scraper config for current URL
    const cfgResponse = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage(
        { type: MESSAGES.CHECK_SCRAPER_CONFIG, payload: { url: window.location.href } },
        resolve,
      );
    });

    if (!cfgResponse?.config || !cfgResponse.config.selectors) {
      console.log('[Content] No scraper config found for current page');
      sendResponse({ success: false, error: 'No scraper config' });
      return;
    }

    // Extract comments using config only (no AI retries)
    const comments = await selectorExtractor.extractWithConfig(
      cfgResponse.config.selectors,
      cfgResponse.config.scrollConfig,
      maxComments,
      'unknown',
      (message: string, count: number) => {
        chrome.runtime.sendMessage({
          type: MESSAGES.EXTRACTION_PROGRESS,
          data: { taskId, progress: 50, message: `${message} (${count} comments)` },
        });
      },
    );

    // Check if task was cancelled
    if (currentTaskId !== taskId) {
      console.log('[Content] Extraction cancelled');
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

    console.log('[Content] Extraction complete:', comments.length, 'comments');
  } catch (error) {
    console.error('[Content] Extraction failed:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    currentTaskId = null;
  }
}

/**
 * Handle CANCEL_EXTRACTION message
 * @param taskId - Task ID to cancel
 */
function handleCancelExtraction(taskId: string) {
  if (currentTaskId === taskId) {
    console.log('[Content] Cancelling extraction:', taskId);
    currentTaskId = null;
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
          console.log('[Content] Extracted video time:', videoTime);
          return { url, title, videoTime };
        }
      }
    }
  } catch (error) {
    console.warn('[Content] Failed to extract video time:', error);
  }

  return { url, title };
}

/**
 * Handle GET_DOM_STRUCTURE message
 * Get simplified DOM structure for AI analysis
 */
async function handleGetDOMStructure(sendResponse: (response: any) => void) {
  try {
    console.log('[Content] Getting DOM structure for AI analysis');

    // Import DOMSimplifier
    const { DOMSimplifier } = await import('./DOMSimplifier');

    // Get simplified DOM structure
    const domStructure = DOMSimplifier.simplifyForAI(document.body, {
      maxDepth: DOM.SIMPLIFY_MAX_DEPTH,
      maxNodes: DOM.SIMPLIFY_MAX_NODES,
      includeText: true,
    });

    // Convert to string format
    const domString = DOMSimplifier.toStringFormat(domStructure);

    console.log('[Content] DOM structure generated, length:', domString.length);

    sendResponse({
      success: true,
      domStructure: domString,
    });
  } catch (error) {
    console.error('[Content] Failed to get DOM structure:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
