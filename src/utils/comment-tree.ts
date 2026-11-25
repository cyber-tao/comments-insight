import { REPLY_TRAVERSAL } from '@/config/constants/extraction';
import type { Comment } from '@/types';

const SCORE_EPSILON = 1e-12;

export interface CommentPriorityInput {
  depth: number;
  rootRank: number;
  siblingRank: number;
  likes: number;
  bridgedLikes?: number;
  threadReplies: number;
  parentSelected: number;
  budget: number;
}

export interface ExpandPriorityInput {
  depth: number;
  rootRank: number;
  parentLikes: number;
  threadReplies: number;
  parentSelected: number;
  expandClicks: number;
  budget: number;
}

export interface LoadRootsPriorityInput {
  nextRootRank: number;
  recentRootLikes: readonly number[];
  hasLoadMoreBtn: boolean;
  consecutiveEmptyLoads: number;
}

export interface LazyHeapEntry<T> {
  item: T;
  score: number;
  depth: number;
  rootRank: number;
  siblingRank: number;
  seq: number;
  version?: number;
}

function safeNonNegative(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function rootPrior(rootRank: number): number {
  return 1 / Math.log2(2 + safeNonNegative(rootRank) * REPLY_TRAVERSAL.ROOT_RANK_STEP);
}

function siblingPrior(siblingRank: number): number {
  return 1 / Math.log2(2 + safeNonNegative(siblingRank) * REPLY_TRAVERSAL.SIBLING_RANK_STEP);
}

function depthFactor(depth: number): number {
  return 1 / (1 + REPLY_TRAVERSAL.DEPTH_DECAY * safeNonNegative(depth));
}

function threadFactor(threadReplies: number, budget: number): number {
  const safeBudget =
    typeof budget === 'number' && Number.isFinite(budget) ? Math.max(1, budget) : 1;
  const scale = Math.max(
    REPLY_TRAVERSAL.THREAD_SCALE_MIN,
    Math.sqrt(safeBudget) * REPLY_TRAVERSAL.THREAD_SCALE_SQRT_FACTOR,
  );
  return (
    1 / (1 + REPLY_TRAVERSAL.THREAD_SATURATION * Math.log1p(safeNonNegative(threadReplies) / scale))
  );
}

function parentFactor(parentSelected: number): number {
  return (
    1 / (1 + REPLY_TRAVERSAL.PARENT_FANOUT_PENALTY * Math.log1p(safeNonNegative(parentSelected)))
  );
}

/**
 * Computes a value-guided fair-share priority score for committing a comment or reply.
 */
export function scoreCommentCandidate(input: CommentPriorityInput): number {
  const rp = rootPrior(input.rootRank);
  const posPrior = input.depth === 0 ? rp : rp * siblingPrior(input.siblingRank);
  const effectiveLikes = safeNonNegative(input.bridgedLikes ?? input.likes);
  const intrinsic =
    REPLY_TRAVERSAL.RANK_WEIGHT * posPrior +
    REPLY_TRAVERSAL.LIKE_WEIGHT * Math.log1p(effectiveLikes);
  if (input.depth <= 0) {
    return intrinsic;
  }
  return (
    intrinsic *
    depthFactor(input.depth) *
    threadFactor(input.threadReplies, input.budget) *
    parentFactor(input.parentSelected)
  );
}

/**
 * Computes the expected priority of clicking an expand-replies control on a committed node.
 */
export function scoreExpandCandidate(input: ExpandPriorityInput): number {
  const nextDepth = safeNonNegative(input.depth) + 1;
  const posPrior = rootPrior(input.rootRank) * siblingPrior(input.parentSelected);
  const estLikes = safeNonNegative(input.parentLikes) * REPLY_TRAVERSAL.EXPAND_LIKE_RATIO;
  const intrinsic =
    REPLY_TRAVERSAL.RANK_WEIGHT * posPrior + REPLY_TRAVERSAL.LIKE_WEIGHT * Math.log1p(estLikes);
  const repeatFactor =
    1 / (1 + REPLY_TRAVERSAL.EXPAND_REPEAT_DECAY * safeNonNegative(input.expandClicks));
  return (
    intrinsic *
    depthFactor(nextDepth) *
    threadFactor(input.threadReplies, input.budget) *
    parentFactor(input.parentSelected) *
    REPLY_TRAVERSAL.EXPAND_CLICK_DISCOUNT *
    repeatFactor
  );
}

/**
 * Estimates the priority of loading/scrolling for the next batch of top-level comments.
 */
export function scoreLoadMoreRoots(input: LoadRootsPriorityInput): number {
  const rp = rootPrior(input.nextRootRank);
  const tail = input.recentRootLikes.slice(-REPLY_TRAVERSAL.RECENT_ROOT_LIKES_WINDOW);
  const estLikes =
    tail.length > 0
      ? (tail.reduce((sum, v) => sum + safeNonNegative(v), 0) / tail.length) *
        REPLY_TRAVERSAL.RECENT_ROOT_LIKES_DECAY
      : 0;
  const intrinsic =
    REPLY_TRAVERSAL.RANK_WEIGHT * rp + REPLY_TRAVERSAL.LIKE_WEIGHT * Math.log1p(estLikes);
  const actionFactor = input.hasLoadMoreBtn
    ? REPLY_TRAVERSAL.ROOT_LOAD_BUTTON_FACTOR
    : REPLY_TRAVERSAL.ROOT_LOAD_SPECULATIVE_DISCOUNT;
  const backoffFactor = input.hasLoadMoreBtn
    ? 1
    : 1 / (1 + safeNonNegative(input.consecutiveEmptyLoads));
  return intrinsic * actionFactor * backoffFactor;
}

function isHigherPriority<T>(a: LazyHeapEntry<T>, b: LazyHeapEntry<T>): boolean {
  if (Math.abs(a.score - b.score) > SCORE_EPSILON) {
    return a.score > b.score;
  }
  if (a.depth !== b.depth) {
    return a.depth < b.depth;
  }
  if (a.rootRank !== b.rootRank) {
    return a.rootRank < b.rootRank;
  }
  if (a.siblingRank !== b.siblingRank) {
    return a.siblingRank < b.siblingRank;
  }
  return a.seq < b.seq;
}

/**
 * Lazy max-heap (CELF-style) for monotonically non-increasing dynamic priority scoring.
 */
export class LazyMaxHeap<T> {
  private heap: Array<LazyHeapEntry<T>> = [];

  get size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  push(entry: LazyHeapEntry<T>): void {
    this.heap.push(entry);
    this.siftUp(this.heap.length - 1);
  }

  peekBest(
    rescore: (item: T) => number,
    isValid?: (entry: LazyHeapEntry<T>) => boolean,
  ): LazyHeapEntry<T> | undefined {
    const top = this.resolveTop(rescore, isValid);
    if (!top) {
      return undefined;
    }
    this.push(top);
    return top;
  }

  popBest(
    rescore: (item: T) => number,
    isValid?: (entry: LazyHeapEntry<T>) => boolean,
  ): LazyHeapEntry<T> | undefined {
    return this.resolveTop(rescore, isValid);
  }

  private resolveTop(
    rescore: (item: T) => number,
    isValid?: (entry: LazyHeapEntry<T>) => boolean,
  ): LazyHeapEntry<T> | undefined {
    while (this.heap.length > 0) {
      const top = this.popRaw()!;
      if (isValid && !isValid(top)) {
        continue;
      }
      top.score = rescore(top.item);
      if (this.heap.length === 0 || !isHigherPriority(this.heap[0], top)) {
        return top;
      }
      this.push(top);
    }
    return undefined;
  }

  private popRaw(): LazyHeapEntry<T> | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    let idx = index;
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      if (!isHigherPriority(this.heap[idx], this.heap[parentIdx])) {
        break;
      }
      const temp = this.heap[idx];
      this.heap[idx] = this.heap[parentIdx];
      this.heap[parentIdx] = temp;
      idx = parentIdx;
    }
  }

  private siftDown(index: number): void {
    let idx = index;
    const length = this.heap.length;
    while (true) {
      const left = idx * 2 + 1;
      const right = left + 1;
      let best = idx;
      if (left < length && isHigherPriority(this.heap[left], this.heap[best])) {
        best = left;
      }
      if (right < length && isHigherPriority(this.heap[right], this.heap[best])) {
        best = right;
      }
      if (best === idx) {
        break;
      }
      const temp = this.heap[idx];
      this.heap[idx] = this.heap[best];
      this.heap[best] = temp;
      idx = best;
    }
  }
}

