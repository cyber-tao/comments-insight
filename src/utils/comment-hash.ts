import type { Comment } from '../types';
import { COMMENT_HASH } from '../config/constants';

export function generateCommentHash(comment: Comment): string {
  const str = `${comment.username}|${comment.content.length}|${comment.content}|${comment.timestamp}`;
  let h1 = COMMENT_HASH.SEED_1;
  let h2 = COMMENT_HASH.SEED_2;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, COMMENT_HASH.MULT_1);
    h2 = Math.imul(h2 ^ ch, COMMENT_HASH.MULT_2);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), COMMENT_HASH.XOR_1) ^
    Math.imul(h2 ^ (h2 >>> 13), COMMENT_HASH.XOR_2);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), COMMENT_HASH.XOR_1) ^
    Math.imul(h1 ^ (h1 >>> 13), COMMENT_HASH.XOR_2);
  const combined = (COMMENT_HASH.FINAL_MULT * (COMMENT_HASH.FINAL_MASK & h2) + (h1 >>> 0)) >>> 0;
  return combined.toString(COMMENT_HASH.RADIX);
}
