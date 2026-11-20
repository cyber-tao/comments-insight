import * as React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HISTORY_UI } from '@/config/constants';
import { Comment } from '@/types';
import { countCommentReplies } from '@/utils/comment-tree';
import { formatCommentTimestamp } from '@/utils/date-formatter';
import { CommentsIcon, HeartIcon } from '@/components/Icons';

interface CommentTreeProps {
  comments: Comment[];
  depth?: number;
  parentUsername?: string;
}

export const CommentTree: React.FC<CommentTreeProps> = ({
  comments,
  depth = 0,
  parentUsername,
}) => {
  const { t } = useTranslation();
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());

  const toggleReplies = (commentId: string) => {
    setExpandedReplies((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(commentId)) {
        newSet.delete(commentId);
      } else {
        newSet.add(commentId);
      }
      return newSet;
    });
  };

  const isDeeplyNested = depth > HISTORY_UI.MAX_INDENT_DEPTH;
  const containerIndentClass = depth === 0 ? '' : isDeeplyNested ? 'pl-3' : 'ml-4 pl-4';

  return (
    <div
      className={containerIndentClass}
      style={
        depth > 0
          ? {
              borderLeft: isDeeplyNested
                ? '2px dashed var(--border-primary)'
                : '2px solid var(--border-primary)',
            }
          : {}
      }
    >
      {comments.map((comment, index) => {
        const totalReplyCount = countCommentReplies(comment);
        const hasReplies = totalReplyCount > 0;
        const isExpanded = expandedReplies.has(comment.id);
        const deferClass = depth === 0 && index >= 8 ? ' comment-item-deferred' : '';

        return (
          <div key={comment.id} className={`mb-3.5 animate-fade-in${deferClass}`}>
            <div
              className="p-4 rounded-xl transition-colors"
              style={{
                backgroundColor: depth === 0 ? 'var(--bg-card)' : 'var(--bg-tertiary)',
                border: '1px solid var(--border-primary)',
                boxShadow: depth === 0 ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <div className="flex items-center gap-3 mb-2.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center font-mono-code font-semibold text-xs shrink-0"
                  style={{
                    backgroundColor: 'var(--accent-primary-soft)',
                    color: 'var(--accent-primary)',
                    border: '1px solid rgba(var(--accent-primary-rgb), 0.2)',
                  }}
                >
                  {comment.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span
                      className="font-semibold text-sm truncate"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {comment.username}
                    </span>
                    {isDeeplyNested && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-mono-code font-medium shrink-0"
                        style={{
                          backgroundColor: 'var(--accent-primary-soft)',
                          color: 'var(--accent-primary)',
                        }}
                      >
                        {t('history.replyDepth', { depth })}
                      </span>
                    )}
                    {isDeeplyNested && parentUsername && (
                      <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                        {t('history.replyingTo', { username: parentUsername })}
                      </span>
                    )}
                  </div>
                  <div
                    className="flex items-center gap-3 text-xs tabular-nums mt-0.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span>{formatCommentTimestamp(comment.timestamp)}</span>
                    <span className="inline-flex items-center gap-1">
                      <HeartIcon size={12} style={{ color: 'var(--accent-secondary)' }} />
                      {comment.likes}
                    </span>
                  </div>
                </div>
                {hasReplies && (
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleReplies(comment.id)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium transition-colors inline-flex items-center gap-1 tabular-nums"
                    style={{
                      backgroundColor: isExpanded ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                      color: isExpanded ? '#ffffff' : 'var(--text-secondary)',
                      border: isExpanded
                        ? '1px solid transparent'
                        : '1px solid var(--border-primary)',
                    }}
                  >
                    <span>{isExpanded ? '▼' : '▶'}</span>
                    <CommentsIcon size={11} />
                    <span>
                      {totalReplyCount === 1
                        ? t('history.reply', { count: totalReplyCount })
                        : t('history.replies', { count: totalReplyCount })}
                    </span>
                  </button>
                )}
              </div>
              <p
                className="whitespace-pre-wrap text-sm leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                {comment.content}
              </p>
            </div>
            {hasReplies && isExpanded && (
              <div className="mt-2.5">
                <CommentTree
                  comments={comment.replies}
                  depth={depth + 1}
                  parentUsername={comment.username}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
