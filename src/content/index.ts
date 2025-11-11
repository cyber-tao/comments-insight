// Content Script for Comments Insight Extension
import { PlatformDetector } from './PlatformDetector';
import { PageController } from './PageController';
import { CommentExtractorSelector } from './CommentExtractorSelector';

console.log('Comments Insight Content Script loaded');

// Detect platform
const platform = PlatformDetector.detect();
const isValid = PlatformDetector.isValidPage();

console.log('[Content] Platform detected:', platform, 'Valid page:', isValid);

if (isValid) {
  const postInfo = PlatformDetector.getPostInfo();
  console.log('[Content] Post info:', postInfo);
}

// Initialize extractors
const pageController = new PageController();
const selectorExtractor = new CommentExtractorSelector(pageController);

// Track current extraction task
let currentTaskId: string | null = null;

// Listen for messages from background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Content] Received message:', message.type);
  
  // Handle different message types
  switch (message.type) {
    case 'GET_PLATFORM_INFO':
      sendResponse({
        platform,
        isValid,
        postInfo: isValid ? PlatformDetector.getPostInfo() : null,
      });
      break;
    
    case 'START_EXTRACTION':
      handleStartExtraction(message.data, sendResponse);
      return true; // Keep channel open for async response
    
    case 'CANCEL_EXTRACTION':
      handleCancelExtraction(message.data.taskId);
      sendResponse({ success: true });
      break;
    
    case 'GET_DOM_STRUCTURE':
      handleGetDOMStructure(sendResponse);
      return true; // Keep channel open for async response
    
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
  sendResponse: (response: any) => void
) {
  const { taskId, maxComments } = data;
  
  console.log('[Content] Starting extraction, taskId:', taskId);
  
  // Check if valid page
  if (!isValid) {
    sendResponse({
      success: false,
      error: 'Not a valid page for extraction'
    });
    return;
  }
  
  // Set current task
  currentTaskId = taskId;
  
  try {
    // Extract comments with selector-based approach
    const comments = await selectorExtractor.extractWithAI(
      maxComments,
      platform,
      (message, count) => {
        // Send progress update to background
        chrome.runtime.sendMessage({
          type: 'EXTRACTION_PROGRESS',
          data: { taskId, progress: 50, message: `${message} (${count} comments)` }
        });
      }
    );
    
    // Check if task was cancelled
    if (currentTaskId !== taskId) {
      console.log('[Content] Extraction cancelled');
      sendResponse({
        success: false,
        error: 'Extraction cancelled'
      });
      return;
    }
    
    // Get post info
    const postInfo = PlatformDetector.getPostInfo();
    
    // Send success response
    sendResponse({
      success: true,
      comments,
      postInfo
    });
    
    console.log('[Content] Extraction complete:', comments.length, 'comments');
    
  } catch (error) {
    console.error('[Content] Extraction failed:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
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
      maxDepth: 10,
      maxNodes: 1000,
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
