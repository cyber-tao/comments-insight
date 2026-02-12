import { ExtractionStrategy, ProgressCallback } from './ExtractionStrategy';
import {
  Comment,
  Platform,
  CrawlingConfig,
  FieldSelector,
  FieldValidationStatus,
  ReplyConfig,
} from '../../types';
import { PageController } from '../PageController';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '@/utils/errors';
import {
  EXTRACTION_PROGRESS,
  MESSAGES,
  TIMING,
  DOM,
  LIKES,
  ANALYSIS_FORMAT,
  REGEX,
} from '@/config/constants';
import { sendMessage } from '@/utils/chrome-message';
import { isExtractionActive } from '../extractionState';
import { querySelectorAllDeep, querySelectorDeep } from '@/utils/dom-query';

export class ConfiguredStrategy implements ExtractionStrategy {
  private validationRecorded = false;

  constructor(
    private pageController: PageController,
    private config: CrawlingConfig,
  ) {}

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
    let container = querySelectorDeep(document, containerSelector);

    if (!container) {
      // Try waiting
      await this.delay(TIMING.SHORT_WAIT_MS);
      container = querySelectorDeep(document, containerSelector);
      if (!container) {
        throw new ExtensionError(
          ErrorCode.DOM_ANALYSIS_FAILED,
          `Comment container not found: ${containerSelector}`,
        );
      }
    }

    const allComments: Comment[] = [];
    let noNewCommentsCount = 0;
    let _scrollCount = 0;
    // Track elements that have been processed as replies to avoid duplication at top level
    // Now simplified to just use logic skip, but we still need to track processed *items* to avoid re-clicking expand buttons
    // The previous logic issue: We iterate all items every scroll. We MUST skip items we already touched.
    const seenHashes = new Set<string>();
    // Track elements that have been processed as replies to avoid duplication at top level
    // Now simplified to just use logic skip, but we still need to track processed *items* to avoid re-clicking expand buttons
    // The previous logic issue: We iterate all items every scroll. We MUST skip items we already touched.
    const processedElements = new WeakSet<HTMLElement>();

    onProgress?.(EXTRACTION_PROGRESS.MIN + 5, 'Extracting comments', 'extracting', 0, maxComments);

    this.recordFieldValidation(container);

