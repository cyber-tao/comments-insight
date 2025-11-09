/**
 * PageController handles page interactions like scrolling and clicking
 */
export class PageController {
  /**
   * Scroll to load more content
   * @param maxScrolls - Maximum number of scrolls
   */
  async scrollToLoadMore(maxScrolls: number = 10): Promise<void> {
    let scrollCount = 0;
    
    while (scrollCount < maxScrolls) {
      const previousHeight = document.documentElement.scrollHeight;
      
      // Scroll to bottom
      window.scrollTo(0, document.documentElement.scrollHeight);
      
      // Wait for content to load
      await this.wait(2000);
      
      const newHeight = document.documentElement.scrollHeight;
      
      // Stop if no new content loaded
      if (newHeight === previousHeight) {
        console.log('[PageController] No more content to load');
        break;
      }
      
      scrollCount++;
      console.log(`[PageController] Scrolled ${scrollCount}/${maxScrolls}`);
    }
  }

  /**
   * Expand collapsed replies
   * @param selector - Selector for expand buttons
   */
  async expandReplies(selector: string): Promise<void> {
    const buttons = document.querySelectorAll(selector);
    console.log(`[PageController] Found ${buttons.length} expand buttons`);
    
    for (const button of Array.from(buttons)) {
      try {
        (button as HTMLElement).click();
        await this.wait(500);
      } catch (error) {
        console.warn('[PageController] Failed to click button:', error);
      }
    }
  }

  /**
   * Click "load more" buttons
   * @param selector - Selector for load more buttons
   */
  async clickLoadMore(selector: string): Promise<void> {
    let clickCount = 0;
    const maxClicks = 5;
    
    while (clickCount < maxClicks) {
      const button = document.querySelector(selector) as HTMLElement;
      
      if (!button || !button.offsetParent) {
        // Button not found or not visible
        break;
      }
      
      try {
        button.click();
        await this.wait(1000);
        clickCount++;
        console.log(`[PageController] Clicked load more ${clickCount}/${maxClicks}`);
      } catch (error) {
        console.warn('[PageController] Failed to click load more:', error);
        break;
      }
    }
  }

  /**
   * Wait for element to appear
   * @param selector - CSS selector
   * @param timeout - Timeout in milliseconds
   * @returns Element or null
   */
  async waitForElement(selector: string, timeout: number = 10000): Promise<Element | null> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
      await this.wait(100);
    }
    
    console.warn(`[PageController] Element not found: ${selector}`);
    return null;
  }

  /**
   * Wait for specified milliseconds
   * @param ms - Milliseconds to wait
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
