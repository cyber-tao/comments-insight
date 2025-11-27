import { Comment, SelectorMap, Platform } from '../../types';
import { LIKES } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { querySelectorDeep, querySelectorAllDeep } from '@/utils/dom-query';

export class CommentParser {
  extractCommentsBySelector(selectors: SelectorMap, platform: Platform): Comment[] {
    const comments: Comment[] = [];

    if (!selectors.commentContainer || !selectors.commentItem) {
      return comments;
    }

    try {
      const containers = querySelectorAllDeep(document, selectors.commentContainer);
      Logger.info('[CommentParser] Found comment containers', {
        count: containers.length,
        selector: selectors.commentContainer,
      });

      containers.forEach((container, containerIndex) => {
        const items = querySelectorAllDeep(container, selectors.commentItem);
        items.forEach((item, itemIndex) => {
          try {
            const comment = this.extractSingleComment(
              container,
              item,
              selectors,
              platform,
              containerIndex * 1000 + itemIndex,
            );
            if (comment) {
              comments.push(comment);
            }
          } catch (error) {
            Logger.warn('[CommentParser] Failed to extract comment', { error });
          }
        });
      });
    } catch (error) {
      Logger.error('[CommentParser] Failed to query comments', { error });
    }

    return comments;
  }

  extractSingleComment(
    container: Element,
    item: Element,
    selectors: SelectorMap,
    platform: Platform,
    index: number,
  ): Comment | null {
    const usernameEl = selectors.username ? querySelectorDeep(item, selectors.username) : null;
    const username = (usernameEl as HTMLElement)?.innerText?.trim() || '';

    const contentEl = selectors.content ? querySelectorDeep(item, selectors.content) : null;
    const content = (contentEl as HTMLElement)?.innerText?.trim() || '';

    if (!content) {
      return null;
    }

    const timestampEl = selectors.timestamp ? querySelectorDeep(item, selectors.timestamp) : null;
    const timestamp = (timestampEl as HTMLElement)?.innerText?.trim() || '';

    const likesEl = selectors.likes ? querySelectorDeep(item, selectors.likes) : null;
    const likes = this.parseLikes((likesEl as HTMLElement)?.innerText?.trim() || '0');

    const replies = this.extractReplies(container, selectors, platform);

    const id = this.generateCommentId(username, content, timestamp, index);

    return {
      id,
      username: username || 'Anonymous',
      content,
      timestamp,
      likes,
      replies,
    };
  }

  extractReplies(commentContainer: Element, selectors: SelectorMap, platform: Platform): Comment[] {
    if (!selectors.replyContainer || !selectors.replyItem) {
      return [];
    }

    const replies: Comment[] = [];

    try {
      const replyContainers = querySelectorAllDeep(commentContainer, selectors.replyContainer!);

      replyContainers.forEach((container) => {
        const replyItems = querySelectorAllDeep(container, selectors.replyItem!);

        replyItems.forEach((replyItem, index) => {
          const reply = this.extractSingleComment(container, replyItem, selectors, platform, index);
          if (reply) {
            replies.push(reply);
          }
        });
      });
    } catch (error) {
      Logger.warn('[CommentParser] Failed to extract replies', { error });
    }

    return replies;
  }

  parseLikes(text: string): number {
    if (!text) return 0;

    const cleaned = text.replace(/[^0-9KMkm万亿.]/g, '');

    if (cleaned.includes('亿')) {
      return Math.floor(parseFloat(cleaned) * LIKES.YI_MULTIPLIER);
    }
    if (cleaned.includes('万')) {
      return Math.floor(parseFloat(cleaned) * LIKES.W_MULTIPLIER);
    }

    if (cleaned.includes('K') || cleaned.includes('k')) {
      return Math.floor(parseFloat(cleaned) * LIKES.K_MULTIPLIER);
    }

    if (cleaned.includes('M') || cleaned.includes('m')) {
      return Math.floor(parseFloat(cleaned) * LIKES.M_MULTIPLIER);
    }

    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  }

  generateCommentId(username: string, content: string, timestamp: string, index: number): string {
    const hash = this.simpleHash(username + content + timestamp + index);
    return `comment_${hash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}

export const commentParser = new CommentParser();
