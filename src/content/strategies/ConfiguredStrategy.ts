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
  REPLY_TRAVERSAL,
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
import {
  LazyMaxHeap,
  scoreCommentCandidate,
  scoreExpandCandidate,
  scoreLoadMoreRoots,
} from '@/utils/comment-tree';
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

interface FrontierNode {
  id: string;
  comment: Comment;
  element: HTMLElement;
  fieldsVersion: string;
  depth: number;
  rootRank: number;
  siblingRank: number;
  rootId: string;
  parent: FrontierNode | null;
  children: FrontierNode[];
  childrenById: Map<string, FrontierNode>;
  discoveredChildElements: WeakMap<Element, { fieldsVersion: string; node: FrontierNode }>;
  bridgedLikes: number;
  committed: boolean;
  inCommitHeap: boolean;
  expandClicks: number;
  commitVersion: number;
  expandVersion: number;
}

interface FrontierState {
  itemQueryLimit: number;
  itemQueryVisitBudget: number;
  allItemSet: Set<Element>;
  rootNodesById: Map<string, FrontierNode>;
  discoveredRootElements: WeakMap<Element, { fieldsVersion: string; node: FrontierNode }>;
  commitHeap: LazyMaxHeap<FrontierNode>;
  expandHeap: LazyMaxHeap<FrontierNode>;
  threadReplies: Map<string, number>;
  parentSelected: Map<FrontierNode, number>;
  uncommittedRoots: Set<FrontierNode>;
  committedRoots: FrontierNode[];
  recentRootLikes: number[];
  failedLoadMoreButtons: WeakSet<HTMLElement>;
  hasMoreVisibleRootsInDom: boolean;
  maxRootScrollY: number;
  maxContainerScrollTop: number;
  scrolledForExpand: boolean;
  noNewRootsCount: number;
  rootsExhausted: boolean;
  loadMoreClicks: number;
  nextRootRank: number;
  seq: number;
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

    const container = await this.findCommentContainer(signal);
    if (!container) {
      throw new ExtensionError(
        ErrorCode.DOM_ANALYSIS_FAILED,
        `Comment container not found: ${this.config.container.selector}`,
      );
    }

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

    if (!this.config.replies || safeMaxReplyDepth === 0) {
      return this.executeFlat(container, budget);
    }

