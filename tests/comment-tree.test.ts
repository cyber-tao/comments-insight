import { describe, expect, it } from 'vitest';
import type { Comment } from '@/types';
import {
  countCommentReplies,
  countComments,
  scoreCommentCandidate,
  scoreExpandCandidate,
  scoreLoadMoreRoots,
  trimCommentsToDepth,
  trimCommentsToLimit,
} from '@/utils/comment-tree';

function makeComment(id: string, replies: Comment[] = [], likes = 0): Comment {
  return {
    id,
    username: `user-${id}`,
    content: `content-${id}`,
    timestamp: '2026-01-01 00:00',
    likes,
    replies,
  };
}

describe('comment-tree utilities', () => {
  it('counts comments and nested replies across arbitrary depths', () => {
    const tree = [
      makeComment('r1', [
        makeComment('r1-1', [makeComment('r1-1-1', [makeComment('r1-1-1-1')])]),
        makeComment('r1-2'),
      ]),
      makeComment('r2'),
    ];

    expect(countComments([])).toBe(0);
    expect(countComments(null)).toBe(0);
    expect(countComments(tree)).toBe(6);
    expect(countCommentReplies(tree[0])).toBe(4);
    expect(countCommentReplies(tree[1])).toBe(0);
    expect(countCommentReplies(undefined)).toBe(0);
  });

  it('trims comments with value-guided fair-share selection while preserving original order', () => {
    const tree = [
      makeComment('r1', [makeComment('r1-1', [makeComment('r1-1-1')]), makeComment('r1-2')]),
      makeComment('r2', [makeComment('r2-1')]),
    ];

    expect(trimCommentsToLimit(tree, 0)).toEqual([]);
    expect(trimCommentsToLimit(tree, 1)).toEqual([makeComment('r1')]);
    expect(trimCommentsToLimit(tree, 2)).toEqual([makeComment('r1'), makeComment('r2')]);
    expect(trimCommentsToLimit(tree, 3)).toEqual([
      makeComment('r1', [makeComment('r1-1')]),
      makeComment('r2'),
    ]);
    expect(trimCommentsToLimit(tree, 4)).toEqual([
      makeComment('r1', [makeComment('r1-1')]),
      makeComment('r2', [makeComment('r2-1')]),
    ]);
    expect(trimCommentsToLimit(tree, 5)).toEqual([
      makeComment('r1', [makeComment('r1-1', [makeComment('r1-1-1')])]),
      makeComment('r2', [makeComment('r2-1')]),
    ]);
    expect(countComments(trimCommentsToLimit(tree, 4))).toBe(4);
  });

  it('prevents a mega-thread from monopolizing budget and keeps breadth plus depth', () => {
    const megaReplies: Comment[] = Array.from({ length: 30 }, (_, i) =>
      makeComment(
        `r0-${i}`,
        i < 10
          ? Array.from({ length: 3 }, (_, j) =>
              makeComment(
                `r0-${i}-${j}`,
                j === 0
                  ? [makeComment(`r0-${i}-${j}-0`, [makeComment(`r0-${i}-${j}-0-0`, [], 400)], 600)]
                  : [],
                Math.max(10, 900 - i * 40 - j * 20),
              ),
            )
          : [],
        Math.max(20, 1500 - i * 35),
      ),
    );
    const roots: Comment[] = [
      makeComment('r0', megaReplies, 3000),
      ...Array.from({ length: 30 }, (_, idx) => {
        const rank = idx + 1;
        return makeComment(
          `r${rank}`,
          [makeComment(`r${rank}-0`, [], Math.round(400 / rank))],
          Math.round(1200 / (rank + 1)),
        );
      }),
    ];

    const trimmed = trimCommentsToLimit(roots, 50);

    expect(countComments(trimmed)).toBe(50);
    expect(trimmed.length).toBeGreaterThanOrEqual(15);
    expect(countComments([trimmed[0]])).toBeLessThan(20);
    // Original top-level order preserved
    const rootIndices = trimmed.map((c) => Number(c.id.slice(1)));
    expect(rootIndices).toEqual([...rootIndices].sort((a, b) => a - b));
    // Reaches depth >= 2 inside top discussions
    const hasDepth2 = trimmed.some((root) => root.replies.some((r) => r.replies.length > 0));
    expect(hasDepth2).toBe(true);
  });

  it('captures viral deep replies through zero-like bridge parents', () => {
    const roots: Comment[] = [
      makeComment(
        'r0',
        Array.from({ length: 10 }, (_, i) => makeComment(`r0-${i}`, [], 120 - i * 10)),
        250,
      ),
      ...Array.from({ length: 4 }, (_, i) => makeComment(`r${i + 1}`, [], 150 - i * 15)),
      makeComment('r5', [makeComment('bridge', [makeComment('viral-gem', [], 2000)], 0)], 100),
    ];

    const trimmed = trimCommentsToLimit(roots, 12);
    const r5 = trimmed.find((c) => c.id === 'r5');
    expect(r5).toBeDefined();
    expect(r5?.replies.map((r) => r.id)).toEqual(['bridge']);
    expect(r5?.replies[0].replies.map((r) => r.id)).toEqual(['viral-gem']);
  });

  it('spills budget fairly across replies when only a few roots exist', () => {
    const buildTree = (prefix: string) =>
      makeComment(
        prefix,
        Array.from({ length: 10 }, (_, i) =>
          makeComment(
            `${prefix}-${i}`,
            [
              makeComment(`${prefix}-${i}-0`, [makeComment(`${prefix}-${i}-0-0`, [], 40)], 60),
              makeComment(`${prefix}-${i}-1`, [], 30),
            ],
            200 - i * 15,
          ),
        ),
        500,
      );

    const trimmed = trimCommentsToLimit([buildTree('a'), buildTree('b')], 40);

    expect(countComments(trimmed)).toBe(40);
    expect(trimmed).toHaveLength(2);
    const firstShare = countComments([trimmed[0]]);
    const secondShare = countComments([trimmed[1]]);
    expect(firstShare).toBeGreaterThanOrEqual(15);
    expect(firstShare).toBeLessThanOrEqual(25);
    expect(secondShare).toBeGreaterThanOrEqual(15);
    expect(secondShare).toBeLessThanOrEqual(25);
  });

  it('keeps an entire deep single chain when total nodes fit within budget', () => {
    let current = makeComment('level-7', [], 1);
    for (let depth = 6; depth >= 0; depth -= 1) {
      current = makeComment(`level-${depth}`, [current], 10 - depth);
    }

    const trimmed = trimCommentsToLimit([current], 10);
    expect(countComments(trimmed)).toBe(8);
  });

  it('computes monotonic priority scores across depth, thread saturation, and repeat expands', () => {
    const shallow = scoreCommentCandidate({
      depth: 1,
      rootRank: 0,
      siblingRank: 0,
      likes: 100,
      threadReplies: 0,
      parentSelected: 0,
      budget: 100,
    });
    const deeper = scoreCommentCandidate({
      depth: 3,
      rootRank: 0,
      siblingRank: 0,
      likes: 100,
      threadReplies: 0,
      parentSelected: 0,
      budget: 100,
    });
    const saturated = scoreCommentCandidate({
      depth: 1,
      rootRank: 0,
      siblingRank: 0,
      likes: 100,
      threadReplies: 12,
      parentSelected: 0,
      budget: 100,
    });
    expect(shallow).toBeGreaterThan(deeper);
    expect(shallow).toBeGreaterThan(saturated);

    const firstExpand = scoreExpandCandidate({
      depth: 0,
      rootRank: 0,
      parentLikes: 200,
      threadReplies: 0,
      parentSelected: 0,
      expandClicks: 0,
      budget: 100,
    });
    const secondExpand = scoreExpandCandidate({
      depth: 0,
      rootRank: 0,
      parentLikes: 200,
      threadReplies: 4,
      parentSelected: 4,
      expandClicks: 1,
      budget: 100,
    });
    expect(firstExpand).toBeGreaterThan(secondExpand);

    const buttonLoad = scoreLoadMoreRoots({
      nextRootRank: 10,
      recentRootLikes: [50, 40, 30],
      hasLoadMoreBtn: true,
      consecutiveEmptyLoads: 0,
    });
    const emptyScroll = scoreLoadMoreRoots({
      nextRootRank: 10,
      recentRootLikes: [50, 40, 30],
      hasLoadMoreBtn: false,
      consecutiveEmptyLoads: 2,
    });
    expect(buttonLoad).toBeGreaterThan(emptyScroll);
  });

  it('trims replies deeper than maxReplyDepth including 0 (top-level only)', () => {
    const tree = [makeComment('r1', [makeComment('l1', [makeComment('l2', [makeComment('l3')])])])];

    expect(trimCommentsToDepth(tree, 0)).toEqual([makeComment('r1')]);
    expect(trimCommentsToDepth(tree, 1)).toEqual([makeComment('r1', [makeComment('l1')])]);
    expect(trimCommentsToDepth(tree, 2)).toEqual([
      makeComment('r1', [makeComment('l1', [makeComment('l2')])]),
    ]);
    expect(trimCommentsToDepth(tree, 5)).toEqual(tree);
  });
});
