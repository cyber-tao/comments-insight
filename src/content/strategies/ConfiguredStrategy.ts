import { ExtractionStrategy, ProgressCallback } from './ExtractionStrategy';
import {
  Comment,
  Platform,
  CrawlingConfig,
  FieldSelector,
  FieldValidationStatus,
  ProgressStage,
  ReplyConfig,
  SelectorRule,
} from '../../types';
import { PageController } from '../PageController';
import { Logger } from '../../utils/logger';
import { ErrorCode, ExtensionError } from '@/utils/error-types';
import {
  EXTRACTION_DEFAULTS,
  EXTRACTION_PROGRESS,
  MESSAGES,
  TIMEOUT,
  TIMING,
  DOM,
  LIMITS,
  LIKES,
  ANALYSIS_FORMAT,
  REGEX,
} from '@/config/constants';
import { sendMessage } from '@/utils/chrome-message';
import { findElementByRule, findElementsByRule, readField } from '../utils/selector-rule';
import { createYieldBudget } from '../utils/yield';
import { generateCommentHash } from '@/utils/comment-hash';
import { checkAborted, abortableDelay } from '../utils/abort';

const YOUTUBE_COMMENTS_SECTION = 'ytd-comments#comments';
const IDENTITY_ATTRIBUTES = ['id', 'data-id', 'data-comment-id', 'thingid', 'data-fullname'];

