import { TIMING, SCROLL, TEXT } from '@/config/constants';
import { isExtractionActive } from './extractionState';
import { Logger } from '../utils/logger';
import { ErrorCode, ExtensionError } from '@/utils/error-types';
import { checkAborted, abortableDelay } from './utils/abort';

function hasContentMutation(mutations: MutationRecord[]): boolean {
  return mutations.some(
    (mutation) =>
      mutation.type === 'characterData' ||
      mutation.addedNodes.length > 0 ||
      mutation.removedNodes.length > 0,
  );
}

/**
 * PageController handles page interactions like scrolling and waiting for DOM updates
 */
export class PageController {
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
      checkAborted(signal, false);
      if (!isExtractionActive()) return;
      if (Date.now() - startTime > SCROLL.MAX_SCROLL_TIMEOUT_MS) {
        Logger.warn('[PageController] scrollToBottom timed out');
        break;
      }

      const nextScroll = Math.min(currentScroll + step, totalHeight);

      if (nextScroll === currentScroll) break;

      window.scrollTo(0, nextScroll);
      currentScroll = nextScroll;

      await abortableDelay(TIMING.SCROLL_PAUSE_MS, signal, false);

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
    checkAborted(signal, false);

    return new Promise((resolve, reject) => {
      const observer = new MutationObserver((mutations) => {
        if (hasContentMutation(mutations)) {
          cleanup();
          abortableDelay(TIMING.MICRO_WAIT_MS, signal, false).then(() => resolve(true), reject);
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
    checkAborted(signal, false);

    const beforeScrollHeight = container.scrollHeight;
    const beforeChildCount = container.childElementCount;
    let contentMutated = false;
    const observer = new MutationObserver((mutations) => {
      contentMutated ||= hasContentMutation(mutations);
    });
    // Virtual lists can replace text during the scroll pause without changing
    // either geometry or child count. Observe before triggering the scroll.
    observer.observe(container, { childList: true, subtree: true, characterData: true });

    try {
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
          await abortableDelay(TIMING.SCROLL_PAUSE_MS, signal, false);
        }
      } else {
        const containerRect = container.getBoundingClientRect();
        const containerBottom = containerRect.bottom;
        const viewportHeight = window.innerHeight;

        if (containerBottom > viewportHeight) {
          const scrollTarget =
            window.scrollY +
            Math.min(SCROLL.CONTAINER_SCROLL_STEP, containerBottom - viewportHeight);
          window.scrollTo({
            top: scrollTarget,
            behavior: 'smooth',
          });
          await abortableDelay(TIMING.SCROLL_PAUSE_MS, signal, false);
        } else {
          window.scrollTo({
            top: window.scrollY + SCROLL.CONTAINER_SCROLL_STEP,
            behavior: 'smooth',
          });
          await abortableDelay(TIMING.SCROLL_PAUSE_MS, signal, false);
        }
      }

      // Use MutationObserver for intelligent waiting rather than static delay
      if (contentMutated) {
        await abortableDelay(TIMING.MICRO_WAIT_MS, signal, false);
      } else {
        contentMutated = await this.waitForDOMChanges(container, TIMING.SCROLL_DELAY_MS, signal);
      }
      if (!contentMutated) {
        Logger.debug(
          '[PageController] No DOM changes detected after scroll, relying on static properties',
        );
      }

      const afterScrollHeight = container.scrollHeight;
      const afterChildCount = container.childElementCount;

      const contentChanged =
        contentMutated ||
        afterScrollHeight !== beforeScrollHeight ||
        afterChildCount !== beforeChildCount;

      return { contentChanged };
    } finally {
      observer.disconnect();
    }
  }
}
