import { DOM, LIMITS, MESSAGES, REGEX, SCRAPER_GENERATION } from '@/config/constants';
import { SimplifiedNode } from '@/types';
import { Logger } from '@/utils/logger';
import { getCurrentHostname } from '@/utils/url';
import { queryXPathAll } from '@/utils/dom-query';
import { DOMSimplifier } from '../DOMSimplifier';
import { DomStructureResponse, SelectorTestResponse } from '@/types/messages';
import { getTools } from './tools';

export function handleTestSelector(
  data: { selector: string; selectorType: 'css' | 'xpath' },
  sendResponse: (response: SelectorTestResponse) => void,
): void {
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

export async function getPostInfo(): Promise<{
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

export async function handleGetDOMStructure(
  sendResponse: (response: DomStructureResponse) => void,
): Promise<void> {
  try {
    Logger.info('[Content] Getting DOM structure for AI analysis');

    const simplifier = new DOMSimplifier();
    const domStructure = simplifier.simplifyElement(document.body, {
      maxDepth: DOM.SIMPLIFY_MAX_DEPTH,
      maxNodes: DOM.SIMPLIFY_MAX_NODES,
      includeText: true,
    });

    const textSamples: string[] = [];
    collectTextSamples(domStructure, SCRAPER_GENERATION.MAX_TEXT_SAMPLES, textSamples);

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
