import { MESSAGES, EXTRACTION_DEFAULTS } from '@/config/constants';
import type { ContentMessage } from '@/types';
import { Logger } from '@/utils/logger';
import { handleStartExtraction, handleCancelExtraction } from './handlers/extraction';
import { handleStartConfigGeneration } from './handlers/config-generation';
import { handleGetDOMStructure, handleTestSelector } from './handlers/dom';

interface GlobalWithInsight {
  __COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasTaskId(payload: unknown): payload is Record<string, unknown> & { taskId: string } {
  return isRecord(payload) && typeof payload.taskId === 'string' && payload.taskId.length > 0;
}

function isContentMessage(value: unknown): value is ContentMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  switch (value.type) {
    case MESSAGES.PING:
    case MESSAGES.GET_PLATFORM_INFO:
    case MESSAGES.GET_DOM_STRUCTURE:
      return value.payload === undefined;
    case MESSAGES.RUN_EXTRACTION:
      return (
        hasTaskId(value.payload) &&
        typeof value.payload.maxComments === 'number' &&
        Number.isInteger(value.payload.maxComments) &&
        value.payload.maxComments > 0
      );
    case MESSAGES.RUN_CONFIG_GENERATION:
    case MESSAGES.CANCEL_EXTRACTION:
      return hasTaskId(value.payload);
    case MESSAGES.TEST_SELECTOR:
      return (
        isRecord(value.payload) &&
        typeof value.payload.selector === 'string' &&
        value.payload.selector.length > 0 &&
        (value.payload.selectorType === 'css' || value.payload.selectorType === 'xpath')
      );
    default:
      return false;
  }
}

const globalInsight = globalThis as GlobalWithInsight;

if (!globalInsight.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED) {
  globalInsight.__COMMENTS_INSIGHT_CONTENT_SCRIPT_LOADED = true;

  Logger.debug('Comments Insight Content Script loaded');
  Logger.debug('[Content] Page loaded', { href: window.location.href });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isContentMessage(message)) {
      sendResponse({ success: false, error: 'Invalid content message' });
      return false;
    }
    Logger.debug('[Content] Received message', { type: message.type });

    switch (message.type) {
      case MESSAGES.PING:
        sendResponse({ status: 'ok' });
        break;

      case MESSAGES.GET_PLATFORM_INFO:
        sendResponse({
          url: window.location.href,
          title: document.title,
        });
        break;

      case MESSAGES.RUN_EXTRACTION:
        handleStartExtraction(message.payload, sendResponse);
        return true;

      case MESSAGES.RUN_CONFIG_GENERATION:
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

        handleStartExtraction(
          { taskId, maxComments },
          () => {},
          (outcome) => {
            // Consumed by scripts/test-youtube.js via page console scraping.
            // eslint-disable-next-line no-console
            console.log(`__TEST_RESULT__:${JSON.stringify(outcome)}`);
          },
        );
      }
    });
  }
}