    return this.executeFrontier(container, this.config.replies, budget);
  }

  private async executeFlat(
    initialContainer: Element,
    budget: ExtractionBudget,
  ): Promise<Comment[]> {
    let container = initialContainer;
    const allComments: Comment[] = [];
    const commentsByHash = new Map<string, Comment>();
    const failedLoadMoreButtons = new WeakSet<HTMLElement>();
    let noNewCommentsCount = 0;
    let loadMoreClicks = 0;

    const itemQueryLimit = Math.max(LIMITS.DOM_QUERY_MAX_RESULTS, budget.maxComments * 5);
    const itemQueryVisitBudget = Math.max(LIMITS.DOM_QUERY_MAX_VISITED, itemQueryLimit * 5);

    while (budget.totalCount < budget.maxComments) {
      checkAborted(budget.signal);

      const items = findElementsByRule(
        container,
        this.config.item,
        itemQueryLimit,
        itemQueryVisitBudget,
      );
      const itemSet = new Set(items);
      budget.addedInRound = 0;

      for (const itemElement of items) {
        if (budget.totalCount >= budget.maxComments) break;
        checkAborted(budget.signal);
        await budget.yieldBudget.yieldIfNeeded(budget.signal);

        if (this.nearestParentItem(itemElement, itemSet)) continue;

        const version = this.getElementVersion(itemElement, this.config.fields, false);
        if (this.processedVersions.get(itemElement)?.version === version) continue;

        (itemElement as HTMLElement).scrollIntoView?.({ behavior: 'instant', block: 'center' });
        const initialBoundaries = this.getRootFieldBoundaries(itemElement);
        const preContent = this.readOwnedField(
          itemElement,
          this.config.fields.find((f) => f.name === 'content'),
          initialBoundaries,
        );
        if (!preContent) {
          await abortableDelay(TIMING.SCROLL_PAUSE_MS, budget.signal);
        }

        const fieldsVersion = this.getFieldVersion(
          itemElement,
          this.config.fields,
          this.getRootFieldBoundaries(itemElement),
        );
        const comment = await this.extractCommentFromElement(
          itemElement as HTMLElement,
          budget.platform,
          budget.signal,
        );
        if (!comment) continue;

        const existing = commentsByHash.get(comment.id);
        if (existing) {
          this.updateMutableCommentFields(existing, comment);
        } else {
          if (budget.totalCount >= budget.maxComments) break;
          commentsByHash.set(comment.id, comment);
          allComments.push(comment);
          budget.totalCount += 1;
          budget.addedInRound += 1;
          this.reportProgress(budget, 'extracting');
        }

        if (
          budget.totalCount < budget.maxComments &&
          fieldsVersion ===
            this.getFieldVersion(
              itemElement,
              this.config.fields,
              this.getRootFieldBoundaries(itemElement),
            )
        ) {
          this.processedVersions.set(itemElement, {
            version: this.getElementVersion(itemElement, this.config.fields, false),
            comment: existing ?? comment,
          });
        }
      }

      noNewCommentsCount = budget.addedInRound === 0 ? noNewCommentsCount + 1 : 0;
      if (
        budget.totalCount >= budget.maxComments ||
        noNewCommentsCount >= DOM.NO_NEW_COMMENTS_THRESHOLD
      ) {
        break;
      }

      this.reportProgress(budget, 'scrolling');

      let loadedMoreViaButton = false;
      const loadMoreBtn = this.findEligibleLoadMoreButton(
        container,
        itemSet,
        failedLoadMoreButtons,
        loadMoreClicks,
      );
      if (loadMoreBtn) {
        loadMoreClicks += 1;
        loadedMoreViaButton = await this.clickLoadMoreButton(
          container,
          loadMoreBtn,
          items.length,
          itemQueryLimit,
          itemQueryVisitBudget,
          budget.signal,
        );
        if (!loadedMoreViaButton) {
          failedLoadMoreButtons.add(loadMoreBtn);
        }
      }

      if (!loadedMoreViaButton) {
        await this.pageController.scrollContainer(container, budget.signal);
      }

      container = findElementByRule(document, this.config.container) ?? container;
    }

    return allComments;
  }

  private async executeFrontier(
    initialContainer: Element,
    replyConfig: ReplyConfig,
    budget: ExtractionBudget,
  ): Promise<Comment[]> {
    let container = initialContainer;
    const isRecursiveSameRule = this.isSameRule(this.config.item, replyConfig.item);
    const itemQueryLimit = isRecursiveSameRule
      ? Math.max(
          LIMITS.DOM_QUERY_MAX_RESULTS * REPLY_TRAVERSAL.RECURSIVE_QUERY_MULTIPLIER,
          budget.maxComments * REPLY_TRAVERSAL.RECURSIVE_QUERY_BUDGET_FACTOR,
        )
      : Math.max(LIMITS.DOM_QUERY_MAX_RESULTS, budget.maxComments * 5);
    const itemQueryVisitBudget = Math.max(LIMITS.DOM_QUERY_MAX_VISITED, itemQueryLimit * 5);

    const state: FrontierState = {
      itemQueryLimit,
      itemQueryVisitBudget,
      allItemSet: new Set(),
      rootNodesById: new Map(),
      discoveredRootElements: new WeakMap(),
      commitHeap: new LazyMaxHeap(),
      expandHeap: new LazyMaxHeap(),
      threadReplies: new Map(),
      parentSelected: new Map(),
      uncommittedRoots: new Set(),
      committedRoots: [],
      recentRootLikes: [],
      failedLoadMoreButtons: new WeakSet(),
      hasMoreVisibleRootsInDom: false,
      maxRootScrollY: 0,
      maxContainerScrollTop: 0,
      scrolledForExpand: false,
      noNewRootsCount: 0,
      rootsExhausted: false,
      loadMoreClicks: 0,
      nextRootRank: 0,
      seq: 0,
    };

    await this.discoverRoots(container, replyConfig, budget, state);

    while (budget.totalCount < budget.maxComments) {
      checkAborted(budget.signal);
      await budget.yieldBudget.yieldIfNeeded(budget.signal);

      if (state.uncommittedRoots.size === 0 && state.hasMoreVisibleRootsInDom) {
        await this.discoverRoots(container, replyConfig, budget, state);
      }

      const decision = this.selectNextFrontierAction(container, replyConfig, budget, state);
      if (!decision) {
        break;
      }

      if (decision.action === 'commit') {
        await this.commitFrontierNode(decision.node, replyConfig, budget, state);
      } else if (decision.action === 'expand') {
        await this.expandFrontierNode(decision.node, replyConfig, budget, state);
      } else {
        container = await this.loadMoreFrontierRoots(container, replyConfig, budget, state);
      }
    }

    return this.buildOrderedFrontierResult(state);
  }

  private scoreFrontierCommit(
    node: FrontierNode,
    budget: ExtractionBudget,
    state: FrontierState,
  ): number {
    return scoreCommentCandidate({
      depth: node.depth,
      rootRank: node.rootRank,
      siblingRank: node.siblingRank,
      likes: node.comment.likes,
      bridgedLikes: node.bridgedLikes,
      threadReplies: state.threadReplies.get(node.rootId) || 0,
      parentSelected: node.parent ? state.parentSelected.get(node.parent) || 0 : 0,
      budget: budget.maxComments,
    });
  }

  private scoreFrontierExpand(
    node: FrontierNode,
    budget: ExtractionBudget,
    state: FrontierState,
  ): number {
    return scoreExpandCandidate({
      depth: node.depth,
      rootRank: node.rootRank,
      parentLikes: node.comment.likes,
      threadReplies: state.threadReplies.get(node.rootId) || 0,
      parentSelected: state.parentSelected.get(node) || 0,
      expandClicks: node.expandClicks,
      budget: budget.maxComments,
    });
  }

  private pushCommitNode(node: FrontierNode, budget: ExtractionBudget, state: FrontierState): void {
    node.inCommitHeap = true;
    node.commitVersion += 1;
    state.commitHeap.push({
      item: node,
      score: this.scoreFrontierCommit(node, budget, state),
      depth: node.depth,
      rootRank: node.rootRank,
      siblingRank: node.siblingRank,
      seq: state.seq++,
      version: node.commitVersion,
    });
  }

  private enqueueExpandIfEligible(
    node: FrontierNode,
    replyConfig: ReplyConfig,
    budget: ExtractionBudget,
    state: FrontierState,
  ): void {
    if (
      !node.committed ||
      node.depth >= budget.maxReplyDepth ||
      !replyConfig.expandBtn ||
      node.expandClicks >= TIMING.MAX_EXPAND_CLICKS_PER_NODE ||
      !node.children.every((child) => child.committed)
    ) {
      return;
    }

    if (!this.findEligibleExpandButton(node, replyConfig, budget)) {
      return;
    }

    node.expandVersion += 1;
    state.expandHeap.push({
      item: node,
      score: this.scoreFrontierExpand(node, budget, state),
      depth: node.depth + 1,
      rootRank: node.rootRank,
      siblingRank: state.parentSelected.get(node) || 0,
      seq: state.seq++,
      version: node.expandVersion,
    });
  }

  private selectNextFrontierAction(
    container: Element,
    replyConfig: ReplyConfig,
    budget: ExtractionBudget,
    state: FrontierState,
  ):
    | { action: 'commit'; node: FrontierNode }
    | { action: 'expand'; node: FrontierNode }
    | { action: 'loadMoreRoots' }
    | null {
    const scoreCommit = (node: FrontierNode) => this.scoreFrontierCommit(node, budget, state);
    const isValidCommit = (entry: { item: FrontierNode; version?: number }) =>
      !entry.item.committed &&
      entry.item.inCommitHeap &&
      entry.version === entry.item.commitVersion;

    const scoreExpand = (node: FrontierNode) => this.scoreFrontierExpand(node, budget, state);
    const isValidExpand = (entry: { item: FrontierNode; version?: number }) => {
      const node = entry.item;
      return (
        entry.version === node.expandVersion &&
        node.committed &&
        node.depth < budget.maxReplyDepth &&
        node.expandClicks < TIMING.MAX_EXPAND_CLICKS_PER_NODE &&
        node.children.every((child) => child.committed) &&
        this.findEligibleExpandButton(node, replyConfig, budget) !== null
      );
    };

    const bestCommit = state.commitHeap.peekBest(scoreCommit, isValidCommit);
    const bestExpand = state.expandHeap.peekBest(scoreExpand, isValidExpand);
    const canLoadMoreRoots = state.uncommittedRoots.size === 0 && !state.rootsExhausted;

    if (!canLoadMoreRoots) {
      if (!bestCommit && !bestExpand) return null;
      if (bestCommit && (!bestExpand || bestCommit.score >= bestExpand.score)) {
        return { action: 'commit', node: bestCommit.item };
      }
      return { action: 'expand', node: bestExpand!.item };
    }

    if (!bestCommit && !bestExpand) {
      return { action: 'loadMoreRoots' };
    }

    const loadMoreBtn = this.findEligibleLoadMoreButton(
      container,
      state.allItemSet,
      state.failedLoadMoreButtons,
      state.loadMoreClicks,
    );
    const loadScore = scoreLoadMoreRoots({
      nextRootRank: state.nextRootRank,
      recentRootLikes: state.recentRootLikes,
      hasLoadMoreBtn: loadMoreBtn !== null,
      consecutiveEmptyLoads: state.noNewRootsCount,
    });

    if (
      bestCommit &&
      bestCommit.score >= loadScore &&
      (!bestExpand || bestCommit.score >= bestExpand.score)
    ) {
      return { action: 'commit', node: bestCommit.item };
    }

    if (loadScore >= (bestExpand?.score ?? -Infinity)) {
      return { action: 'loadMoreRoots' };
    }

    return { action: 'expand', node: bestExpand!.item };
  }

  private async commitFrontierNode(
    node: FrontierNode,
    replyConfig: ReplyConfig,
    budget: ExtractionBudget,
    state: FrontierState,
  ): Promise<void> {
    const popped = state.commitHeap.popBest(
      (n) => this.scoreFrontierCommit(n, budget, state),
      (entry) =>
        entry.item === node &&
        !node.committed &&
        node.inCommitHeap &&
        entry.version === node.commitVersion,
    );
    if (!popped) return;

    node.inCommitHeap = false;
    node.committed = true;
    budget.totalCount += 1;
    this.reportProgress(budget, 'extracting');

    if (node.depth === 0) {
      state.uncommittedRoots.delete(node);
      state.committedRoots.push(node);
      state.recentRootLikes.push(node.comment.likes);
    } else if (node.parent) {
      if (!node.parent.comment.replies.some((reply) => reply.id === node.id)) {
        node.parent.comment.replies.push(node.comment);
      }
      state.threadReplies.set(node.rootId, (state.threadReplies.get(node.rootId) || 0) + 1);
      state.parentSelected.set(node.parent, (state.parentSelected.get(node.parent) || 0) + 1);
      this.enqueueExpandIfEligible(node.parent, replyConfig, budget, state);
    }

    if (budget.totalCount >= budget.maxComments || node.depth >= budget.maxReplyDepth) {
      return;
    }

    await this.scanVisibleChildren(node, 2, replyConfig, budget, state);
    for (const child of node.children) {
      if (!child.committed && !child.inCommitHeap) {
        this.pushCommitNode(child, budget, state);
      }
    }
    this.enqueueExpandIfEligible(node, replyConfig, budget, state);
  }

  private async expandFrontierNode(
    node: FrontierNode,
    replyConfig: ReplyConfig,
    budget: ExtractionBudget,
    state: FrontierState,
  ): Promise<void> {
    const popped = state.expandHeap.popBest(
      (n) => this.scoreFrontierExpand(n, budget, state),
      (entry) => entry.item === node && entry.version === node.expandVersion,
    );
    if (!popped) return;

    const expandBtn = this.findEligibleExpandButton(node, replyConfig, budget);
    if (!expandBtn) return;

    budget.clickedExpandSnapshots.set(expandBtn, this.getButtonSnapshot(expandBtn));
    this.reportProgress(budget, 'expanding');
    state.scrolledForExpand = true;

    const expanded = await this.clickExpandButton(
      node.element,
      expandBtn,
      replyConfig,
      budget.signal,
      node.depth > 0,
    );
    node.expandClicks += 1;
    if (!expanded) {
      budget.failedExpandButtons.add(expandBtn);
    }

    await this.scanVisibleChildren(node, 2, replyConfig, budget, state);
    this.enqueueExpandIfEligible(node, replyConfig, budget, state);
  }

  private async loadMoreFrontierRoots(
    currentContainer: Element,
    replyConfig: ReplyConfig,
    budget: ExtractionBudget,
    state: FrontierState,
  ): Promise<Element> {
    let container = currentContainer;
    this.reportProgress(budget, 'scrolling');

    const currentItems = findElementsByRule(
      container,
      this.config.item,
      state.itemQueryLimit,
      state.itemQueryVisitBudget,
    );
    state.allItemSet = new Set(currentItems);

    let loadedMoreViaButton = false;
    const loadMoreBtn = this.findEligibleLoadMoreButton(
      container,
      state.allItemSet,
      state.failedLoadMoreButtons,
      state.loadMoreClicks,
    );
    if (loadMoreBtn) {
      state.loadMoreClicks += 1;
      loadedMoreViaButton = await this.clickLoadMoreButton(
        container,
        loadMoreBtn,
        currentItems.length,
        state.itemQueryLimit,
        state.itemQueryVisitBudget,
        budget.signal,
      );
      if (!loadedMoreViaButton) {
        state.failedLoadMoreButtons.add(loadMoreBtn);
      }
    }

    if (!loadedMoreViaButton) {
      this.restoreRootScrollWatermark(container, state);
      await this.pageController.scrollContainer(container, budget.signal);
      this.updateScrollWatermarks(container, state);
    }

    container = findElementByRule(document, this.config.container) ?? container;
    const discoveredNewCount = await this.discoverRoots(container, replyConfig, budget, state);
    state.noNewRootsCount = discoveredNewCount > 0 ? 0 : state.noNewRootsCount + 1;
    if (state.noNewRootsCount >= DOM.NO_NEW_COMMENTS_THRESHOLD) {
      state.rootsExhausted = true;
    }

    return container;
  }

  private updateScrollWatermarks(container: Element, state: FrontierState): void {
    if (typeof window !== 'undefined' && typeof window.scrollY === 'number') {
      state.maxRootScrollY = Math.max(state.maxRootScrollY, window.scrollY);
    }
    const scrollTop = (container as HTMLElement).scrollTop;
    if (typeof scrollTop === 'number') {
      state.maxContainerScrollTop = Math.max(state.maxContainerScrollTop, scrollTop);
    }
  }

  private restoreRootScrollWatermark(container: Element, state: FrontierState): void {
    if (!state.scrolledForExpand) return;
    state.scrolledForExpand = false;

    const isScrollable =
      container.scrollHeight > container.clientHeight &&
      (container as HTMLElement).style?.overflow !== 'hidden';
    if (isScrollable && container.scrollTop < state.maxContainerScrollTop) {
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: state.maxContainerScrollTop, behavior: 'instant' });
      } else {
        (container as HTMLElement).scrollTop = state.maxContainerScrollTop;
      }
    } else if (
      !isScrollable &&
      typeof window !== 'undefined' &&
      typeof window.scrollY === 'number' &&
      window.scrollY < state.maxRootScrollY
    ) {
      window.scrollTo?.({ top: state.maxRootScrollY, behavior: 'instant' });
    }
  }

  private async discoverRoots(
    container: Element,
    replyConfig: ReplyConfig,
    budget: ExtractionBudget,
    state: FrontierState,
  ): Promise<number> {
    const items = findElementsByRule(
      container,
      this.config.item,
      state.itemQueryLimit,
      state.itemQueryVisitBudget,
    );
    const itemSet = new Set(items);
    state.allItemSet = itemSet;
    const topLevelElements = items.filter((el) => !this.nearestParentItem(el, itemSet));

    const remaining = Math.max(0, budget.maxComments - budget.totalCount);
    const lookaheadTarget = Math.min(
      remaining,
      Math.max(
        REPLY_TRAVERSAL.MIN_ROOT_LOOKAHEAD,
        Math.ceil(remaining * REPLY_TRAVERSAL.ROOT_LOOKAHEAD_RATIO),
      ),
    );

    const unchangedCached = new Set<Element>();
    for (const rootEl of topLevelElements) {
      checkAborted(budget.signal);
      await budget.yieldBudget.yieldIfNeeded(budget.signal);
      const cached = state.discoveredRootElements.get(rootEl);
      if (!cached) continue;

      const boundaries = this.getRootFieldBoundaries(rootEl);
      const currentVersion = this.getFieldVersion(rootEl, this.config.fields, boundaries);
      if (cached.fieldsVersion === currentVersion) {
        unchangedCached.add(rootEl);
        await this.refreshVisibleSubtree(cached.node, replyConfig, budget, state);
      }
    }

    let discoveredNewCount = 0;
    state.hasMoreVisibleRootsInDom = false;

    for (const rootEl of topLevelElements) {
      if (unchangedCached.has(rootEl)) continue;
      if (state.uncommittedRoots.size >= lookaheadTarget || discoveredNewCount >= remaining) {
        state.hasMoreVisibleRootsInDom = true;
        break;
      }

      checkAborted(budget.signal);
      await budget.yieldBudget.yieldIfNeeded(budget.signal);

      (rootEl as HTMLElement).scrollIntoView?.({ behavior: 'instant', block: 'center' });
      this.updateScrollWatermarks(container, state);

      const initialBoundaries = this.getRootFieldBoundaries(rootEl);
      const preContent = this.readOwnedField(
        rootEl,
        this.config.fields.find((f) => f.name === 'content'),
        initialBoundaries,
      );
      if (!preContent) {
        await abortableDelay(TIMING.SCROLL_PAUSE_MS, budget.signal);
      }

      const preFieldsVersion = this.getFieldVersion(
        rootEl,
        this.config.fields,
        this.getRootFieldBoundaries(rootEl),
      );
      const comment = await this.extractCommentFromElement(
        rootEl as HTMLElement,
        budget.platform,
        budget.signal,
      );
      if (!comment) continue;

      const postFieldsVersion = this.getFieldVersion(
        rootEl,
        this.config.fields,
        this.getRootFieldBoundaries(rootEl),
      );
      const existing = state.rootNodesById.get(comment.id);
      if (existing) {
        existing.element = rootEl as HTMLElement;
        existing.fieldsVersion = postFieldsVersion;
        const prevLikes = existing.comment.likes;
        this.updateMutableCommentFields(existing.comment, comment);
        if (comment.likes > prevLikes) {
          existing.bridgedLikes = Math.max(existing.bridgedLikes, comment.likes);
          if (!existing.committed && existing.inCommitHeap) {
            this.pushCommitNode(existing, budget, state);
          }
        }
        if (preFieldsVersion === postFieldsVersion) {
          state.discoveredRootElements.set(rootEl, {
            fieldsVersion: postFieldsVersion,
            node: existing,
          });
        }
        await this.refreshVisibleSubtree(existing, replyConfig, budget, state);
        continue;
      }

      const rootRank = state.nextRootRank++;
      const rootNode: FrontierNode = {
        id: comment.id,
        comment,
        element: rootEl as HTMLElement,
        fieldsVersion: postFieldsVersion,
        depth: 0,
        rootRank,
        siblingRank: rootRank,
        rootId: comment.id,
        parent: null,
        children: [],
        childrenById: new Map(),
        discoveredChildElements: new WeakMap(),
        bridgedLikes: Math.max(0, comment.likes),
        committed: false,
        inCommitHeap: false,
        expandClicks: 0,
        commitVersion: 0,
        expandVersion: 0,
      };
      state.rootNodesById.set(rootNode.id, rootNode);
      if (preFieldsVersion === postFieldsVersion) {
        state.discoveredRootElements.set(rootEl, {
          fieldsVersion: postFieldsVersion,
          node: rootNode,
        });
      }
      state.uncommittedRoots.add(rootNode);
      discoveredNewCount += 1;

      await this.scanVisibleChildren(rootNode, 2, replyConfig, budget, state);
      this.pushCommitNode(rootNode, budget, state);
    }

    return discoveredNewCount;
  }

  private async refreshVisibleSubtree(
    rootNode: FrontierNode,
    replyConfig: ReplyConfig,
    budget: ExtractionBudget,
    state: FrontierState,
  ): Promise<void> {
    if (!rootNode.committed) {
      await this.scanVisibleChildren(rootNode, 2, replyConfig, budget, state);
      return;
    }

    const stack: FrontierNode[] = [rootNode];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (!current.element.isConnected || current.depth >= budget.maxReplyDepth) {
        continue;
      }
      await this.scanVisibleChildren(current, 2, replyConfig, budget, state);
      this.enqueueExpandIfEligible(current, replyConfig, budget, state);
      for (const child of current.children) {
        if (child.committed && child.depth < budget.maxReplyDepth) {
          stack.push(child);
        }
      }
    }
  }

  private async scanVisibleChildren(
    parentNode: FrontierNode,
    lookaheadHops: number,
    replyConfig: ReplyConfig,
    budget: ExtractionBudget,
    state: FrontierState,
  ): Promise<number> {
    if (
      parentNode.depth >= budget.maxReplyDepth ||
      lookaheadHops <= 0 ||
      !parentNode.element.isConnected
    ) {
      return 0;
    }

    const directElements = this.directReplyItems(parentNode.element, replyConfig);
    let newlyDiscovered = 0;
    let maxChildBridged = 0;

    for (const replyEl of directElements) {
      checkAborted(budget.signal);
      await budget.yieldBudget.yieldIfNeeded(budget.signal);

      const childDirect =
        parentNode.depth + 1 < budget.maxReplyDepth
          ? this.directReplyItems(replyEl, replyConfig)
          : [];
      const childBoundaries = this.buildFieldBoundaries(replyEl, childDirect);
      const childFieldsVersion = this.getFieldVersion(replyEl, replyConfig.fields, childBoundaries);

      const cachedEl = parentNode.discoveredChildElements.get(replyEl);
      if (cachedEl && cachedEl.fieldsVersion === childFieldsVersion) {
        const existingChild = cachedEl.node;
        if (lookaheadHops > 1) {
          newlyDiscovered += await this.scanVisibleChildren(
            existingChild,
            lookaheadHops - 1,
            replyConfig,
            budget,
            state,
          );
        }
        if (existingChild.bridgedLikes > maxChildBridged) {
          maxChildBridged = existingChild.bridgedLikes;
        }
        continue;
      }

      const replyComment = this.buildCommentFromElement(
        replyEl as HTMLElement,
        replyConfig.fields,
        budget.platform,
        childBoundaries,
      );
      if (!replyComment) continue;

      replyComment.id = generateCommentHash(replyComment);
      let childNode = parentNode.childrenById.get(replyComment.id);
      if (childNode) {
        childNode.element = replyEl as HTMLElement;
        childNode.fieldsVersion = childFieldsVersion;
        this.updateMutableCommentFields(childNode.comment, replyComment);
        childNode.bridgedLikes = Math.max(childNode.bridgedLikes, replyComment.likes);
        parentNode.discoveredChildElements.set(replyEl, {
          fieldsVersion: childFieldsVersion,
          node: childNode,
        });
      } else {
        childNode = {
          id: replyComment.id,
          comment: replyComment,
          element: replyEl as HTMLElement,
          fieldsVersion: childFieldsVersion,
          depth: parentNode.depth + 1,
          rootRank: parentNode.rootRank,
          siblingRank: parentNode.children.length,
          rootId: parentNode.rootId,
          parent: parentNode,
          children: [],
          childrenById: new Map(),
          discoveredChildElements: new WeakMap(),
          bridgedLikes: Math.max(0, replyComment.likes),
          committed: false,
          inCommitHeap: false,
          expandClicks: 0,
          commitVersion: 0,
          expandVersion: 0,
        };
        parentNode.children.push(childNode);
        parentNode.childrenById.set(childNode.id, childNode);
        parentNode.discoveredChildElements.set(replyEl, {
          fieldsVersion: childFieldsVersion,
          node: childNode,
        });
        newlyDiscovered += 1;

        if (parentNode.committed) {
          this.pushCommitNode(childNode, budget, state);
        }
      }

      if (lookaheadHops > 1) {
        newlyDiscovered += await this.scanVisibleChildren(
          childNode,
          lookaheadHops - 1,
          replyConfig,
          budget,
          state,
        );
      }
      if (childNode.bridgedLikes > maxChildBridged) {
        maxChildBridged = childNode.bridgedLikes;
      }
    }

    this.propagateBridgedLikes(parentNode, maxChildBridged, budget, state);
    return newlyDiscovered;
  }

  private propagateBridgedLikes(
    startNode: FrontierNode,
    initialChildMax: number,
    budget: ExtractionBudget,
    state: FrontierState,
  ): void {
    let current: FrontierNode | null = startNode;
    let childMax = initialChildMax;
    while (current) {
      const prevBridged = current.bridgedLikes;
      const nextBridged = Math.max(
        Math.max(0, current.comment.likes),
        prevBridged,
        REPLY_TRAVERSAL.BRIDGED_LIKE_DECAY * childMax,
      );
      if (nextBridged > prevBridged) {
        current.bridgedLikes = nextBridged;
        if (!current.committed && current.inCommitHeap) {
          this.pushCommitNode(current, budget, state);
        }
      }
      childMax = current.bridgedLikes;
      current = current.parent;
    }
  }

  private buildOrderedFrontierResult(state: FrontierState): Comment[] {
    const finalizeReplies = (node: FrontierNode): void => {
      const committedChildren = node.children
        .filter((child) => child.committed)
        .sort((a, b) => a.siblingRank - b.siblingRank);
      node.comment.replies = committedChildren.map((child) => {
        finalizeReplies(child);
        return child.comment;
      });
    };

    const orderedRoots = [...state.committedRoots].sort((a, b) => a.rootRank - b.rootRank);
    return orderedRoots.map((root) => {
      finalizeReplies(root);
      return root.comment;
    });
  }

  private findEligibleExpandButton(
    node: FrontierNode,
    replyConfig: ReplyConfig,
    budget: ExtractionBudget,
  ): HTMLElement | null {
    if (!replyConfig.expandBtn || !node.element.isConnected) {
      return null;
    }

    const currentDirectReplies = this.directReplyItems(node.element, replyConfig);
    const boundaries = this.replyItemBoundaries(node.element, replyConfig, currentDirectReplies);
    return (
      findElementsByRule(node.element, replyConfig.expandBtn).find(
        (button): button is HTMLElement =>
          button instanceof HTMLElement &&
          !budget.failedExpandButtons.has(button) &&
          budget.clickedExpandSnapshots.get(button) !== this.getButtonSnapshot(button) &&
          this.nearestParentItem(button, boundaries) === node.element &&
          this.canExpandReplies(button),
      ) ?? null
    );
  }

  private findEligibleLoadMoreButton(
    container: Element,
    itemSet: ReadonlySet<Element>,
    failedLoadMoreButtons: WeakSet<HTMLElement>,
    loadMoreClicks: number,
  ): HTMLElement | null {
    if (!this.config.loadMoreBtn || loadMoreClicks >= TIMING.MAX_LOAD_MORE_CLICKS) {
      return null;
    }
    return (
      findElementsByRule(container, this.config.loadMoreBtn).find(
        (button): button is HTMLElement =>
          button instanceof HTMLElement &&
          !failedLoadMoreButtons.has(button) &&
          this.nearestParentItem(button, itemSet) === null &&
          this.canExpandReplies(button),
      ) ?? null
    );
  }

  private updateMutableCommentFields(target: Comment, source: Comment): void {
    target.username = source.username;
    target.content = source.content;
    target.timestamp = source.timestamp;
    target.likes = source.likes;
    target.platform = source.platform;
  }

  private getRootFieldBoundaries(element: Element): ReadonlySet<Element> {
    const directReplies = this.config.replies
      ? this.directReplyItems(element, this.config.replies)
      : [];
    return this.buildFieldBoundaries(element, directReplies);
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
    const sameContainerAndItem = this.isSameRule(replyConfig.container, replyConfig.item);
    const queryLimit =
      maxResults ??
      (sameContainerAndItem
        ? LIMITS.DOM_QUERY_MAX_RESULTS * REPLY_TRAVERSAL.RECURSIVE_QUERY_MULTIPLIER
        : LIMITS.DOM_QUERY_MAX_RESULTS);
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
  ): Promise<Comment | null> {
    try {
      checkAborted(signal);

      const comment = this.buildCommentFromElement(
        element,
        this.config.fields,
        platform,
        this.getRootFieldBoundaries(element),
      );
      if (!comment) return null;

      comment.id = generateCommentHash(comment);
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
