import { ExtractionStrategy, ProgressCallback } from './ExtractionStrategy';
import { Comment, Platform, CrawlingConfig, FieldSelector, ReplyConfig } from '../../types';
import { PageController } from '../PageController';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import { EXTRACTION_PROGRESS, TIMING, DOM } from '@/config/constants';
import { isExtractionActive } from '../extractionState';

export class ConfiguredStrategy implements ExtractionStrategy {
  constructor(
    private pageController: PageController,
    private config: CrawlingConfig,
  ) { }

  cleanup(): void {
    // No specific resources to cleanup for this strategy
  }

  private checkAborted(): void {
    if (!isExtractionActive()) {
      throw new ExtensionError(ErrorCode.TASK_CANCELLED, 'Extraction cancelled by user', {}, false);
    }
  }

  async execute(
    maxComments: number,
    platform: Platform,
    onProgress?: ProgressCallback,
  ): Promise<Comment[]> {
    Logger.info('[ConfiguredStrategy] Starting extraction with config', {
      domain: this.config.domain,
    });
    onProgress?.(
      EXTRACTION_PROGRESS.MIN,
      'Finding comment container',
      'initializing',
      0,
      maxComments,
    );

    const containerSelector = this.config.container.selector;
    let container = document.querySelector(containerSelector);

    if (!container) {
      // Try waiting
      await this.delay(TIMING.SHORT_WAIT_MS);
      container = document.querySelector(containerSelector);
      if (!container) {
        throw new ExtensionError(
          ErrorCode.DOM_ANALYSIS_FAILED,
          `Comment container not found: ${containerSelector}`,
        );
      }
    }

    const allComments: Comment[] = [];
    let noNewCommentsCount = 0;
    let scrollCount = 0;
    // Track elements that have been processed as replies to avoid duplication at top level
    // Now simplified to just use logic skip, but we still need to track processed *items* to avoid re-clicking expand buttons
    // The previous logic issue: We iterate all items every scroll. We MUST skip items we already touched.
    const seenHashes = new Set<string>();
    // Track elements that have been processed as replies to avoid duplication at top level
    // Now simplified to just use logic skip, but we still need to track processed *items* to avoid re-clicking expand buttons
    // The previous logic issue: We iterate all items every scroll. We MUST skip items we already touched.
    const processedElements = new WeakSet<HTMLElement>();

    onProgress?.(EXTRACTION_PROGRESS.MIN + 5, 'Extracting comments', 'extracting', 0, maxComments);

    let unchangedScrollCount = 0;
    const MAX_UNCHANGED_SCROLLS = 3;

    while (allComments.length < maxComments) {
      this.checkAborted();

      if (noNewCommentsCount >= DOM.NO_NEW_COMMENTS_THRESHOLD) {
        break;
      }

      // 1. Extract visible items
      const items = Array.from(container.querySelectorAll(this.config.item.selector));
      let added = 0;

      for (const itemElement of items) {
        // 0. Skip if already processed (prevent re-clicking expand buttons)
        if (processedElements.has(itemElement as HTMLElement)) {
          continue;
        }
        processedElements.add(itemElement as HTMLElement);

        // DOM Hierarchy Check:
        // If this element is nested inside another element that ALSO matches the item selector,
        // then it is a child/reply, not a top-level comment. We should skip it here.
        // It will be extracted when we process its parent.
        const parentItem = itemElement.parentElement?.closest(this.config.item.selector);
        if (parentItem && container.contains(parentItem)) {
          continue;
        }

        const comment = await this.extractCommentFromElement(itemElement as HTMLElement, platform);
        if (comment) {
          const hash = this.generateHash(comment);
          if (!seenHashes.has(hash)) {
            comment.id = hash; // Assign hash as ID
            seenHashes.add(hash);
            allComments.push(comment);
            added++;
          }
        }
      }

      if (added === 0) {
        noNewCommentsCount++;
      } else {
        noNewCommentsCount = 0;
      }

      if (allComments.length >= maxComments) break;

      onProgress?.(
        Math.min(90, EXTRACTION_PROGRESS.MIN + (allComments.length / maxComments) * 70),
        `extracting:${allComments.length}:${maxComments}`,
        'extracting',
        allComments.length,
        maxComments,
      );

      const beforeScrollHeight = container.scrollHeight;
      const beforeChildCount = container.childElementCount;

      await this.pageController.scrollToBottom();
      await this.delay(TIMING.SCROLL_DELAY_MS);
      scrollCount++;

      // Re-query container in case of re-render
      const newContainer = document.querySelector(containerSelector);
      if (newContainer) {
        container = newContainer;
      }

      // Check if content grew
      const afterScrollHeight = container.scrollHeight;
      const afterChildCount = container.childElementCount;

      if (afterScrollHeight === beforeScrollHeight && afterChildCount === beforeChildCount) {
        unchangedScrollCount++;
        Logger.debug('[ConfiguredStrategy] Scroll didn\'t load new content', { unchangedScrollCount });
        if (unchangedScrollCount >= MAX_UNCHANGED_SCROLLS) {
          Logger.info('[ConfiguredStrategy] Reached bottom of content (no size change). Stopping.');
          break;
        }
      } else {
        unchangedScrollCount = 0;
      }
    }

    return allComments.slice(0, maxComments);
  }