interface ExtractionBudget {
  maxComments: number;
  maxReplyDepth: number;
  totalCount: number;
  addedInRound: number;
  platform: Platform;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
  yieldBudget: ReturnType<typeof createYieldBudget>;
  failedExpandButtons: WeakSet<HTMLElement>;
  clickedExpandSnapshots: WeakMap<HTMLElement, string>;
}

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
    maxReplyDepth: number = EXTRACTION_DEFAULTS.MAX_REPLY_DEPTH,
  ): Promise<Comment[]> {
    const safeMaxReplyDepth = Math.max(0, Math.floor(maxReplyDepth));
    Logger.info('[ConfiguredStrategy] Starting extraction with config', {
      domain: this.config.domain,
      maxComments,
      maxReplyDepth: safeMaxReplyDepth,
    });
    onProgress?.(EXTRACTION_PROGRESS.MIN, '', 'initializing', 0, maxComments);

    let container = await this.findCommentContainer(signal);
    if (!container) {
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        `Comment container not found: ${this.config.container.selector}`,
      );
    }

    const allComments: Comment[] = [];
    let noNewCommentsCount = 0;
    let loadMoreClicks = 0;
    const commentsByHash = new Map<string, Comment>();
    const failedLoadMoreButtons = new WeakSet<HTMLElement>();
    this.processedVersions = new WeakMap();

    const budget: ExtractionBudget = {
      maxComments,
      maxReplyDepth: safeMaxReplyDepth,
      totalCount: 0,
      addedInRound: 0,
      platform,
      onProgress,
      signal,
      yieldBudget: createYieldBudget(),
      failedExpandButtons: new WeakSet<HTMLElement>(),
      clickedExpandSnapshots: new WeakMap<HTMLElement, string>(),
    };

    this.reportProgress(budget, 'extracting');

    this.validationRecorded = false;
    this.recordFieldValidation(container);

    const itemQueryLimit = Math.max(LIMITS.DOM_QUERY_MAX_RESULTS, maxComments * 5);
    const itemQueryVisitBudget = Math.max(LIMITS.DOM_QUERY_MAX_VISITED, itemQueryLimit * 5);

    while (budget.totalCount < maxComments) {
      checkAborted(signal);

      if (noNewCommentsCount >= DOM.NO_NEW_COMMENTS_THRESHOLD) {
        break;
      }

      // 1. Extract visible items (use deep query for Shadow DOM support and xpath)
      const items = findElementsByRule(
        container,
        this.config.item,
        itemQueryLimit,
        itemQueryVisitBudget,
      );
      const itemSet = new Set(items);
      budget.addedInRound = 0;

      for (const itemElement of items) {
        // The caller already includes its validation buffer in this target.
        if (budget.totalCount >= maxComments) break;
        checkAborted(signal);
        await budget.yieldBudget.yieldIfNeeded(signal);

        // Use matched elements rather than CSS closest() so XPath and shadow
        // descendants have the same nearest-parent ownership.
        if (this.nearestParentItem(itemElement, itemSet)) continue;

        const version = this.getElementVersion(
          itemElement,
          this.config.fields,
          safeMaxReplyDepth > 0,
        );
        if (this.processedVersions.get(itemElement)?.version === version) continue;

        // Scroll element into view to trigger lazy loading before extraction.
        (itemElement as HTMLElement).scrollIntoView?.({ behavior: 'instant', block: 'center' });
        const initialDirectReplies =
          this.config.replies && safeMaxReplyDepth > 0
            ? this.directReplyItems(itemElement, this.config.replies)
            : [];
        const preContent = this.readOwnedField(
          itemElement,
          this.config.fields.find((f) => f.name === 'content'),
          this.buildFieldBoundaries(itemElement, initialDirectReplies),
        );
        if (!preContent) {
          await abortableDelay(TIMING.SCROLL_PAUSE_MS, signal);
        }

        const fieldBoundaries = this.buildFieldBoundaries(
          itemElement,
          this.config.replies && safeMaxReplyDepth > 0
            ? this.directReplyItems(itemElement, this.config.replies)
            : [],
        );
        const fieldsVersion = this.getFieldVersion(
          itemElement,
          this.config.fields,
          fieldBoundaries,
        );
        const comment = await this.extractCommentFromElement(
          itemElement as HTMLElement,
          platform,
          signal,
          budget,
          commentsByHash,
          allComments,
        );
        if (comment && budget.totalCount < maxComments) {
          const postBoundaries = this.buildFieldBoundaries(
            itemElement,
            this.config.replies && safeMaxReplyDepth > 0
              ? this.directReplyItems(itemElement, this.config.replies)
              : [],
          );
          // Expansion may have changed the reply fields. Only remember a
          // successfully extracted, post-expansion version; skeletons retry.
          if (
            fieldsVersion === this.getFieldVersion(itemElement, this.config.fields, postBoundaries)
          ) {
            this.processedVersions.set(itemElement, {
              version: this.getElementVersion(
                itemElement,
                this.config.fields,
                safeMaxReplyDepth > 0,
              ),
              comment,
            });
          }
        }
      }

      if (budget.addedInRound === 0) {
        noNewCommentsCount++;
      } else {
        noNewCommentsCount = 0;
      }

      if (budget.totalCount >= maxComments) break;

      this.reportProgress(budget, 'scrolling');

      let loadedMoreViaButton = false;
      if (this.config.loadMoreBtn && loadMoreClicks < TIMING.MAX_LOAD_MORE_CLICKS) {
        const loadMoreBtn = findElementsByRule(container, this.config.loadMoreBtn).find(
          (button): button is HTMLElement =>
            button instanceof HTMLElement &&
            !failedLoadMoreButtons.has(button) &&
            this.nearestParentItem(button, itemSet) === null &&
            this.canExpandReplies(button),
        );
        if (loadMoreBtn) {
          loadMoreClicks += 1;
          loadedMoreViaButton = await this.clickLoadMoreButton(
            container,
            loadMoreBtn,
            items.length,
            itemQueryLimit,
            itemQueryVisitBudget,
            signal,
          );
          if (!loadedMoreViaButton) {
            failedLoadMoreButtons.add(loadMoreBtn);
          }
        }
      }

      if (!loadedMoreViaButton) {
        await this.pageController.scrollContainer(container, signal);
      }

      // Re-query container in case of re-render
      const newContainer = findElementByRule(document, this.config.container);
      if (newContainer) {
        container = newContainer;
      }
    }

    return allComments;
  }

  private reportProgress(budget: ExtractionBudget, stage: ProgressStage): void {
    const current = Math.min(budget.totalCount, budget.maxComments);
    const percent = Math.min(
      EXTRACTION_PROGRESS.NORMALIZING,
      EXTRACTION_PROGRESS.MIN +
        (budget.maxComments > 0 ? (current / budget.maxComments) * EXTRACTION_PROGRESS.RANGE : 0),
    );
    budget.onProgress?.(percent, '', stage, current, budget.maxComments);
  }

  private async findCommentContainer(signal?: AbortSignal): Promise<Element | null> {
    let container = findElementByRule(document, this.config.container);
    if (this.config.domain !== 'youtube.com') {
      if (container) return container;
      await abortableDelay(TIMING.SHORT_WAIT_MS, signal);
      return findElementByRule(document, this.config.container);
    }

    // YouTube loads the first comment batch when its outer section reaches the viewport.
    const deadline = Date.now() + TIMEOUT.COMMENTS_SECTION_MS;
    let scrolledSection: Element | null = null;
    while (true) {
      checkAborted(signal);
      if (container && findElementByRule(container, this.config.item)) return container;

      const section = document.querySelector(YOUTUBE_COMMENTS_SECTION);
      if (section && section !== scrolledSection) {
        section.scrollIntoView?.({ behavior: 'instant', block: 'center' });
        scrolledSection = section;
      }
      if (Date.now() >= deadline) return container;

      await abortableDelay(TIMING.SHORT_WAIT_MS, signal);
      container = findElementByRule(document, this.config.container);
    }
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

  private isSameRule(a: SelectorRule, b: SelectorRule): boolean {
    return a.type === b.type && a.selector.trim() === b.selector.trim();
  }

  private buildFieldBoundaries(element: Element, directReplies: Element[]): ReadonlySet<Element> {
    if (directReplies.length === 0) {
      return new Set([element]);
    }
    return new Set([element, ...directReplies]);
  }

  private collectDirectReplyItems(
    element: Element,
    replyConfig: ReplyConfig,
    maxResults?: number,
  ): Element[] {
    const queryLimit = maxResults ?? LIMITS.DOM_QUERY_MAX_RESULTS;
    const sameContainerAndItem = this.isSameRule(replyConfig.container, replyConfig.item);
    const matchedItems = findElementsByRule(element, replyConfig.item, queryLimit);
    const boundaries = new Set<Element>([element, ...matchedItems]);
    if (!this.isSameRule(this.config.item, replyConfig.item)) {
      for (const item of findElementsByRule(element, this.config.item, queryLimit)) {
        boundaries.add(item);
      }
    }

    if (sameContainerAndItem) {
      return matchedItems.filter(
        (item) => item !== element && this.nearestParentItem(item, boundaries) === element,
      );
    }

    const directItems = new Set<Element>();
    const matchedItemSet = new Set(matchedItems);
    const containers = findElementsByRule(element, replyConfig.container, queryLimit);
    for (const container of containers) {
      if (container !== element && this.nearestParentItem(container, boundaries) !== element) {
        continue;
      }
      // A reply container can itself be a matched item (e.g. Reddit). This
      // inclusion is local to replies; selector helpers stay descendant-only.
      if (
        matchedItemSet.has(container) &&
        container !== element &&
        this.nearestParentItem(container, boundaries) === element
      ) {
        directItems.add(container);
      }
      for (const item of findElementsByRule(container, replyConfig.item, queryLimit)) {
        if (item !== element && this.nearestParentItem(item, boundaries) === element) {
          directItems.add(item);
        }
      }
    }
    return [...directItems];
  }

  private replyItemBoundaries(
    element: Element,
    replyConfig: ReplyConfig,
    replyItems: Element[],
  ): Set<Element> {
    return new Set([
      element,
      ...replyItems,
      ...(this.isSameRule(this.config.item, replyConfig.item)
        ? []
        : findElementsByRule(element, this.config.item)),
    ]);
  }

  private directReplyItems(element: Element, replyConfig: ReplyConfig): Element[] {
    return this.collectDirectReplyItems(element, replyConfig);
  }

  private readOwnedField(
    context: Element,
    field: FieldSelector | undefined,
    boundaries: ReadonlySet<Element>,
  ): string | null {
    if (!field) return null;
    if (boundaries.size <= 1) {
      return readField(context, field);
    }

    const matches = findElementsByRule(context, field.rule);
    for (const match of matches) {
      if (match === context || this.nearestParentItem(match, boundaries) === context) {
        const value = (
          field.attribute ? match.getAttribute(field.attribute) : match.textContent
        )?.trim();
        if (value) return value;
      }
    }
    return null;
  }

  private getFieldVersion(
    element: Element,
    fields: FieldSelector[],
    boundaries: ReadonlySet<Element> = new Set([element]),
  ): string {
    return JSON.stringify([
      // Common virtual-list identity attributes are useful even when two
      // comments temporarily have identical field text.
      IDENTITY_ATTRIBUTES.map((name) => element.getAttribute(name)),
      fields.map((field) => this.readOwnedField(element, field, boundaries)),
    ]);
  }

  private getElementVersion(
    element: Element,
    fields = this.config.fields,
    includeDirectReplies = true,
  ): string {
    const replies = includeDirectReplies ? this.config.replies : undefined;
    const directReplies = replies ? this.directReplyItems(element, replies) : [];
    const boundaries = this.buildFieldBoundaries(element, directReplies);
    return JSON.stringify([
      this.getFieldVersion(element, fields, boundaries),
      replies
        ? directReplies.map((item) => {
            const nestedDirect = this.directReplyItems(item, replies);
            return [
              this.getFieldVersion(
                item,
                replies.fields,
                this.buildFieldBoundaries(item, nestedDirect),
              ),
              nestedDirect.length,
            ];
          })
        : [],
    ]);
  }

  private async extractCommentFromElement(
    element: HTMLElement,
    platform: Platform,
    signal?: AbortSignal,
    budget?: ExtractionBudget,
    commentsByHash?: Map<string, Comment>,
    allComments?: Comment[],
  ): Promise<Comment | null> {
    try {
      checkAborted(signal);

      const directReplies =
        this.config.replies && (!budget || budget.maxReplyDepth > 0)
          ? this.directReplyItems(element, this.config.replies)
          : [];
      const comment = this.buildCommentFromElement(
        element,
        this.config.fields,
        platform,
        this.buildFieldBoundaries(element, directReplies),
      );
      if (!comment) return null;

      const hash = generateCommentHash(comment);
      comment.id = hash;

      let targetComment = comment;
      if (budget && commentsByHash && allComments) {
        const existing = commentsByHash.get(hash);
        if (existing) {
          existing.username = comment.username;
          existing.content = comment.content;
          existing.timestamp = comment.timestamp;
          existing.likes = comment.likes;
          existing.platform = comment.platform;
          targetComment = existing;
        } else {
          if (budget.totalCount >= budget.maxComments) {
            return null;
          }
          commentsByHash.set(hash, comment);
          allComments.push(comment);
          budget.totalCount += 1;
          budget.addedInRound += 1;
          this.reportProgress(budget, 'extracting');
          targetComment = comment;
        }
      }

      if (
        this.config.replies &&
        (!budget || (budget.maxReplyDepth > 0 && budget.totalCount < budget.maxComments))
      ) {
        if (budget) {
          await this.extractRepliesInto(element, targetComment, this.config.replies, 1, budget);
        } else {
          const fallbackBudget: ExtractionBudget = {
            maxComments: Number.MAX_SAFE_INTEGER,
            maxReplyDepth: EXTRACTION_DEFAULTS.MAX_REPLY_DEPTH,
            totalCount: 1,
            addedInRound: 0,
            platform,
            signal,
            yieldBudget: createYieldBudget(),
            failedExpandButtons: new WeakSet<HTMLElement>(),
            clickedExpandSnapshots: new WeakMap<HTMLElement, string>(),
          };
          await this.extractRepliesInto(
            element,
            targetComment,
            this.config.replies,
            1,
            fallbackBudget,
          );
        }
      }

      return targetComment;
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

  private buildCommentFromElement(
    element: HTMLElement,
    fields: FieldSelector[],
    platform: Platform,
    boundaries: ReadonlySet<Element> = new Set([element]),
  ): Comment | null {
    const getFieldValue = (name: string): string | null => {
      const field = fields.find((f) => f.name === name);
      return field ? this.readOwnedField(element, field, boundaries) : null;
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

  private async extractRepliesInto(
    element: HTMLElement,
    parentComment: Comment,
    replyConfig: ReplyConfig,
    depth: number,
    budget: ExtractionBudget,
  ): Promise<void> {
    if (depth > budget.maxReplyDepth || budget.totalCount >= budget.maxComments) {
      return;
    }

    checkAborted(budget.signal);

    if (replyConfig.expandBtn) {
      let expandClicks = 0;
      while (
        expandClicks < TIMING.MAX_EXPAND_CLICKS_PER_NODE &&
        budget.totalCount < budget.maxComments
      ) {
        checkAborted(budget.signal);
        const currentDirectReplies = this.directReplyItems(element, replyConfig);
        const remaining = budget.maxComments - budget.totalCount;
        const unprocessedDirectCount = currentDirectReplies.filter(
          (item) => !this.processedVersions.has(item),
        ).length;
        if (unprocessedDirectCount >= remaining) {
          break;
        }

        const boundaries = this.replyItemBoundaries(element, replyConfig, currentDirectReplies);
        const expandBtn = findElementsByRule(element, replyConfig.expandBtn).find(
          (button): button is HTMLElement =>
            button instanceof HTMLElement &&
            !budget.failedExpandButtons.has(button) &&
            budget.clickedExpandSnapshots.get(button) !== this.getButtonSnapshot(button) &&
            this.nearestParentItem(button, boundaries) === element &&
            this.canExpandReplies(button),
        );
        if (!expandBtn) break;

        budget.clickedExpandSnapshots.set(expandBtn, this.getButtonSnapshot(expandBtn));
        this.reportProgress(budget, 'expanding');
        const expanded = await this.clickExpandButton(
          element,
          expandBtn,
          replyConfig,
          budget.signal,
          depth > 1,
        );
        expandClicks += 1;
        if (!expanded) {
          budget.failedExpandButtons.add(expandBtn);
        }
      }
    }

    const replyItems = this.directReplyItems(element, replyConfig);
    if (replyItems.length > 0) {
      Logger.info(
        depth > 1
          ? `[ReplyDebug] Found ${replyItems.length} nested replies at depth ${depth}`
          : `[ReplyDebug] Found ${replyItems.length} reply items`,
      );
    }

    const existingRepliesById = new Map(parentComment.replies.map((reply) => [reply.id, reply]));

    for (const replyItem of replyItems) {
      if (budget.totalCount >= budget.maxComments) break;
      checkAborted(budget.signal);
      await budget.yieldBudget.yieldIfNeeded(budget.signal);

      const canRecurse = depth < budget.maxReplyDepth;
      const version = this.getElementVersion(replyItem, replyConfig.fields, canRecurse);
      const cached = this.processedVersions.get(replyItem);
      if (cached?.version === version) {
        if (!existingRepliesById.has(cached.comment.id)) {
          parentComment.replies.push(cached.comment);
          existingRepliesById.set(cached.comment.id, cached.comment);
        }
        continue;
      }

      const childDirectReplies = canRecurse ? this.directReplyItems(replyItem, replyConfig) : [];
      const childBoundaries = this.buildFieldBoundaries(replyItem, childDirectReplies);
      const fieldsVersion = this.getFieldVersion(replyItem, replyConfig.fields, childBoundaries);
      const reply = this.buildCommentFromElement(
        replyItem as HTMLElement,
        replyConfig.fields,
        budget.platform,
        childBoundaries,
      );
      if (!reply) continue;

      reply.id = generateCommentHash(reply);
      const existingReply = existingRepliesById.get(reply.id);
      let targetReply: Comment;
      if (existingReply) {
        existingReply.username = reply.username;
        existingReply.content = reply.content;
        existingReply.timestamp = reply.timestamp;
        existingReply.likes = reply.likes;
        existingReply.platform = reply.platform;
        targetReply = existingReply;
      } else {
        parentComment.replies.push(reply);
        existingRepliesById.set(reply.id, reply);
        budget.totalCount += 1;
        budget.addedInRound += 1;
        this.reportProgress(budget, 'extracting');
        targetReply = reply;
      }

      if (canRecurse && budget.totalCount < budget.maxComments) {
        await this.extractRepliesInto(
          replyItem as HTMLElement,
          targetReply,
          replyConfig,
          depth + 1,
          budget,
        );
      }

      if (budget.totalCount < budget.maxComments) {
        const postChildBoundaries = this.buildFieldBoundaries(
          replyItem,
          canRecurse ? this.directReplyItems(replyItem, replyConfig) : [],
        );
        if (
          fieldsVersion === this.getFieldVersion(replyItem, replyConfig.fields, postChildBoundaries)
        ) {
          this.processedVersions.set(replyItem, {
            version: this.getElementVersion(replyItem, replyConfig.fields, canRecurse),
            comment: targetReply,
          });
        }
      }
    }
  }

  private getButtonSnapshot(button: HTMLElement): string {
    return `${(button.textContent || '').trim()}|${button.getAttribute('aria-label') || ''}|${button.getAttribute('href') || ''}`;
  }

  private canExpandReplies(button: HTMLElement): boolean {
    return (
      button.isConnected &&
      !button.matches(':disabled, [aria-disabled="true"]') &&
      !button.closest('[hidden]') &&
      button.checkVisibility?.({ checkVisibilityCSS: true }) !== false
    );
  }

  private async clickExpandButton(
    element: HTMLElement,
    expandBtn: HTMLElement,
    replyConfig: ReplyConfig,
    signal?: AbortSignal,
    isNested: boolean = false,
  ): Promise<boolean> {
    const logPrefix = isNested
      ? '[ReplyDebug] Found nested expand button'
      : '[ReplyDebug] Found expand button';
    Logger.info(logPrefix, {
      selector: replyConfig.expandBtn?.selector,
      text: expandBtn.textContent || '',
    });

    const currentReplyCount = this.directReplyItems(element, replyConfig).length;

    expandBtn.scrollIntoView?.({ behavior: 'instant', block: 'center' });
    await abortableDelay(TIMING.SCROLL_INTO_VIEW_WAIT_MS, signal);

    if (!this.canExpandReplies(expandBtn)) return false;

    try {
      expandBtn.click();
      Logger.info('[ReplyDebug] Clicked expand button', { currentReplyCount });
      return await this.waitForReplies(element, replyConfig, currentReplyCount, signal, expandBtn);
    } catch (e: unknown) {
      if (e instanceof ExtensionError && e.code === ErrorCode.TASK_CANCELLED) {
        throw e;
      }

      Logger.error('[ReplyDebug] Failed to click expand button', {
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  }

  private async clickLoadMoreButton(
    container: Element,
    loadMoreBtn: HTMLElement,
    initialItemCount: number,
    queryLimit: number,
    visitBudget: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    Logger.info('[ConfiguredStrategy] Clicking top-level load more button', {
      selector: this.config.loadMoreBtn?.selector,
      text: loadMoreBtn.textContent || '',
    });

    loadMoreBtn.scrollIntoView?.({ behavior: 'instant', block: 'center' });
    await abortableDelay(TIMING.SCROLL_INTO_VIEW_WAIT_MS, signal);

    if (!this.canExpandReplies(loadMoreBtn)) return false;

    try {
      loadMoreBtn.click();
      return await this.waitForItemCountIncrease(
        container,
        () => findElementsByRule(container, this.config.item, queryLimit, visitBudget).length,
        initialItemCount,
        signal,
        loadMoreBtn,
      );
    } catch (e: unknown) {
      if (e instanceof ExtensionError && e.code === ErrorCode.TASK_CANCELLED) {
        throw e;
      }
      Logger.error('[ConfiguredStrategy] Failed to click load more button', {
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
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

    if (this.config.loadMoreBtn?.selector) {
      const btn = findElementByRule(container, this.config.loadMoreBtn);
      validation['loadMoreBtn'] = btn ? 'success' : 'failed';
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
    expandBtn?: HTMLElement,
  ): Promise<boolean> {
    return this.waitForItemCountIncrease(
      element,
      () => this.directReplyItems(element, replyConfig).length,
      initialCount,
      signal,
      expandBtn,
    );
  }

  private async waitForItemCountIncrease(
    target: Element,
    getCount: () => number,
    initialCount: number,
    signal?: AbortSignal,
    triggerBtn?: HTMLElement,
  ): Promise<boolean> {
    const startTime = Date.now();
    let lastMutationAt = startTime;
    let observer: MutationObserver | null = null;

    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver((mutations) => {
        if (
          mutations.some(
            (mutation) =>
              mutation.type === 'characterData' ||
              mutation.addedNodes.length > 0 ||
              mutation.removedNodes.length > 0,
          )
        ) {
          lastMutationAt = Date.now();
        }
      });
      observer.observe(target, { childList: true, subtree: true, characterData: true });
    }

    try {
      while (Date.now() - startTime < TIMING.REPLY_POLL_TIMEOUT_MS) {
        checkAborted(signal);

        const count = getCount();
        // Wait for the deduplicated, directly owned item count to increase.
        if (count > initialCount) {
          Logger.info('[ReplyDebug] Reply count increased', {
            from: initialCount,
            to: count,
          });
          await abortableDelay(TIMING.RENDER_STABILITY_WAIT_MS, signal);
          return true;
        }

        const now = Date.now();
        if (now - lastMutationAt >= TIMING.REPLY_IDLE_TIMEOUT_MS) {
          break;
        }
        if (
          triggerBtn &&
          !this.canExpandReplies(triggerBtn) &&
          now - lastMutationAt >= TIMING.SCROLL_BASE_DELAY_MS &&
          now - startTime >= TIMING.SCROLL_BASE_DELAY_MS
        ) {
          break;
        }

        await abortableDelay(TIMING.REPLY_POLL_INTERVAL_MS, signal);
      }
    } finally {
      observer?.disconnect();
    }

    Logger.debug('[ReplyDebug] Timed out waiting for replies to increase', { initialCount });
    return false;
  }
}