/**
 * Counts all comments and nested replies across every depth level.
 */
export function countComments(comments: readonly Comment[] | undefined | null): number {
  if (!Array.isArray(comments) || comments.length === 0) {
    return 0;
  }

  let total = 0;
  const stack: Array<readonly Comment[]> = [comments];

  while (stack.length > 0) {
    const list = stack.pop()!;
    for (let index = 0; index < list.length; index += 1) {
      const comment = list[index];
      if (!comment) continue;
      total += 1;
      if (Array.isArray(comment.replies) && comment.replies.length > 0) {
        stack.push(comment.replies);
      }
    }
  }

  return total;
}

/**
 * Counts all descendant replies under a single comment across every depth level.
 */
export function countCommentReplies(comment: Pick<Comment, 'replies'> | undefined | null): number {
  return countComments(comment?.replies);
}

/**
 * Trims replies deeper than maxReplyDepth (0 keeps only top-level comments).
 */
export function trimCommentsToDepth(
  comments: readonly Comment[],
  maxReplyDepth: number,
): Comment[] {
  const safeMaxDepth = Math.max(0, Math.floor(maxReplyDepth));

  const trimLevel = (items: readonly Comment[], currentDepth: number): Comment[] =>
    items.map((comment) => ({
      ...comment,
      replies:
        currentDepth < safeMaxDepth && Array.isArray(comment.replies) && comment.replies.length > 0
          ? trimLevel(comment.replies, currentDepth + 1)
          : [],
    }));

  return trimLevel(comments, 0);
}

