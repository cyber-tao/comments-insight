import * as React from 'react';
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PAGINATION, MESSAGES, DATE_TIME } from '@/config/constants';
import { HistoryItem, Comment } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { exportCommentsAsCSV, exportAnalysisAsMarkdown } from '../utils/export';
import i18n from '../utils/i18n';
import { useTheme } from '@/hooks/useTheme';
import { Logger } from '@/utils/logger';

const History: React.FC = () => {
  const { t } = useTranslation();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'comments' | 'analysis'>('analysis');
  const [sortBy, setSortBy] = useState<'time' | 'likes' | 'replies'>('likes');
  const [exportPostContentInMarkdown, setExportPostContentInMarkdown] = useState(false);

  const [commentSearchTerm, setCommentSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [commentsPerPage, setCommentsPerPage] = useState(PAGINATION.DEFAULT_PER_PAGE);

  useTheme();

  useEffect(() => {
    chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS }, (response) => {
      if (response?.settings?.language) {
        i18n.changeLanguage(response.settings.language);
      }
      setExportPostContentInMarkdown(!!response?.settings?.exportPostContentInMarkdown);
    });

    loadHistory();
  }, []);

  useEffect(() => {
    if (history.length === 0) return;

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const tab = params.get('tab');

    if (id) {
      const item = history.find((h) => h.id === id);
      if (item) {
        setSelectedItem(item);
        if (tab === 'analysis' || tab === 'comments') {
          setViewMode(tab);
        }
      }
    }
  }, [history]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGES.GET_HISTORY });

      if (chrome.runtime.lastError) {
        Logger.error('[History] Failed to load history', { error: chrome.runtime.lastError });
        return;
      }

      if (response?.history) {
        setHistory(response.history);
      }
    } catch (error) {
      Logger.error('[History] Failed to load history', { error });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadHistory();
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.GET_HISTORY,
        payload: { query: searchQuery },
      });
      if (response?.items) {
        setHistory(response.items);
      }
    } catch (error) {
      Logger.error('[History] Failed to search', { error });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('history.deleteConfirm'))) return;

    try {
      await chrome.runtime.sendMessage({
        type: MESSAGES.DELETE_HISTORY,
        payload: { id },
      });
      setHistory(history.filter((item) => item.id !== id));
      if (selectedItem?.id === id) {
        setSelectedItem(null);
      }
    } catch (error) {
      Logger.error('[History] Failed to delete', { error });
    }
  };

  const handleClearAll = async () => {
    if (!confirm(t('history.clearAllConfirm'))) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.CLEAR_ALL_HISTORY,
      });

      if (response?.success) {
        setHistory([]);
        setSelectedItem(null);
      }
    } catch (error) {
      Logger.error('[History] Failed to clear all', { error });
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatCommentTimestamp = (timestamp: string) => {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return timestamp;
    }
    const pad = (value: number) => value.toString().padStart(DATE_TIME.PAD_LENGTH, '0');
    const year = parsed.getFullYear();
    const month = pad(parsed.getMonth() + DATE_TIME.MONTH_OFFSET);
    const day = pad(parsed.getDate());
    const hours = pad(parsed.getHours());
    const minutes = pad(parsed.getMinutes());
    return `${year}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${month}${DATE_TIME.DISPLAY_DATE_SEPARATOR}${day}${DATE_TIME.DISPLAY_DATE_TIME_SEPARATOR}${hours}${DATE_TIME.DISPLAY_TIME_SEPARATOR}${minutes}`;
  };

  const sortComments = useCallback(
    (comments: Comment[]): Comment[] => {
      const sorted = [...comments];

      sorted.sort((a, b) => {
        switch (sortBy) {
          case 'time':
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
          case 'likes':
            return b.likes - a.likes;
          case 'replies':
            return b.replies.length - a.replies.length;
          default:
            return 0;
        }
      });

      const sortReplies = (c: Comment[]): Comment[] =>
        c.map((comment) => ({
          ...comment,
          replies: comment.replies.length > 0 ? sortReplies(comment.replies) : comment.replies,
        }));

      return sortReplies(sorted);
    },
    [sortBy],
  );

  const filterComments = useCallback((comments: Comment[], searchTerm: string): Comment[] => {
    if (!searchTerm) return comments;

    const searchLower = searchTerm.toLowerCase();

    const filterRecursive = (items: Comment[]): Comment[] =>
      items
        .filter((comment) => {
          const commentTimestamp = formatCommentTimestamp(comment.timestamp);
          const commentMatches =
            comment.username.toLowerCase().includes(searchLower) ||
            comment.content.toLowerCase().includes(searchLower) ||
            (commentTimestamp && commentTimestamp.toLowerCase().includes(searchLower));

          const replyMatches =
            comment.replies &&
            comment.replies.some(
              (reply) =>
                reply.username.toLowerCase().includes(searchLower) ||
                reply.content.toLowerCase().includes(searchLower) ||
                (formatCommentTimestamp(reply.timestamp) &&
                  formatCommentTimestamp(reply.timestamp).toLowerCase().includes(searchLower)),
            );

          return commentMatches || replyMatches;
        })
        .map((comment) => ({
          ...comment,
          replies: comment.replies ? filterRecursive(comment.replies) : [],
        }));

    return filterRecursive(comments);
  }, []);

  const getProcessedComments = (): Comment[] => {
    if (!selectedItem) return [];
    const filtered = filterComments(selectedItem.comments, commentSearchTerm);
    return sortComments(filtered);
  };

  const paginatedComments = React.useMemo(() => {
    const filtered = filterComments(selectedItem?.comments || [], commentSearchTerm);
    const sorted = sortComments(filtered);
    const startIndex = (currentPage - 1) * commentsPerPage;
    const endIndex = startIndex + commentsPerPage;
    return sorted.slice(startIndex, endIndex);
  }, [selectedItem, commentSearchTerm, sortComments, filterComments, currentPage, commentsPerPage]);

  const totalComments = getProcessedComments().length;
  const totalPages = Math.ceil(totalComments / commentsPerPage);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [commentSearchTerm, selectedItem]);

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

  const renderCommentTree = (comments: Comment[], depth = 0) => {
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
                <div className="mt-3">{renderCommentTree(comment.replies, depth + 1)}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div
        className="w-1/3 flex flex-col"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderRight: '1px solid var(--border-primary)',
        }}
      >
        <div className="p-5" style={{ borderBottom: '1px solid var(--border-primary)' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {t('history.title')}
            </h2>
            {history.length > 0 && (
              <button
                onClick={handleClearAll}
                className="px-3 py-1.5 text-sm rounded-lg transition-colors font-medium"
                style={{
                  backgroundColor: 'var(--accent-danger)',
                  color: 'white',
                }}
              >
                🗑️ {t('history.clearAll')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('history.searchPlaceholder')}
              className="flex-1 theme-input"
            />
            <button
              onClick={handleSearch}
              className="px-4 py-2 rounded-lg text-white font-medium transition-all hover:scale-105"
              style={{ background: 'var(--gradient-primary)' }}
            >
              🔍
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
              <div className="animate-pulse">⏳ {t('common.loading')}</div>
            </div>
          ) : history.length === 0 ? (
            <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>
              <p className="text-4xl mb-2">📭</p>
              <p>{t('history.noHistory')}</p>
            </div>
          ) : (
            <div>
              {history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="p-4 cursor-pointer transition-all"
                  style={{
                    backgroundColor:
                      selectedItem?.id === item.id ? 'var(--bg-selected)' : 'transparent',
                    borderBottom: '1px solid var(--border-primary)',
                  }}
                >
                  <div className="flex items-start gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3
                        className="font-semibold truncate mb-1"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {item.title}
                      </h3>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatDate(item.extractedAt)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item.id);
                      }}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                      style={{ color: 'var(--accent-danger)' }}
                    >
                      🗑️
                    </button>
                  </div>
                  <div className="flex gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="flex items-center gap-1">
                      💬 {t('history.commentsWithCount', { count: item.commentsCount })}
                    </span>
                    {item.analysis && (
                      <span className="flex items-center gap-1">
                        🔥 {t('history.tokensWithCount', { count: item.analysis.tokensUsed })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {selectedItem ? (
          <>
            <div
              className="p-5"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderBottom: '1px solid var(--border-primary)',
              }}
            >
              <div className="mb-3">
                <a
                  href={selectedItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xl font-bold theme-link hover:underline"
                >
                  {selectedItem.title}
                </a>
              </div>
              <div className="flex gap-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <span
                  className="px-2 py-1 rounded-full text-xs font-medium"
                  style={{ backgroundColor: 'var(--bg-tertiary)' }}
                >
                  {selectedItem.platform}
                </span>
                <span>📅 {formatDate(selectedItem.extractedAt)}</span>
                <span>
                  💬 {t('history.commentsWithCount', { count: selectedItem.commentsCount })}
                </span>
              </div>
              {selectedItem.postContent && (
                <details className="mt-4 text-sm">
                  <summary
                    className="cursor-pointer font-medium"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    📝 {t('history.postContent')}
                  </summary>
                  <div
                    className="mt-2 p-3 rounded-lg whitespace-pre-wrap"
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {selectedItem.postContent}
                  </div>
                </details>
              )}
            </div>

            <div
              className="px-5"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderBottom: '1px solid var(--border-primary)',
              }}
            >
              <div className="flex gap-1">
                <button
                  onClick={() => setViewMode('analysis')}
                  className={`px-5 py-3 font-medium text-sm transition-all border-b-2 ${
                    viewMode === 'analysis' ? 'border-blue-500 text-blue-500' : 'border-transparent'
                  }`}
                  style={{
                    color: viewMode === 'analysis' ? undefined : 'var(--text-tertiary)',
                  }}
                >
                  📊 {t('history.analysis')}
                </button>
                <button
                  onClick={() => setViewMode('comments')}
                  className={`px-5 py-3 font-medium text-sm transition-all border-b-2 ${
                    viewMode === 'comments' ? 'border-blue-500 text-blue-500' : 'border-transparent'
                  }`}
                  style={{
                    color: viewMode === 'comments' ? undefined : 'var(--text-tertiary)',
                  }}
                >
                  💬 {t('history.comments')}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {viewMode === 'analysis' ? (
                <div className="animate-fade-in">
                  <div className="mb-6 flex justify-between items-center">
                    <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {t('history.analysis')}
                    </h3>
                    {selectedItem.analysis && (
                      <button
                        onClick={() =>
                          exportAnalysisAsMarkdown(selectedItem, exportPostContentInMarkdown)
                        }
                        className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 transition-all hover:scale-105 shadow-md"
                        style={{ background: 'var(--gradient-primary)' }}
                        title={t('history.exportMarkdownTooltip')}
                      >
                        <span>📝</span>
                        <span>{t('history.exportMarkdown')}</span>
                      </button>
                    )}
                  </div>

                  <div
                    className="theme-card p-6"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                    }}
                  >
                    {selectedItem.analysis ? (
                      <div
                        className="prose prose-sm md:prose-base dark:prose-invert max-w-none"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {selectedItem.analysis.markdown}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                        <p className="text-4xl mb-3">🔍</p>
                        <p>{t('history.noAnalysis')}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="animate-fade-in">
                  <div className="mb-6 flex justify-between items-center">
                    <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {t('history.allComments')} ({selectedItem.comments.length})
                    </h3>
                    <button
                      onClick={() => exportCommentsAsCSV(selectedItem.comments, selectedItem.title)}
                      className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 transition-all hover:scale-105 shadow-md"
                      style={{ backgroundColor: 'var(--accent-secondary)' }}
                      title={t('history.exportCsvTooltip')}
                    >
                      <span>📄</span>
                      <span>{t('history.exportCsv')}</span>
                    </button>
                  </div>

                  <div
                    className="mb-6 p-4 rounded-xl"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      border: '1px solid var(--border-primary)',
                    }}
                  >
                    <div className="flex gap-4 items-center mb-4 flex-wrap">
                      <div className="flex-1 min-w-64">
                        <input
                          type="text"
                          value={commentSearchTerm}
                          onChange={(e) => setCommentSearchTerm(e.target.value)}
                          placeholder={t('history.searchComments')}
                          className="w-full theme-input"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          {t('history.sortBy')}:
                        </label>
                        <select
                          value={sortBy}
                          onChange={(e) =>
                            setSortBy(e.target.value as 'time' | 'likes' | 'replies')
                          }
                          className="theme-input text-sm"
                        >
                          <option value="time">{t('history.sortByTime')}</option>
                          <option value="likes">{t('history.sortByLikes')}</option>
                          <option value="replies">{t('history.sortByReplies')}</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          {t('history.commentsPerPage')}:
                        </label>
                        <select
                          value={commentsPerPage}
                          onChange={(e) => {
                            setCommentsPerPage(Number(e.target.value));
                            setCurrentPage(1);
                          }}
                          className="theme-input text-sm"
                        >
                          {PAGINATION.OPTIONS.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {commentSearchTerm && (
                      <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {t('history.searchResults', {
                          count: totalComments,
                          total: selectedItem.comments.length,
                        })}
                      </div>
                    )}
                  </div>

                  {totalPages > 1 && (
                    <div
                      className="mb-6 flex justify-between items-center p-4 rounded-xl"
                      style={{
                        backgroundColor: 'var(--bg-card)',
                        border: '1px solid var(--border-primary)',
                      }}
                    >
                      <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {t('history.showingComments', {
                          start: (currentPage - 1) * commentsPerPage + 1,
                          end: Math.min(currentPage * commentsPerPage, totalComments),
                          total: totalComments,
                        })}
                      </div>
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                          disabled={currentPage === 1}
                          className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                          style={{
                            backgroundColor: 'var(--bg-tertiary)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          ← {t('common.previous')}
                        </button>
                        <span
                          className="px-4 py-2 text-sm font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {currentPage} / {totalPages}
                        </span>
                        <button
                          onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                          disabled={currentPage === totalPages}
                          className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                          style={{
                            backgroundColor: 'var(--bg-tertiary)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {t('common.next')} →
                        </button>
                      </div>
                    </div>
                  )}

                  {totalComments === 0 ? (
                    <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                      <p className="text-4xl mb-3">🔍</p>
                      <p>
                        {commentSearchTerm ? t('history.noCommentsFound') : t('history.noComments')}
                      </p>
                    </div>
                  ) : (
                    renderCommentTree(paginatedComments)
                  )}

                  {totalPages > 1 && (
                    <div className="mt-6 flex justify-center">
                      <div
                        className="flex gap-2 items-center p-3 rounded-xl"
                        style={{
                          backgroundColor: 'var(--bg-card)',
                          border: '1px solid var(--border-primary)',
                        }}
                      >
                        <button
                          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                          disabled={currentPage === 1}
                          className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                          style={{
                            backgroundColor: 'var(--bg-tertiary)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          ← {t('common.previous')}
                        </button>
                        <span
                          className="px-4 py-2 text-sm font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {currentPage} / {totalPages}
                        </span>
                        <button
                          onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                          disabled={currentPage === totalPages}
                          className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                          style={{
                            backgroundColor: 'var(--bg-tertiary)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {t('common.next')} →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div
            className="flex-1 flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <div className="text-center">
              <p className="text-6xl mb-4">📜</p>
              <p className="text-lg">{t('history.selectItem')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default History;
