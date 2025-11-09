// Content Script for Comments Insight Extension
import { PlatformDetector } from './PlatformDetector';
import { DOMAnalyzer } from './DOMAnalyzer';
import { PageController } from './PageController';
import { CommentExtractor } from './CommentExtractor';

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
const domAnalyzer = new DOMAnalyzer();
const pageController = new PageController();
const commentExtractor = new CommentExtractor(domAnalyzer, pageController);

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
    // Extract comments with AI
    const comments = await commentExtractor.extractWithAI(
      maxComments,
      platform,
      (progress, message) => {
        // Send progress update to background
        chrome.runtime.sendMessage({
          type: 'EXTRACTION_PROGRESS',
          data: { taskId, progress, message }
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
