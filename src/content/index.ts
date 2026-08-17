import { MESSAGES, EXTRACTION_DEFAULTS } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { handleStartExtraction, handleCancelExtraction } from './handlers/extraction';
import { handleStartConfigGeneration } from './handlers/config-generation';
import { handleGetDOMStructure, handleTestSelector } from './handlers/dom';

interface GlobalWithInsight {
  __COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED?: boolean;
}

const globalInsight = globalThis as GlobalWithInsight;

if (!globalInsight.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED) {
  globalInsight.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED = true;

  Logger.debug('Comments Insight Content Script loaded');
  Logger.debug('[Content] Page loaded', { href: window.location.href });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    Logger.debug('[Content] Received message', { type: message.type });

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
        return true;

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

        const maxComments = event.data.maxComments || EXTRACTION_DEFAULTS.TEST_MAX_COMMENTS;
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
