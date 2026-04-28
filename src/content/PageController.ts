import { DOMAnalyzer } from './DOMAnalyzer';
import { TIMING, SCROLL, CLICK, TIMEOUT, TEXT } from '@/config/constants';
import { isExtractionActive } from './extractionState';
import { Logger } from '../utils/logger';
import { ErrorCode, ExtensionError } from '../utils/errors';

/**
 * PageController handles page interactions like scrolling and clicking
 */
export class PageController {
  constructor(private domAnalyzer?: DOMAnalyzer) {}

  private checkAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ExtensionError(
        ErrorCode.TASK_CANCELLED,
        TEXT.EXTRACTION_CANCELLED_BY_USER,
        {},
        false,
      );
    }
  }

  /**
   * Scroll to bottom smoothly to trigger lazy loading
   */
  async scrollToBottom(signal?: AbortSignal): Promise<void> {
    let totalHeight = document.documentElement.scrollHeight;
    const viewportHeight = window.innerHeight;
    let currentScroll = window.scrollY;
    const startTime = Date.now();

    const step = Math.floor(viewportHeight * SCROLL.SCROLL_STEP_RATIO);

    while (currentScroll < totalHeight) {
      this.checkAborted(signal);
      if (!isExtractionActive()) return;
      if (Date.now() - startTime > SCROLL.MAX_SCROLL_TIMEOUT_MS) {
        Logger.warn('[PageController] scrollToBottom timed out');
        break;
      }

      const nextScroll = Math.min(currentScroll + step, totalHeight);

      if (nextScroll === currentScroll) break;

      window.scrollTo(0, nextScroll);
      currentScroll = nextScroll;

      await this.wait(TIMING.SCROLL_PAUSE_MS, signal);

      const newTotalHeight = document.documentElement.scrollHeight;
      if (newTotalHeight > totalHeight) {
        totalHeight = newTotalHeight;
      }
    }

    window.scrollTo(0, document.documentElement.scrollHeight);
  }

  /**
   * Waits for DOM changes recursively within the target element.
   * Useful to wait for network-bound lazy loaded content to appear.
   * Resolves true if content changed, false if it timed out.
   */
  async waitForDOMChanges(
    target: Node = document.body,
    timeoutMs: number = TIMING.SCROLL_DELAY_MS,
    signal?: AbortSignal,
  ): Promise<boolean> {
    this.checkAborted(signal);

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver((mutations) => {
        const hasMeaningfulChange = mutations.some(
          (m) => m.addedNodes.length > 0 || m.type === 'characterData',
        );
        if (hasMeaningfulChange) {
          cleanup();
          this.wait(TIMING.MICRO_WAIT_MS, signal).then(() => resolve(true), reject);
        }
      });

      const onAbort = () => {
        cleanup();
        reject(
          new ExtensionError(
            ErrorCode.TASK_CANCELLED,
            TEXT.EXTRACTION_CANCELLED_BY_USER,
            {},
            false,
          ),
        );
      };

      function cleanup() {
        observer.disconnect();
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }

      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async scrollContainer(
    container: Element,
    signal?: AbortSignal,
  ): Promise<{ contentChanged: boolean }> {
    this.checkAborted(signal);

    const beforeScrollHeight = container.scrollHeight;
    const beforeChildCount = container.childElementCount;

    const isScrollable =
      container.scrollHeight > container.clientHeight &&
      (container as HTMLElement).style.overflow !== 'hidden';

    if (isScrollable) {
      const scrollStep = SCROLL.CONTAINER_SCROLL_STEP;
      const currentScrollTop = container.scrollTop;
      const maxScrollTop = container.scrollHeight - container.clientHeight;

      if (currentScrollTop < maxScrollTop) {
        container.scrollTo({
          top: Math.min(currentScrollTop + scrollStep, maxScrollTop),
          behavior: 'smooth',
        });
        await this.wait(TIMING.SCROLL_PAUSE_MS, signal);
      }
    } else {
      const containerRect = container.getBoundingClientRect();
      const containerBottom = containerRect.bottom;
      const viewportHeight = window.innerHeight;

      if (containerBottom > viewportHeight) {
        const scrollTarget =
          window.scrollY + Math.min(SCROLL.CONTAINER_SCROLL_STEP, containerBottom - viewportHeight);
        window.scrollTo({
          top: scrollTarget,
          behavior: 'smooth',
        });
        await this.wait(TIMING.SCROLL_PAUSE_MS, signal);
      } else {
        window.scrollTo({
          top: window.scrollY + SCROLL.CONTAINER_SCROLL_STEP,
          behavior: 'smooth',
        });
        await this.wait(TIMING.SCROLL_PAUSE_MS, signal);
      }
    }

    // Use MutationObserver for intelligent waiting rather than static delay
    const contentMutated = await this.waitForDOMChanges(container, TIMING.SCROLL_DELAY_MS, signal);
    if (!contentMutated) {
      Logger.debug(
        '[PageController] No DOM changes detected after scroll, relying on static properties',
      );
    }

    const afterScrollHeight = container.scrollHeight;
    const afterChildCount = container.childElementCount;

    const contentChanged =
      afterScrollHeight !== beforeScrollHeight || afterChildCount !== beforeChildCount;

    return { contentChanged };
  }

  /**
   * Scroll to load more content
   * @param maxScrolls - Maximum number of scrolls
   */
  async scrollToLoadMore(
    maxScrolls: number = SCROLL.DEFAULT_MAX_SCROLLS,
    signal?: AbortSignal,
  ): Promise<void> {
    let scrollCount = 0;
    const startTime = Date.now();

    while (scrollCount < maxScrolls) {
      this.checkAborted(signal);
      if (!isExtractionActive()) return;
      if (Date.now() - startTime > SCROLL.MAX_SCROLL_TIMEOUT_MS) {
        Logger.warn('[PageController] scrollToLoadMore timed out');
        break;
      }

      const previousHeight = document.documentElement.scrollHeight;

      window.scrollTo(0, document.documentElement.scrollHeight);

      await this.wait(TIMING.PAGE_INIT_DELAY_MS, signal);

      const newHeight = document.documentElement.scrollHeight;

      if (newHeight === previousHeight) {
        Logger.info('[PageController] No more content to load');
        break;
      }

      scrollCount++;
    }
    if (scrollCount > 0) {
      Logger.info('[PageController] Finished scrolling', { scrollCount });
    }
  }

  /**
   * Expand collapsed replies (supports Shadow DOM)
   * @param selector - Selector for expand buttons
   */
  async expandReplies(selector: string, signal?: AbortSignal): Promise<void> {
    // Use Shadow DOM-aware query if available
    const buttons = this.domAnalyzer
      ? this.domAnalyzer.querySelectorAllDeep(document, selector)
      : Array.from(document.querySelectorAll(selector));

    Logger.info('[PageController] Found expand buttons', { count: buttons.length });

    for (const button of buttons) {
      this.checkAborted(signal);
      if (!isExtractionActive()) return;
      try {
        (button as HTMLElement).click();
        await this.wait(TIMING.SCROLL_BASE_DELAY_MS, signal);
      } catch (error) {
        if (error instanceof ExtensionError && error.code === ErrorCode.TASK_CANCELLED) {
          throw error;
        }
        // Expected: some expand buttons may not be clickable
      }
    }
  }

  /**
   * Click "load more" buttons
   * @param selector - Selector for load more buttons
   */
  async clickLoadMore(selector: string, signal?: AbortSignal): Promise<void> {
    let clickCount = 0;
    const maxClicks = CLICK.LOAD_MORE_MAX;

    while (clickCount < maxClicks) {
      this.checkAborted(signal);
      if (!isExtractionActive()) return;
      const button = document.querySelector(selector) as HTMLElement;

      if (!button || !button.offsetParent) {
        // Button not found or not visible
        break;
      }

      try {
        button.click();
        await this.wait(TIMING.AI_RETRY_DELAY_MS, signal);
        clickCount++;
      } catch (error) {
        if (error instanceof ExtensionError && error.code === ErrorCode.TASK_CANCELLED) {
          throw error;
        }
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
    signal?: AbortSignal,
  ): Promise<Element | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      this.checkAborted(signal);
      if (!isExtractionActive()) return null;
      // Use Shadow DOM-aware query if available
      const element = this.domAnalyzer
        ? this.domAnalyzer.querySelectorAllDeep(document, selector)[0]
        : document.querySelector(selector);

      if (element) {
        return element;
      }
      await this.wait(TIMING.MICRO_WAIT_MS, signal);
    }

    Logger.warn('[PageController] Element not found', { selector });
    return null;
  }

  /**
   * Wait for specified milliseconds
   * @param ms - Milliseconds to wait
   */
  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    this.checkAborted(signal);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(
          new ExtensionError(
            ErrorCode.TASK_CANCELLED,
            TEXT.EXTRACTION_CANCELLED_BY_USER,
            {},
            false,
          ),
        );
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