  private async extractCommentFromElement(
    element: HTMLElement,
    platform: Platform,
  ): Promise<Comment | null> {
    try {
      const username = this.extractField(
        element,
        this.config.fields.find((f) => f.name === 'username'),
      );
      const content = this.extractField(
        element,
        this.config.fields.find((f) => f.name === 'content'),
      );
      // ... fields extraction ...

      // Log basic extraction just to be sure we are looking at the right element
      // Logger.debug('[ReplyDebug] Examining comment', { username: username?.slice(0, 20) });

      // ... (existing code) ...

      const timestamp =
        this.extractField(
          element,
          this.config.fields.find((f) => f.name === 'timestamp'),
        ) || 'N/A';
      const likesStr =
        this.extractField(
          element,
          this.config.fields.find((f) => f.name === 'likes'),
        ) || '0';

      if (!username && !content) return null;

      const comment: Comment = {
        id: '',
        username: username || 'Unknown',
        content: content || '',
        timestamp,
        likes: this.parseLikes(likesStr),
        platform,
        replies: [],
      };

      // Handle Replies
      if (this.config.replies) {
        const replyConfig = this.config.replies;

        // 1. Check for expand button
        if (replyConfig.expandBtn) {
          const expandBtn = element.querySelector(replyConfig.expandBtn.selector) as HTMLElement;
          if (expandBtn) {
            Logger.info('[ReplyDebug] Found expand button', { selector: replyConfig.expandBtn.selector, text: expandBtn.textContent || '' });

            // Scroll into view to trigger lazy loading and ensure clickability
            expandBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await this.delay(TIMING.SCROLL_INTO_VIEW_WAIT_MS); // Wait for scroll

            // Click to expand
            try {
              expandBtn.click();
              Logger.info('[ReplyDebug] Clicked expand button');

              // Smart wait: Poll for replies to appear
              await this.waitForReplies(element, replyConfig);
            } catch (e: any) {
              Logger.error('[ReplyDebug] Failed to click expand button', { error: e.message || String(e) });
            }
          } else {
            // Logger.debug('[ReplyDebug] Expand button NOT found', { selector: replyConfig.expandBtn.selector });
          }
        }

        // 2. Find reply container
        const replyContainer = element.querySelector(replyConfig.container.selector);
        if (replyContainer) {
          const replyItems = Array.from(replyContainer.querySelectorAll(replyConfig.item.selector));
          if (replyItems.length > 0) Logger.info(`[ReplyDebug] Found ${replyItems.length} reply items`);

          for (const replyItem of replyItems) {
            const reply = await this.extractReplyFromElement(
              replyItem as HTMLElement,
              platform,
              replyConfig,
            );
            if (reply) {
              comment.replies.push(reply);
            }
          }
        } else {
          // If we clicked a button but still no container found, that's suspicious but maybe it takes longer or structure is different
          // Logger.debug('[ReplyDebug] Reply container NOT found', { selector: replyConfig.container.selector });
        }
      }

      return comment;
    } catch (e: any) {
      Logger.error('[ReplyDebug] Error extracting comment', { error: e.message || String(e) });
      return null;
    }
  }

