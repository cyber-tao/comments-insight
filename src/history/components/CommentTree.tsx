import * as React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HISTORY_UI } from '@/config/constants';
import { Comment } from '@/types';
import { formatCommentTimestamp } from '@/utils/date-formatter';

interface CommentTreeProps {
  comments: Comment[];
  depth?: number;
}

export const CommentTree: React.FC<CommentTreeProps> = ({ comments, depth = 0 }) => {
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

  if (depth >= HISTORY_UI.MAX_COMMENT_DEPTH) {
    return (
      <div className="ml-4 pl-4 text-xs text-gray-400 italic">{t('history.deepRepliesHidden')}</div>
    );
  }

  return (
    <div
      className={`${depth > 0 ? 'ml-4 pl-4' : ''}`}
      style={depth > 0 ? { borderLeft: '2px solid var(--border-primary)' } : {}}
    >
      {comments.map((comment) => {
        const hasReplies = comment.replies && comment.replies.length > 0;
        const isExpanded = expandedReplies.has(comment.id);

        return (
          <div key={comment.id} className="mb-4 animate-fade-in">
            <div
              className="p-4 rounded-xl transition-all hover:shadow-md"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                  style={{ background: 'var(--gradient-primary)' }}
                >
                  {comment.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {comment.username}
                  </span>
                  <div
                    className="flex items-center gap-3 text-xs"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <span>📅 {formatCommentTimestamp(comment.timestamp)}</span>
                    <span className="flex items-center gap-1">
                      <span className="text-red-500">❤️</span> {comment.likes}
                    </span>
                  </div>
                </div>
                {hasReplies && (
                  <button
                    onClick={() => toggleReplies(comment.id)}
                    className="px-3 py-1 rounded-full text-xs font-medium transition-all hover:scale-105"
                    style={{
                      backgroundColor: isExpanded ? 'var(--accent-primary)' : 'var(--bg-card)',
                      color: isExpanded ? 'white' : 'var(--text-secondary)',
                      border: isExpanded ? 'none' : '1px solid var(--border-primary)',
                    }}
                  >
                    {isExpanded ? '▼' : '▶'} 💬{' '}
                    {comment.replies.length === 1
                      ? t('history.reply', { count: comment.replies.length })
                      : t('history.replies', { count: comment.replies.length })}
                  </button>
                )}
              </div>
              <p
                className="whitespace-pre-wrap leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
              >
                {comment.content}
              </p>
            </div>
            {hasReplies && isExpanded && (
              <div className="mt-3">
                {/* Note: In recursive calls, we don't pass down expandedReplies state,
                    because the root tree component maintains the full set for all descendants based on ID.
                    Wait, if CommentTree manages its own state, then nested CommentTree components will have their own state!
                    This is fine, except the `expandedReplies` ID is flat in the original.
                    So if we recursively use `<CommentTree comments={comment.replies} depth={depth + 1} />`,
                    each sub-tree will manage its own expansion state.
                    This is actually better encapsulation! */}
                <CommentTree comments={comment.replies} depth={depth + 1} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
