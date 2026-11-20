import { describe, expect, it } from 'vitest';
import type { Comment } from '@/types';
import {
  countCommentReplies,
  countComments,
  trimCommentsToDepth,
  trimCommentsToLimit,
} from '@/utils/comment-tree';

function makeComment(id: string, replies: Comment[] = []): Comment {
  return {
    id,
    username: `user-${id}`,
    content: `content-${id}`,
    timestamp: '2026-01-01 00:00',
    likes: 0,
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

  it('trims comments in depth-first order so total comments + replies stay within limit', () => {
    const tree = [
      makeComment('r1', [makeComment('r1-1', [makeComment('r1-1-1')]), makeComment('r1-2')]),
      makeComment('r2', [makeComment('r2-1')]),
    ];

    expect(trimCommentsToLimit(tree, 0)).toEqual([]);
    expect(trimCommentsToLimit(tree, 1)).toEqual([makeComment('r1')]);
    expect(trimCommentsToLimit(tree, 3)).toEqual([
      makeComment('r1', [makeComment('r1-1', [makeComment('r1-1-1')])]),
    ]);
    expect(trimCommentsToLimit(tree, 4)).toEqual([
      makeComment('r1', [makeComment('r1-1', [makeComment('r1-1-1')]), makeComment('r1-2')]),
    ]);
    expect(trimCommentsToLimit(tree, 5)).toEqual([
      makeComment('r1', [makeComment('r1-1', [makeComment('r1-1-1')]), makeComment('r1-2')]),
      makeComment('r2'),
    ]);
    expect(countComments(trimCommentsToLimit(tree, 4))).toBe(4);
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
