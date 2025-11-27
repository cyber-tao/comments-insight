import { DOMAnalyzer } from './DOMAnalyzer';
import { TIMING, SCROLL, CLICK, TIMEOUT } from '@/config/constants';
import { Logger } from '../utils/logger';

/**
 * PageController handles page interactions like scrolling and clicking
 */
export class PageController {
  constructor(private domAnalyzer?: DOMAnalyzer) {}
  /**
   * Scroll to bottom smoothly to trigger lazy loading
   */
  async scrollToBottom(): Promise<void> {
    let totalHeight = document.documentElement.scrollHeight;
    const viewportHeight = window.innerHeight;
    let currentScroll = window.scrollY;

    // Scroll in steps to trigger lazy loading
    // We scroll slightly less than a viewport to ensure overlap
    const step = Math.floor(viewportHeight * SCROLL.SCROLL_STEP_RATIO);

    while (currentScroll < totalHeight) {
      // Calculate next position
      const nextScroll = Math.min(currentScroll + step, totalHeight);

      if (nextScroll === currentScroll) break; // Already at bottom

      window.scrollTo(0, nextScroll);
      currentScroll = nextScroll;

      // Small pause to allow browser to register scroll event and trigger IO observers
      await this.wait(TIMING.SCROLL_PAUSE_MS);

      // Update total height in case content expanded
      const newTotalHeight = document.documentElement.scrollHeight;
      if (newTotalHeight > totalHeight) {
        // Content grew, we update totalHeight to continue scrolling
        totalHeight = newTotalHeight;
      }
    }

    // Ensure we are really at the bottom
    window.scrollTo(0, document.documentElement.scrollHeight);
  }

  /**
   * Scroll to load more content
   * @param maxScrolls - Maximum number of scrolls
   */
  async scrollToLoadMore(maxScrolls: number = SCROLL.DEFAULT_MAX_SCROLLS): Promise<void> {
    let scrollCount = 0;

    while (scrollCount < maxScrolls) {
      const previousHeight = document.documentElement.scrollHeight;

      // Scroll to bottom
      window.scrollTo(0, document.documentElement.scrollHeight);

      // Wait for content to load
      await this.wait(TIMING.PAGE_INIT_DELAY_MS);

      const newHeight = document.documentElement.scrollHeight;

      // Stop if no new content loaded
      if (newHeight === previousHeight) {
        Logger.info('[PageController] No more content to load');
        break;
      }

      scrollCount++;
      // Logger.debug('[PageController] Scrolled', { scrollCount, maxScrolls });
    }
    if (scrollCount > 0) {
      Logger.info('[PageController] Finished scrolling', { scrollCount });
    }
  }

  /**
   * Expand collapsed replies (supports Shadow DOM)
   * @param selector - Selector for expand buttons
   */
  async expandReplies(selector: string): Promise<void> {
    // Use Shadow DOM-aware query if available
    const buttons = this.domAnalyzer
      ? this.domAnalyzer.querySelectorAllDeep(document, selector)
      : Array.from(document.querySelectorAll(selector));

    Logger.info('[PageController] Found expand buttons', { count: buttons.length });

    for (const button of buttons) {
      try {
        (button as HTMLElement).click();
        await this.wait(TIMING.SCROLL_BASE_DELAY_MS);
      } catch (error) {
        // Logger.warn('[PageController] Failed to click button', { error });
      }
    }
  }

  /**
   * Click "load more" buttons
   * @param selector - Selector for load more buttons
   */
  async clickLoadMore(selector: string): Promise<void> {
    let clickCount = 0;
    const maxClicks = CLICK.LOAD_MORE_MAX;

    while (clickCount < maxClicks) {
      const button = document.querySelector(selector) as HTMLElement;

      if (!button || !button.offsetParent) {
        // Button not found or not visible
        break;
      }

      try {
        button.click();
        await this.wait(TIMING.AI_RETRY_DELAY_MS);
        clickCount++;
        // Logger.debug('[PageController] Clicked load more', { clickCount, maxClicks });
      } catch (error) {
        Logger.warn('[PageController] Failed to click load more', { error });
        break;
      }
    }
    if (clickCount > 0) {
      Logger.info('[PageController] Clicked load more buttons', { count: clickCount });
    }
  }

  /**
   * Wait for element to appear (supports Shadow DOM)
   * @param selector - CSS selector
   * @param timeout - Timeout in milliseconds
   * @returns Element or null
   */
  async waitForElement(
    selector: string,
    timeout: number = TIMEOUT.WAIT_ELEMENT_MS,
  ): Promise<Element | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Use Shadow DOM-aware query if available
      const element = this.domAnalyzer
        ? this.domAnalyzer.querySelectorAllDeep(document, selector)[0]
        : document.querySelector(selector);

      if (element) {
        return element;
      }
      await this.wait(TIMING.MICRO_WAIT_MS);
    }

    Logger.warn('[PageController] Element not found', { selector });
    return null;
  }

  /**
   * Wait for specified milliseconds
   * @param ms - Milliseconds to wait
   */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
