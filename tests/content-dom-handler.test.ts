/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, MESSAGES } from '../src/config/constants';
import {
  getPostInfo,
  handleGetDOMStructure,
  handleTestSelector,
} from '../src/content/handlers/dom';
import { getTools } from '../src/content/handlers/tools';

vi.mock('../src/utils/logger', () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('content/handlers/tools & dom', () => {
  const sendMessageMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    document.title = 'Sample Post Title';
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: sendMessageMock,
      },
    });
  });

  describe('getTools', () => {
    it('returns singleton content tools instances', () => {
      const first = getTools();
      const second = getTools();

      expect(first).toEqual(second);
      expect(first.domAnalyzer).toBe(second.domAnalyzer);
      expect(first.pageController).toBe(second.pageController);
      expect(first.commentExtractor).toBe(second.commentExtractor);
    });
  });

  describe('handleTestSelector', () => {
    it('rejects empty selector or missing selectorType', () => {
      const sendResponse = vi.fn();

      handleTestSelector({ selector: '   ', selectorType: 'css' }, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Selector and selectorType are required',
      });
    });

    it('queries CSS selectors, collapses whitespace, truncates long text, and caps results', () => {
      const overMaxCount = LIMITS.SELECTOR_TEST_MAX_RESULTS + 5;
      const longText = 'A'.repeat(LIMITS.SELECTOR_TEST_MAX_TEXT_LENGTH + 25);
      document.body.innerHTML = [
        `<div class="item">  ${longText}  </div>`,
        ...Array.from(
          { length: overMaxCount - 1 },
          (_, i) => `<div class="item">  Comment   ${i + 1} </div>`,
        ),
      ].join('');

      const sendResponse = vi.fn();
      handleTestSelector({ selector: '.item', selectorType: 'css' }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        total: overMaxCount,
        items: expect.any(Array),
      });
      const payload = sendResponse.mock.calls[0][0];
      expect(payload.items).toHaveLength(LIMITS.SELECTOR_TEST_MAX_RESULTS);
      expect(payload.items[0]).toHaveLength(LIMITS.SELECTOR_TEST_MAX_TEXT_LENGTH);
      expect(payload.items[1]).toBe('Comment 1');
    });

    it('supports XPath selector queries and catches invalid selector syntax errors', () => {
      document.body.innerHTML = '<section><p data-role="reply">Hello XPath</p></section>';
      const sendResponse = vi.fn();

      handleTestSelector(
        { selector: "//p[@data-role='reply']", selectorType: 'xpath' },
        sendResponse,
      );
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        total: 1,
        items: ['Hello XPath'],
      });

      const errorResponse = vi.fn();
      vi.spyOn(getTools().domAnalyzer, 'querySelectorAllDeep').mockImplementationOnce(() => {
        throw new Error('Invalid selector');
      });
      handleTestSelector({ selector: 'div[unclosed', selectorType: 'css' }, errorResponse);
      expect(errorResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid selector',
      });
    });
  });

  describe('getPostInfo', () => {
    it('extracts videoTime and postContent using configured CSS and XPath selectors', async () => {
      document.body.innerHTML = `
        <span class="video-duration"> 12:34 </span>
        <article><div class="post-body">Main post description</div></article>
      `;
      sendMessageMock.mockResolvedValue({
        config: {
          videoTime: { selector: '.video-duration', type: 'css' },
          postContent: { selector: "//div[@class='post-body']", type: 'xpath' },
        },
      });

      const info = await getPostInfo();

      expect(sendMessageMock).toHaveBeenCalledWith({
        type: MESSAGES.GET_CRAWLING_CONFIG,
        payload: { domain: window.location.hostname },
      });
      expect(info).toEqual({
        url: window.location.href,
        title: 'Sample Post Title',
        videoTime: '12:34',
        postContent: 'Main post description',
      });
    });

    it('falls back cleanly when sendMessage fails or selectors do not match', async () => {
      sendMessageMock.mockRejectedValue(new Error('Background unavailable'));

      const info = await getPostInfo();

      expect(info).toEqual({
        url: window.location.href,
        title: 'Sample Post Title',
        videoTime: undefined,
        postContent: undefined,
      });
    });
  });

  describe('handleGetDOMStructure', () => {
    it('simplifies document.body and returns domStructure plus textSamples', async () => {
      document.body.innerHTML = `
        <main id="comments">
          <div class="comment">First comment text</div>
          <div class="comment">Second comment text</div>
        </main>
      `;
      const sendResponse = vi.fn();

      await handleGetDOMStructure(sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        domStructure: expect.stringContaining('<body'),
        textSamples: expect.arrayContaining(['First comment text', 'Second comment text']),
      });
    });

    it('responds with failure when simplifying document throws', async () => {
      const originalBody = document.body;
      Object.defineProperty(document, 'body', {
        configurable: true,
        get: () => {
          throw new Error('DOM unavailable');
        },
      });

      const sendResponse = vi.fn();
      await handleGetDOMStructure(sendResponse);

      Object.defineProperty(document, 'body', {
        configurable: true,
        value: originalBody,
      });

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'DOM unavailable',
      });
    });
  });
});