interface TrimNodeWrapper {
  comment: Comment;
  depth: number;
  rootRank: number;
  siblingRank: number;
  parent: TrimNodeWrapper | null;
  children: TrimNodeWrapper[];
  bridgedLikes: number;
  selected: boolean;
}

/**
 * Trims a comment forest using value-guided fair-share best-first selection so
 * the total count of comments plus all nested replies does not exceed `limit`,
 * preserving both breadth across top-level threads and high-value reply chains.
 */
export function trimCommentsToLimit(comments: readonly Comment[], limit: number): Comment[] {
  if (!Array.isArray(comments) || comments.length === 0 || limit <= 0) {
    return [];
  }

  const safeLimit = Math.floor(limit);
  const buildWrapper = (
    comment: Comment,
    depth: number,
    rootRank: number,
    siblingRank: number,
    parent: TrimNodeWrapper | null,
  ): TrimNodeWrapper => {
    const wrapper: TrimNodeWrapper = {
      comment,
      depth,
      rootRank,
      siblingRank,
      parent,
      children: [],
      bridgedLikes: safeNonNegative(comment.likes),
      selected: false,
    };
    const replies = Array.isArray(comment.replies) ? comment.replies : [];
    let maxChildBridged = 0;
    for (let i = 0; i < replies.length; i += 1) {
      const child = buildWrapper(replies[i], depth + 1, rootRank, i, wrapper);
      wrapper.children.push(child);
      if (child.bridgedLikes > maxChildBridged) {
        maxChildBridged = child.bridgedLikes;
      }
    }
    wrapper.bridgedLikes = Math.max(
      wrapper.bridgedLikes,
      REPLY_TRAVERSAL.BRIDGED_LIKE_DECAY * maxChildBridged,
    );
    return wrapper;
  };

  const roots = comments.map((comment, rootRank) =>
    buildWrapper(comment, 0, rootRank, rootRank, null),
  );
  const threadReplies = new Map<number, number>();
  const parentSelected = new Map<TrimNodeWrapper, number>();
  const heap = new LazyMaxHeap<TrimNodeWrapper>();
  let seq = 0;

  const scoreWrapper = (node: TrimNodeWrapper): number =>
    scoreCommentCandidate({
      depth: node.depth,
      rootRank: node.rootRank,
      siblingRank: node.siblingRank,
      likes: node.comment.likes,
      bridgedLikes: node.bridgedLikes,
      threadReplies: threadReplies.get(node.rootRank) || 0,
      parentSelected: node.parent ? parentSelected.get(node.parent) || 0 : 0,
      budget: safeLimit,
    });

  for (const root of roots) {
    heap.push({
      item: root,
      score: scoreWrapper(root),
      depth: root.depth,
      rootRank: root.rootRank,
      siblingRank: root.siblingRank,
      seq: seq++,
    });
  }

  let selectedCount = 0;
  while (selectedCount < safeLimit && !heap.isEmpty()) {
    const pickedEntry = heap.popBest(scoreWrapper);
    if (!pickedEntry) break;
    const node = pickedEntry.item;
    node.selected = true;
    selectedCount += 1;

    if (node.depth > 0) {
      threadReplies.set(node.rootRank, (threadReplies.get(node.rootRank) || 0) + 1);
      if (node.parent) {
        parentSelected.set(node.parent, (parentSelected.get(node.parent) || 0) + 1);
      }
    }

    for (const child of node.children) {
      heap.push({
        item: child,
        score: scoreWrapper(child),
        depth: child.depth,
        rootRank: child.rootRank,
        siblingRank: child.siblingRank,
        seq: seq++,
      });
    }
  }

  const cloneSelected = (wrappers: TrimNodeWrapper[]): Comment[] => {
    const result: Comment[] = [];
    for (const wrapper of wrappers) {
      if (!wrapper.selected) continue;
      result.push({
        ...wrapper.comment,
        replies: cloneSelected(wrapper.children),
      });
    }
    return result;
  };

  return cloneSelected(roots);
}
