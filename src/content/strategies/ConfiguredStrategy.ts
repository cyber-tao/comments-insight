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
import { ErrorCode, ExtensionError } from '@/utils/error-types';
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
import { findElementByRule, findElementsByRule, readField } from '../utils/selector-rule';
import { generateCommentHash } from '@/utils/comment-hash';
import { checkAborted, abortableDelay } from '../utils/abort';

export class ConfiguredStrategy implements ExtractionStrategy {
  private validationRecorded = false;
  private processedVersions = new WeakMap<Element, { version: string; comment: Comment }>();

  constructor(
    private pageController: PageController,
    private config: CrawlingConfig,
  ) {}

  cleanup(): void {
    this.processedVersions = new WeakMap();
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
    const commentsByHash = new Map<string, Comment>();
    this.processedVersions = new WeakMap();

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
      const itemSet = new Set(items);
      let added = 0;

      for (const itemElement of items) {
        // The caller already includes its validation buffer in this target.
        if (allComments.length >= maxComments) break;
        checkAborted(signal);

        // Use matched elements rather than CSS closest() so XPath and shadow
        // descendants have the same nearest-parent ownership.
        if (this.nearestParentItem(itemElement, itemSet)) continue;

        const version = this.getElementVersion(itemElement);
        if (this.processedVersions.get(itemElement)?.version === version) continue;

        // Scroll element into view to trigger lazy loading before extraction.
        (itemElement as HTMLElement).scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        await abortableDelay(TIMING.SCROLL_PAUSE_MS, signal);

        const fieldsVersion = this.getFieldVersion(itemElement, this.config.fields);
        const comment = await this.extractCommentFromElement(
          itemElement as HTMLElement,
          platform,
          signal,
        );
        if (comment) {
          const hash = generateCommentHash(comment);
          comment.id = hash;
          const existing = commentsByHash.get(hash);
          if (existing) {
            Object.assign(existing, comment, {
              replies: this.mergeReplies(existing.replies, comment.replies),
            });
          } else {
            commentsByHash.set(hash, comment);
            allComments.push(comment);
            added++;
          }
          // Expansion may have changed the reply fields. Only remember a
          // successfully extracted, post-expansion version; skeletons retry.
          if (fieldsVersion === this.getFieldVersion(itemElement, this.config.fields)) {
            this.processedVersions.set(itemElement, {
              version: this.getElementVersion(itemElement),
              comment,
            });
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

  private composedParent(element: Element): Element | null {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  private nearestParentItem(element: Element, items: ReadonlySet<Element>): Element | null {
    let parent = this.composedParent(element);
    while (parent) {
      if (items.has(parent)) return parent;
      parent = this.composedParent(parent);
    }
    return null;
  }

  private collectReplyItems(element: Element, replyConfig: ReplyConfig): Element[] {
    const items = new Set<Element>();
    const owner = new Set([element]);
    const matchedItems = new Set(findElementsByRule(element, replyConfig.item));
    const addItem = (item: Element) => {
      if (item !== element && this.nearestParentItem(item, owner) === element) items.add(item);
    };

    for (const container of findElementsByRule(element, replyConfig.container)) {
      // A reply container can itself be a matched item (e.g. Reddit). This
      // inclusion is local to replies; selector helpers stay descendant-only.
      if (matchedItems.has(container)) addItem(container);
      for (const item of findElementsByRule(container, replyConfig.item)) addItem(item);
    }
    return [...items];
  }

  private replyItemBoundaries(
    element: Element,
    replyConfig: ReplyConfig,
    replyItems: Element[],
  ): Set<Element> {
    return new Set([
      element,
      ...findElementsByRule(element, this.config.item),
      ...findElementsByRule(element, replyConfig.item),
      ...replyItems,
    ]);
  }

  private directReplyItems(element: Element, replyConfig: ReplyConfig): Element[] {
    const items = this.collectReplyItems(element, replyConfig);
    const boundaries = this.replyItemBoundaries(element, replyConfig, items);
    return items.filter((item) => this.nearestParentItem(item, boundaries) === element);
  }

  private getFieldVersion(element: Element, fields: FieldSelector[]): string {
    return JSON.stringify([
      // Common virtual-list identity attributes are useful even when two
      // comments temporarily have identical field text.
      ['id', 'data-id', 'data-comment-id', 'thingid', 'data-fullname'].map((name) =>
        element.getAttribute(name),
      ),
      fields.map((field) => readField(element, field)),
    ]);
  }

  private getElementVersion(element: Element, fields = this.config.fields): string {
    const replies = this.config.replies;
    return JSON.stringify([
      this.getFieldVersion(element, fields),
      replies
        ? this.collectReplyItems(element, replies).map((item) =>
            this.getFieldVersion(item, replies.fields),
          )
        : [],
    ]);
  }

  private mergeReplies(previous: Comment[], current: Comment[]): Comment[] {
    const replies = new Map(previous.map((reply) => [reply.id, reply]));
    for (const reply of current) {
      const existing = replies.get(reply.id);
      replies.set(
        reply.id,
        existing
          ? { ...reply, replies: this.mergeReplies(existing.replies, reply.replies) }
          : reply,
      );
    }
    return [...replies.values()];
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

    const version = this.getElementVersion(element, replyConfig.fields);
    const cached = this.processedVersions.get(element);
    if (cached?.version === version) return cached.comment;

    const fieldsVersion = this.getFieldVersion(element, replyConfig.fields);
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

    if (fieldsVersion === this.getFieldVersion(element, replyConfig.fields)) {
      this.processedVersions.set(element, {
        version: this.getElementVersion(element, replyConfig.fields),
        comment,
      });
    }
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

    // Author-only skeletons must not consume the target before content loads.
    if (!content) return null;

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
      const boundaries = this.replyItemBoundaries(
        element,
        replyConfig,
        this.collectReplyItems(element, replyConfig),
      );
      const expandBtn = findElementsByRule(element, replyConfig.expandBtn).find(
        (button) => this.nearestParentItem(button, boundaries) === element,
      );
      if (expandBtn) {
        await this.clickExpandButton(
          element,
          expandBtn as HTMLElement,
          replyConfig,
          signal,
          depth > 0,
        );
      }
    }

    const replyItems = this.directReplyItems(element, replyConfig);
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
      if (reply) replies.push(reply);
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

    const currentReplyCount = this.directReplyItems(element, replyConfig).length;

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
        const replyContainers = findElementsByRule(firstItem, replyConfig.container);
        validation['replies.container'] = replyContainers.length > 0 ? 'success' : 'failed';
        if (replyContainers.length > 0) {
          validation['replies.item'] =
            this.directReplyItems(firstItem, replyConfig).length > 0 ? 'success' : 'failed';
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
    return readField(context, field);
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

      const items = this.directReplyItems(element, replyConfig);
      // Wait for the deduplicated, directly owned reply count to increase.
      if (items.length > initialCount) {
        Logger.info('[ReplyDebug] Reply count increased', {
          from: initialCount,
          to: items.length,
        });
        await abortableDelay(TIMING.RENDER_STABILITY_WAIT_MS, signal);
        return;
      }
      await abortableDelay(TIMING.REPLY_POLL_INTERVAL_MS, signal);
    }

    Logger.debug('[ReplyDebug] Timed out waiting for replies to increase', { initialCount });
  }
}