  private async extractReplyFromElement(
    element: HTMLElement,
    platform: Platform,
    replyConfig: ReplyConfig,
  ): Promise<Comment | null> {
    // ... extraction logic ...
    const username = this.extractField(
      element,
      replyConfig.fields.find((f) => f.name === 'username'),
    );
    const content = this.extractField(
      element,
      replyConfig.fields.find((f) => f.name === 'content'),
    );
    // ...
    const timestamp =
      this.extractField(
        element,
        replyConfig.fields.find((f) => f.name === 'timestamp'),
      ) || 'N/A';
    const likesStr =
      this.extractField(
        element,
        replyConfig.fields.find((f) => f.name === 'likes'),
      ) || '0';

    if (!username && !content) return null;

    const comment: Comment = {
      id: '',
      username: username || 'Unknown',
      content: content || '',
      timestamp,
      likes: this.parseLikes(likesStr),
      platform,
      replies: [],
    };
    comment.id = this.generateHash(comment);

    // Recursive Reply Extraction
    if (replyConfig.expandBtn) {
      const expandBtn = element.querySelector(replyConfig.expandBtn.selector) as HTMLElement;
      if (expandBtn) {
        try {
          Logger.info('[ReplyDebug] Found nested expand button', { selector: replyConfig.expandBtn.selector });
          expandBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await this.delay(TIMING.SCROLL_INTO_VIEW_WAIT_MS);
          expandBtn.click();
          await this.waitForReplies(element, replyConfig);
        } catch (e: any) {
          Logger.error('[ReplyDebug] Failed to click nested expand button', { error: e.message || String(e) });
        }
      }
    }

    const replyContainer = element.querySelector(replyConfig.container.selector);
    if (replyContainer) {
      const replyItems = Array.from(replyContainer.querySelectorAll(replyConfig.item.selector));
      if (replyItems.length > 0) Logger.info(`[ReplyDebug] Found ${replyItems.length} nested replies`);

      for (const replyItem of replyItems) {
        const reply = await this.extractReplyFromElement(
          replyItem as HTMLElement,
          platform,
          replyConfig,
        );
        if (reply) {
          comment.replies.push(reply);
        }
      }
    }

    return comment;
  }

  private extractField(context: HTMLElement, field?: FieldSelector): string | null {
    if (!field) return null;

    // Support multiple comma-separated selectors in one rule (standard CSS)
    const element = context.querySelector(field.rule.selector);
    if (!element) return null;

    if (field.attribute) {
      return element.getAttribute(field.attribute);
    }

    return element.textContent?.trim() || null;
  }

  private parseLikes(likesStr: string): number {
    const clean = likesStr.replace(/[^0-9kKmM\.]/g, '').toLowerCase();
    let multiplier = 1;
    if (clean.includes('k')) multiplier = 1000;
    if (clean.includes('m')) multiplier = 1000000;

    const val = parseFloat(clean);
    return isNaN(val) ? 0 : Math.floor(val * multiplier);
  }

  private generateHash(comment: Comment): string {
    const str = `${comment.username}|${comment.content}|${comment.timestamp}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private async waitForReplies(
    element: HTMLElement,
    replyConfig: ReplyConfig
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < TIMING.REPLY_POLL_TIMEOUT_MS) {
      const replyContainer = element.querySelector(replyConfig.container.selector);
      if (replyContainer) {
        const items = replyContainer.querySelectorAll(replyConfig.item.selector);
        if (items.length > 0) {
          // Found items!
          // Add a tiny extra delay for render stability
          await this.delay(TIMING.RENDER_STABILITY_WAIT_MS);
          return;
        }
      }
      await this.delay(TIMING.REPLY_POLL_INTERVAL_MS);
    }

    Logger.debug('[ReplyDebug] Timed out waiting for replies to appear');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
