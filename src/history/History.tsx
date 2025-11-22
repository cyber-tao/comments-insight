import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PAGINATION } from '@/config/constants';
import { MESSAGES } from '@/config/constants';
import { HistoryItem, Comment } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { exportCommentsAsCSV, exportAnalysisAsMarkdown } from '../utils/export';
import i18n from '../utils/i18n';

const History: React.FC = () => {
  const { t } = useTranslation();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'comments' | 'analysis'>('analysis');
  const [sortBy, setSortBy] = useState<'time' | 'likes' | 'replies'>('likes');

  // Comment view search and pagination
  const [commentSearchTerm, setCommentSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [commentsPerPage, setCommentsPerPage] = useState(PAGINATION.DEFAULT_PER_PAGE);

  useEffect(() => {
    // Load language from settings
    chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS }, (response) => {
      if (response?.settings?.language) {
        i18n.changeLanguage(response.settings.language);
      }
    });

    loadHistory();
  }, []);

  // Handle URL parameters for deep linking
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

  const sortComments = (comments: Comment[]): Comment[] => {
    const sorted = [...comments];

    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'time':
          // Sort by timestamp (newest first)
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        case 'likes':
          // Sort by likes (highest first)
          return b.likes - a.likes;
        case 'replies':
          // Sort by reply count (most replies first)
          return b.replies.length - a.replies.length;
        default:
          return 0;
      }
    });

    // Recursively sort replies
    return sorted.map((comment) => ({
      ...comment,
      replies: comment.replies.length > 0 ? sortComments(comment.replies) : comment.replies,
    }));
  };

  // Filter comments by search term (including replies)
  const filterComments = (comments: Comment[], searchTerm: string): Comment[] => {
    if (!searchTerm) return comments;

    const searchLower = searchTerm.toLowerCase();

    return comments
      .filter((comment) => {
        // Check if comment matches
        const commentMatches =
          comment.username.toLowerCase().includes(searchLower) ||
          comment.content.toLowerCase().includes(searchLower) ||
          (comment.timestamp && comment.timestamp.toLowerCase().includes(searchLower));

        // Check if any reply matches
        const replyMatches =
          comment.replies &&
          comment.replies.some(
            (reply) =>
              reply.username.toLowerCase().includes(searchLower) ||
              reply.content.toLowerCase().includes(searchLower) ||
              (reply.timestamp && reply.timestamp.toLowerCase().includes(searchLower)),
          );

        return commentMatches || replyMatches;
      })
      .map((comment) => ({
        ...comment,
        // Also filter replies recursively
        replies: comment.replies ? filterComments(comment.replies, searchTerm) : [],
      }));
  };

  // Get filtered and sorted comments
  const getProcessedComments = (): Comment[] => {
    if (!selectedItem) return [];
    const filtered = filterComments(selectedItem.comments, commentSearchTerm);
    return sortComments(filtered);
  };

  // Pagination
  const paginatedComments = React.useMemo(() => {
    const processed = getProcessedComments();
    const startIndex = (currentPage - 1) * commentsPerPage;
    const endIndex = startIndex + commentsPerPage;
    return processed.slice(startIndex, endIndex);
  }, [selectedItem, commentSearchTerm, sortBy, currentPage, commentsPerPage]);

  const totalComments = getProcessedComments().length;
  const totalPages = Math.ceil(totalComments / commentsPerPage);

  // Reset pagination when search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [commentSearchTerm, selectedItem]);

  // Track expanded replies
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
      <div className={`${depth > 0 ? 'ml-6 border-l-2 border-gray-200 pl-4' : ''}`}>
        {comments.map((comment) => {
          const hasReplies = comment.replies && comment.replies.length > 0;
          const isExpanded = expandedReplies.has(comment.id);

          return (
            <div key={comment.id} className="mb-4">
              <div className="bg-gray-50 p-3 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-gray-800">{comment.username}</span>
                  <span className="text-xs text-gray-500">{comment.timestamp}</span>
                  <span className="text-xs text-gray-500">👍 {comment.likes}</span>
                  {hasReplies && (
                    <button
                      onClick={() => toggleReplies(comment.id)}
                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <span>{isExpanded ? '▼' : '▶'}</span>
                      <span>
                        💬 {comment.replies.length}{' '}
                        {comment.replies.length === 1 ? 'reply' : 'replies'}
                      </span>
                    </button>
                  )}
                </div>
                <p className="text-gray-700 whitespace-pre-wrap">{comment.content}</p>
              </div>
              {hasReplies && isExpanded && (
                <div className="mt-2">{renderCommentTree(comment.replies, depth + 1)}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - History List */}
      <div className="w-1/3 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">{t('history.title')}</h2>
            {history.length > 0 && (
              <button
                onClick={handleClearAll}
                className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
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
              className="flex-1 px-3 py-2 border rounded"
            />
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              🔍
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-gray-500">{t('common.loading')}</div>
          ) : history.length === 0 ? (
            <div className="p-4 text-center text-gray-500">{t('history.noHistory')}</div>
          ) : (
            <div className="divide-y">
              {history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedItem?.id === item.id ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-gray-800 truncate">{item.title}</h3>
                      <p className="text-xs text-gray-500">{formatDate(item.extractedAt)}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item.id);
                      }}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      🗑️
                    </button>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-500">
                    <span>💬 {item.commentsCount} comments</span>
                    {item.analysis && <span>🔥 {item.analysis.tokensUsed} tokens</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content - Details */}
      <div className="flex-1 flex flex-col">
        {selectedItem ? (
          <>
            {/* Header */}
            <div className="bg-white border-b p-4">
              <div className="mb-2">
                <a
                  href={selectedItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xl font-bold text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {selectedItem.title}
                </a>
              </div>
              <div className="flex gap-4 text-sm text-gray-600">
                <span>{selectedItem.platform}</span>
                <span>📅 {formatDate(selectedItem.extractedAt)}</span>
                <span>💬 {selectedItem.commentsCount} comments</span>
              </div>
            </div>

            {/* View Mode Tabs */}
            <div className="bg-white border-b px-4">
              <div className="flex gap-4">
                <button
                  onClick={() => setViewMode('analysis')}
                  className={`px-4 py-2 border-b-2 transition-colors ${
                    viewMode === 'analysis'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-800'
                  }`}
                >
                  📊 {t('history.analysis')}
                </button>
                <button
                  onClick={() => setViewMode('comments')}
                  className={`px-4 py-2 border-b-2 transition-colors ${
                    viewMode === 'comments'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-800'
                  }`}
                >
                  💬 {t('history.comments')}
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {viewMode === 'analysis' ? (
                <div>
                  {/* Analysis View Header with Export Button */}
                  <div className="mb-4 flex justify-between items-center">
                    <h3 className="text-lg font-semibold">{t('history.analysis')}</h3>
                    {selectedItem.analysis && (
                      <button
                        onClick={() => exportAnalysisAsMarkdown(selectedItem)}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm flex items-center gap-2 transition-colors shadow-sm"
                        title={t('history.exportMarkdownTooltip')}
                      >
                        <span>📝</span>
                        <span>{t('history.exportMarkdown')}</span>
                      </button>
                    )}
                  </div>

                  {/* Analysis Content */}
                  <div className="prose prose-sm md:prose-base max-w-none prose-table:border-collapse prose-th:border prose-th:border-gray-300 prose-th:bg-gray-100 prose-th:p-2 prose-td:border prose-td:border-gray-300 prose-td:p-2">
                    {selectedItem.analysis ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {selectedItem.analysis.markdown}
                      </ReactMarkdown>
                    ) : (
                      <div className="text-center text-gray-500 py-8">
                        {t('history.noAnalysis')}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  {/* Comments View Header with Export Button */}
                  <div className="mb-4 flex justify-between items-center">
                    <h3 className="text-lg font-semibold">
                      {t('history.allComments')} ({selectedItem.comments.length})
                    </h3>
                    <button
                      onClick={() => exportCommentsAsCSV(selectedItem.comments, selectedItem.title)}
                      className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm flex items-center gap-2 transition-colors shadow-sm"
                      title={t('history.exportCsvTooltip')}
                    >
                      <span>📄</span>
                      <span>{t('history.exportCsv')}</span>
                    </button>
                  </div>

                  {/* Search and Filter Bar */}
                  <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                    <div className="flex gap-4 items-center mb-3">
                      <div className="flex-1">
                        <input
                          type="text"
                          value={commentSearchTerm}
                          onChange={(e) => setCommentSearchTerm(e.target.value)}
                          placeholder={t('history.searchComments')}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-600">{t('history.sortBy')}:</label>
                        <select
                          value={sortBy}
                          onChange={(e) =>
                            setSortBy(e.target.value as 'time' | 'likes' | 'replies')
                          }
                          className="px-3 py-2 border rounded text-sm"
                        >
                          <option value="time">{t('history.sortByTime')}</option>
                          <option value="likes">{t('history.sortByLikes')}</option>
                          <option value="replies">{t('history.sortByReplies')}</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-600">
                          {t('history.commentsPerPage')}:
                        </label>
                        <select
                          value={commentsPerPage}
                          onChange={(e) => {
                            setCommentsPerPage(Number(e.target.value));
                            setCurrentPage(1);
                          }}
                          className="px-2 py-2 border rounded text-sm"
                        >
                          {PAGINATION.OPTIONS.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Search Results Info */}
                    {commentSearchTerm && (
                      <div className="text-sm text-gray-600">
                        {t('history.searchResults', {
                          count: totalComments,
                          total: selectedItem.comments.length,
                        })}
                      </div>
                    )}
                  </div>

                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="mb-4 flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <div className="text-sm text-gray-600">
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
                          className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                        >
                          ← {t('common.previous')}
                        </button>
                        <span className="px-3 py-1 text-sm font-medium">
                          {currentPage} / {totalPages}
                        </span>
                        <button
                          onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                          disabled={currentPage === totalPages}
                          className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                        >
                          {t('common.next')} →
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Comment List */}
                  {totalComments === 0 ? (
                    <div className="text-center text-gray-500 py-8">
                      {commentSearchTerm ? t('history.noCommentsFound') : t('history.noComments')}
                    </div>
                  ) : (
                    renderCommentTree(paginatedComments)
                  )}

                  {/* Bottom Pagination */}
                  {totalPages > 1 && (
                    <div className="mt-4 flex justify-center">
                      <div className="flex gap-2 items-center p-3 bg-gray-50 rounded-lg">
                        <button
                          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                          disabled={currentPage === 1}
                          className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                        >
                          ← {t('common.previous')}
                        </button>
                        <span className="px-3 py-1 text-sm font-medium">
                          {currentPage} / {totalPages}
                        </span>
                        <button
                          onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                          disabled={currentPage === totalPages}
                          className="px-3 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
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
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <p className="text-xl mb-2">📜</p>
              <p>{t('history.selectItem')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default History;
import { Logger } from '@/utils/logger';