    while (allComments.length < maxComments) {
      this.checkAborted();

      if (noNewCommentsCount >= DOM.NO_NEW_COMMENTS_THRESHOLD) {
        break;
      }

      // 1. Extract visible items (use deep query for Shadow DOM support)
      const items = querySelectorAllDeep(container, this.config.item.selector);
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

        // Scroll element into view to trigger lazy loading before extraction
        (itemElement as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
        await this.delay(TIMING.SCROLL_PAUSE_MS);

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
        Math.min(
          EXTRACTION_PROGRESS.NORMALIZING,
          EXTRACTION_PROGRESS.MIN + (allComments.length / maxComments) * EXTRACTION_PROGRESS.RANGE,
        ),
        `extracting:${allComments.length}:${maxComments}`,
        'extracting',
        allComments.length,
        maxComments,
      );

      // Scroll container to load more items
      const { contentChanged } = await this.pageController.scrollContainer(container);
      _scrollCount++;

      // Re-query container in case of re-render
      const newContainer = querySelectorDeep(document, containerSelector);
      if (newContainer) {
        container = newContainer;
      }

      // If content changed, reset noNewCommentsCount as new items may appear
      if (contentChanged) {
        noNewCommentsCount = Math.max(0, noNewCommentsCount - 1);
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

      // ... (existing code) ...

      const timestamp =
        this.extractField(
          element,
          this.config.fields.find((f) => f.name === 'timestamp'),
        ) || ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP;
      const likesStr =
        this.extractField(
          element,
          this.config.fields.find((f) => f.name === 'likes'),
        ) || '0';

      if (!username && !content) return null;

      const comment: Comment = {
        id: '',
        username: username || ANALYSIS_FORMAT.UNKNOWN_USERNAME,
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
          const expandBtn = querySelectorDeep(
            element,
            replyConfig.expandBtn.selector,
          ) as HTMLElement;
          if (expandBtn) {
            Logger.info('[ReplyDebug] Found expand button', {
              selector: replyConfig.expandBtn.selector,
              text: expandBtn.textContent || '',
            });

            // Get current reply count before clicking
            const replyContainer = querySelectorDeep(element, replyConfig.container.selector);
            const currentReplyCount = replyContainer
              ? querySelectorAllDeep(replyContainer, replyConfig.item.selector).length
              : 0;

            // Scroll into view to trigger lazy loading and ensure clickability
            expandBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await this.delay(TIMING.SCROLL_INTO_VIEW_WAIT_MS); // Wait for scroll

            // Click to expand
            try {
              expandBtn.click();
              Logger.info('[ReplyDebug] Clicked expand button', { currentReplyCount });

              // Smart wait: Poll for reply count to INCREASE
              await this.waitForReplies(element, replyConfig, currentReplyCount);
            } catch (e: unknown) {
              Logger.error('[ReplyDebug] Failed to click expand button', {
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }

        // 2. Find reply container
        const replyContainer = querySelectorDeep(element, replyConfig.container.selector);
        if (replyContainer) {
          const replyItems = querySelectorAllDeep(replyContainer, replyConfig.item.selector);
          if (replyItems.length > 0)
            Logger.info(`[ReplyDebug] Found ${replyItems.length} reply items`);

          for (const replyItem of replyItems) {
            const reply = await this.extractReplyFromElement(
              replyItem as HTMLElement,
              platform,
              replyConfig,
              0,
            );
            if (reply) {
              comment.replies.push(reply);
            }
          }
        } else {
        }
      }

      return comment;
    } catch (e: unknown) {
      Logger.error('[ReplyDebug] Error extracting comment', {
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  private async extractReplyFromElement(
    element: HTMLElement,
    platform: Platform,
    replyConfig: ReplyConfig,
    depth: number = 0,
  ): Promise<Comment | null> {
    if (depth >= DOM.MAX_REPLY_DEPTH) {
      Logger.warn('[ConfiguredStrategy] Max reply depth reached', { depth });
      return null;
    }

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
      ) || ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP;
    const likesStr =
      this.extractField(
        element,
        replyConfig.fields.find((f) => f.name === 'likes'),
      ) || '0';

    if (!username && !content) return null;

    const comment: Comment = {
      id: '',
      username: username || ANALYSIS_FORMAT.UNKNOWN_USERNAME,
      content: content || '',
      timestamp,
      likes: this.parseLikes(likesStr),
      platform,
      replies: [],
    };
    comment.id = this.generateHash(comment);

    // Recursive Reply Extraction
    if (replyConfig.expandBtn) {
      const expandBtn = querySelectorDeep(element, replyConfig.expandBtn.selector) as HTMLElement;
      if (expandBtn) {
        try {
          // Get current reply count before clicking
          const nestedContainer = querySelectorDeep(element, replyConfig.container.selector);
          const currentNestedCount = nestedContainer
            ? querySelectorAllDeep(nestedContainer, replyConfig.item.selector).length
            : 0;

          Logger.info('[ReplyDebug] Found nested expand button', {
            selector: replyConfig.expandBtn.selector,
            currentNestedCount,
          });
          expandBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await this.delay(TIMING.SCROLL_INTO_VIEW_WAIT_MS);
          expandBtn.click();
          await this.waitForReplies(element, replyConfig, currentNestedCount);
        } catch (e: unknown) {
          Logger.error('[ReplyDebug] Failed to click nested expand button', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    const replyContainer = querySelectorDeep(element, replyConfig.container.selector);
    if (replyContainer) {
      const replyItems = querySelectorAllDeep(replyContainer, replyConfig.item.selector);
      if (replyItems.length > 0)
        Logger.info(`[ReplyDebug] Found ${replyItems.length} nested replies`);

      for (const replyItem of replyItems) {
        const reply = await this.extractReplyFromElement(
          replyItem as HTMLElement,
          platform,
          replyConfig,
          depth + 1,
        );
        if (reply) {
          comment.replies.push(reply);
        }
      }
    }

    return comment;
  }

  private recordFieldValidation(container: Element): void {
    if (this.validationRecorded) return;
    this.validationRecorded = true;

    const validation: Record<string, FieldValidationStatus> = {};

    validation['container'] = container ? 'success' : 'failed';

    const firstItem = querySelectorDeep(container, this.config.item.selector);
    validation['item'] = firstItem ? 'success' : 'failed';

    if (firstItem) {
      for (const field of this.config.fields) {
        const result = querySelectorDeep(firstItem, field.rule.selector);
        validation[field.name] = result ? 'success' : 'failed';
      }
    }

    if (this.config.replies) {
      const replyConfig = this.config.replies;
      if (firstItem) {
        const replyContainer = querySelectorDeep(firstItem, replyConfig.container.selector);
        validation['replies.container'] = replyContainer ? 'success' : 'failed';
        if (replyContainer) {
          const replyItem = querySelectorDeep(replyContainer, replyConfig.item.selector);
          validation['replies.item'] = replyItem ? 'success' : 'failed';
        }
        if (replyConfig.expandBtn?.selector) {
          const expandBtn = querySelectorDeep(firstItem, replyConfig.expandBtn.selector);
          validation['replies.expandBtn'] = expandBtn ? 'success' : 'failed';
        }
      }
    }

    if (this.config.videoTime?.selector) {
      const el = querySelectorDeep(document, this.config.videoTime.selector);
      validation['videoTime'] = el ? 'success' : 'failed';
    }
    if (this.config.postContent?.selector) {
      const el = querySelectorDeep(document, this.config.postContent.selector);
      validation['postContent'] = el ? 'success' : 'failed';
    }

    sendMessage({
      type: MESSAGES.UPDATE_FIELD_VALIDATION,
      payload: { domain: this.config.domain, fieldValidation: validation },
    }).catch((err) => {
      Logger.warn('[ConfiguredStrategy] Failed to save field validation', { error: err });
    });

    Logger.info('[ConfiguredStrategy] Field validation recorded', { validation });
  }

  private extractField(context: HTMLElement, field?: FieldSelector): string | null {
    if (!field) return null;

    // Support multiple comma-separated selectors in one rule (standard CSS)
    // Use querySelectorDeep for Shadow DOM support
    const element = querySelectorDeep(context, field.rule.selector);
    if (!element) return null;

    if (field.attribute) {
      return element.getAttribute(field.attribute);
    }

    return element.textContent?.trim() || null;
  }

  private parseLikes(likesStr: string): number {
    const clean = likesStr.replace(REGEX.LIKES_SANITIZE, '').toLowerCase();
    let multiplier = 1;
    if (clean.includes('k')) multiplier = LIKES.MULTIPLIER_K;
    if (clean.includes('m')) multiplier = LIKES.MULTIPLIER_M;

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
    replyConfig: ReplyConfig,
    initialCount: number = 0,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < TIMING.REPLY_POLL_TIMEOUT_MS) {
      const replyContainer = querySelectorDeep(element, replyConfig.container.selector);
      if (replyContainer) {
        const items = querySelectorAllDeep(replyContainer, replyConfig.item.selector);
        // Wait for reply count to INCREASE from initial count
        if (items.length > initialCount) {
          Logger.info('[ReplyDebug] Reply count increased', {
            from: initialCount,
            to: items.length,
          });
          // Add a tiny extra delay for render stability
          await this.delay(TIMING.RENDER_STABILITY_WAIT_MS);
          return;
        }
      }
      await this.delay(TIMING.REPLY_POLL_INTERVAL_MS);
    }

    Logger.debug('[ReplyDebug] Timed out waiting for replies to increase', { initialCount });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
