import { ExtractionStrategy, ProgressCallback } from './ExtractionStrategy';
import {
  Comment,
  Platform,
  CrawlingConfig,
  FieldSelector,
  FieldValidationStatus,
  ReplyConfig,
  SelectorRule,
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
import { querySelectorAllDeep, querySelectorDeep, queryXPathAll } from '@/utils/dom-query';
import { generateCommentHash } from '@/utils/comment-hash';
import { checkAborted, abortableDelay } from '../utils/abort';

function findElementByRule(
  context: Document | Element,
  rule?: SelectorRule | null,
): Element | null {
  if (!rule || !rule.selector) return null;
  if (rule.type === 'xpath') {
    const results = queryXPathAll(context, rule.selector);
    return results.length > 0 ? results[0] : null;
  }
  return querySelectorDeep(context, rule.selector);
}

function findElementsByRule(context: Document | Element, rule?: SelectorRule | null): Element[] {
  if (!rule || !rule.selector) return [];
  if (rule.type === 'xpath') {
    return queryXPathAll(context, rule.selector);
  }
  return querySelectorAllDeep(context, rule.selector);
}

export class ConfiguredStrategy implements ExtractionStrategy {
  private validationRecorded = false;

  constructor(
    private pageController: PageController,
    private config: CrawlingConfig,
  ) {}

  cleanup(): void {
    // No specific resources to cleanup for this strategy
  }

  async execute(
    maxComments: number,
    platform: Platform,
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
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

    let container = findElementByRule(document, this.config.container);

    if (!container) {
      // Try waiting
      await abortableDelay(TIMING.SHORT_WAIT_MS, signal);
      container = findElementByRule(document, this.config.container);
      if (!container) {
        throw new ExtensionError(
          ErrorCode.DOM_ANALYSIS_FAILED,
          `Comment container not found: ${this.config.container.selector}`,
        );
      }
    }

    const allComments: Comment[] = [];
    let noNewCommentsCount = 0;
    const seenHashes = new Set<string>();
    const processedElements = new WeakSet<HTMLElement>();

    onProgress?.(
      EXTRACTION_PROGRESS.MIN + EXTRACTION_PROGRESS.STEPS.EXTRACTING_START,
      'Extracting comments',
      'extracting',
      0,
      maxComments,
    );

    this.validationRecorded = false;
    this.recordFieldValidation(container);

    while (allComments.length < maxComments) {
      checkAborted(signal);

      if (noNewCommentsCount >= DOM.NO_NEW_COMMENTS_THRESHOLD) {
        break;
      }

      // 1. Extract visible items (use deep query for Shadow DOM support and xpath)
      const items = findElementsByRule(container, this.config.item);
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
        if (this.config.item.type !== 'xpath') {
          const parentItem = itemElement.parentElement?.closest(this.config.item.selector);
          if (parentItem && container.contains(parentItem)) {
            continue;
          }
        }

        // Scroll element into view to trigger lazy loading before extraction
        (itemElement as HTMLElement).scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        await abortableDelay(TIMING.SCROLL_PAUSE_MS, signal);

        const comment = await this.extractCommentFromElement(
          itemElement as HTMLElement,
          platform,
          signal,
        );
        if (comment) {
          const hash = generateCommentHash(comment);
          if (!seenHashes.has(hash)) {
            comment.id = hash;
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
        `extracting`,
        'extracting',
        allComments.length,
        maxComments,
      );

      const { contentChanged } = await this.pageController.scrollContainer(container, signal);

      // Re-query container in case of re-render
      const newContainer = findElementByRule(document, this.config.container);
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
    signal?: AbortSignal,
  ): Promise<Comment | null> {
    try {
      checkAborted(signal);

      const comment = this.buildCommentFromElement(element, this.config.fields, platform);
      if (!comment) return null;

      if (this.config.replies) {
        comment.replies = await this.extractRepliesFromElement(
          element,
          platform,
          this.config.replies,
          signal,
        );
      }

      return comment;
    } catch (e: unknown) {
      if (e instanceof ExtensionError && e.code === ErrorCode.TASK_CANCELLED) {
        throw e;
      }

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
    signal?: AbortSignal,
  ): Promise<Comment | null> {
    checkAborted(signal);

    if (depth >= DOM.MAX_REPLY_DEPTH) {
      Logger.warn('[ConfiguredStrategy] Max reply depth reached', { depth });
      return null;
    }

    const comment = this.buildCommentFromElement(element, replyConfig.fields, platform);
    if (!comment) return null;

    comment.id = generateCommentHash(comment);

    comment.replies = await this.extractRepliesFromElement(
      element,
      platform,
      replyConfig,
      signal,
      depth + 1,
    );

    return comment;
  }

  private buildCommentFromElement(
    element: HTMLElement,
    fields: FieldSelector[],
    platform: Platform,
  ): Comment | null {
    const getFieldValue = (name: string): string | null => {
      const field = fields.find((f) => f.name === name);
      return field ? this.extractField(element, field) : null;
    };

    const username = getFieldValue('username');
    const content = getFieldValue('content');

    if (!username && !content) return null;

    const timestamp = getFieldValue('timestamp') || ANALYSIS_FORMAT.UNKNOWN_TIMESTAMP;
    const likesStr = getFieldValue('likes') || '0';

    return {
      id: '',
      username: username || ANALYSIS_FORMAT.UNKNOWN_USERNAME,
      content: content || '',
      timestamp,
      likes: this.parseLikes(likesStr),
      platform,
      replies: [],
    };
  }

  private async extractRepliesFromElement(
    element: HTMLElement,
    platform: Platform,
    replyConfig: ReplyConfig,
    signal?: AbortSignal,
    depth: number = 0,
  ): Promise<Comment[]> {
    const replies: Comment[] = [];

    if (replyConfig.expandBtn) {
      const expandBtn = findElementByRule(element, replyConfig.expandBtn) as HTMLElement;
      if (expandBtn) {
        await this.clickExpandButton(element, expandBtn, replyConfig, signal, depth > 0);
      }
    }

    const replyContainer = findElementByRule(element, replyConfig.container);
    if (replyContainer) {
      const replyItems = findElementsByRule(replyContainer, replyConfig.item);
      if (replyItems.length > 0) {
        Logger.info(
          depth > 0
            ? `[ReplyDebug] Found ${replyItems.length} nested replies`
            : `[ReplyDebug] Found ${replyItems.length} reply items`,
        );
      }

      for (const replyItem of replyItems) {
        const reply = await this.extractReplyFromElement(
          replyItem as HTMLElement,
          platform,
          replyConfig,
          depth,
          signal,
        );
        if (reply) {
          replies.push(reply);
        }
      }
    }

    return replies;
  }

  private async clickExpandButton(
    element: HTMLElement,
    expandBtn: HTMLElement,
    replyConfig: ReplyConfig,
    signal?: AbortSignal,
    isNested: boolean = false,
  ): Promise<void> {
    const logPrefix = isNested
      ? '[ReplyDebug] Found nested expand button'
      : '[ReplyDebug] Found expand button';
    Logger.info(logPrefix, {
      selector: replyConfig.expandBtn?.selector,
      text: expandBtn.textContent || '',
    });

    const replyContainer = findElementByRule(element, replyConfig.container);
    const currentReplyCount = replyContainer
      ? findElementsByRule(replyContainer, replyConfig.item).length
      : 0;

    expandBtn.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    await abortableDelay(TIMING.SCROLL_INTO_VIEW_WAIT_MS, signal);

    try {
      expandBtn.click();
      Logger.info('[ReplyDebug] Clicked expand button', { currentReplyCount });
      await this.waitForReplies(element, replyConfig, currentReplyCount, signal);
    } catch (e: unknown) {
      if (e instanceof ExtensionError && e.code === ErrorCode.TASK_CANCELLED) {
        throw e;
      }

      Logger.error('[ReplyDebug] Failed to click expand button', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private recordFieldValidation(container: Element): void {
    if (this.validationRecorded) return;
    this.validationRecorded = true;

    const validation: Record<string, FieldValidationStatus> = {};

    validation['container'] = container ? 'success' : 'failed';

    const firstItem = findElementByRule(container, this.config.item);
    validation['item'] = firstItem ? 'success' : 'failed';

    if (firstItem) {
      for (const field of this.config.fields) {
        const result = findElementByRule(firstItem, field.rule);
        validation[field.name] = result ? 'success' : 'failed';
      }
    }

    if (this.config.replies) {
      const replyConfig = this.config.replies;
      if (firstItem) {
        const replyContainer = findElementByRule(firstItem, replyConfig.container);
        validation['replies.container'] = replyContainer ? 'success' : 'failed';
        if (replyContainer) {
          const replyItem = findElementByRule(replyContainer, replyConfig.item);
          validation['replies.item'] = replyItem ? 'success' : 'failed';
        }
        if (replyConfig.expandBtn?.selector) {
          const expandBtn = findElementByRule(firstItem, replyConfig.expandBtn);
          validation['replies.expandBtn'] = expandBtn ? 'success' : 'failed';
        }
      }
    }

    if (this.config.videoTime?.selector) {
      const el = findElementByRule(document, this.config.videoTime);
      validation['videoTime'] = el ? 'success' : 'failed';
    }
    if (this.config.postContent?.selector) {
      const el = findElementByRule(document, this.config.postContent);
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

    const element = findElementByRule(context, field.rule);
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

  private async waitForReplies(
    element: HTMLElement,
    replyConfig: ReplyConfig,
    initialCount: number = 0,
    signal?: AbortSignal,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < TIMING.REPLY_POLL_TIMEOUT_MS) {
      checkAborted(signal);

      const replyContainer = findElementByRule(element, replyConfig.container);
      if (replyContainer) {
        const items = findElementsByRule(replyContainer, replyConfig.item);
        // Wait for reply count to INCREASE from initial count
        if (items.length > initialCount) {
          Logger.info('[ReplyDebug] Reply count increased', {
            from: initialCount,
            to: items.length,
          });
          // Add a tiny extra delay for render stability
          await abortableDelay(TIMING.RENDER_STABILITY_WAIT_MS, signal);
          return;
        }
      }
      await abortableDelay(TIMING.REPLY_POLL_INTERVAL_MS, signal);
    }

    Logger.debug('[ReplyDebug] Timed out waiting for replies to increase', { initialCount });
  }
}
