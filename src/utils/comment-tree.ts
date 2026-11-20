import type { Comment } from '@/types';

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

/**
 * Trims a comment forest in depth-first order so the total count of comments
 * plus all nested replies does not exceed `limit`.
 */
export function trimCommentsToLimit(comments: readonly Comment[], limit: number): Comment[] {
  if (!Array.isArray(comments) || comments.length === 0 || limit <= 0) {
    return [];
  }

  let remaining = Math.floor(limit);

  const take = (items: readonly Comment[]): Comment[] => {
    const result: Comment[] = [];
    for (const comment of items) {
      if (remaining <= 0) break;
      remaining -= 1;
      const replies =
        remaining > 0 && Array.isArray(comment.replies) && comment.replies.length > 0
          ? take(comment.replies)
          : [];
      result.push({
        ...comment,
        replies,
      });
    }
    return result;
  };

  return take(comments);
}
