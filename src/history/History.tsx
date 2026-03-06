import * as React from 'react';
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PAGINATION, DATE_TIME } from '@/config/constants';
import { Comment } from '../types';
import i18n from '../utils/i18n';
import { useTheme } from '@/hooks/useTheme';
import { Logger } from '@/utils/logger';
import { ExtensionAPI } from '@/utils/extension-api';
import { HistorySidebar } from './components/HistorySidebar';
import { HistoryDetailPanel } from './components/HistoryDetailPanel';
import { useHistoryData } from './hooks/useHistoryData';
import { useHistoryReanalyze } from './hooks/useHistoryReanalyze';

const HISTORY_LIST_ITEM_HEIGHT = 108;
const HISTORY_LIST_OVERSCAN = 4;

const History: React.FC = () => {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'comments' | 'analysis'>('analysis');
  const [sortBy, setSortBy] = useState<'time' | 'likes' | 'replies'>('likes');
  const [exportPostContentInMarkdown, setExportPostContentInMarkdown] = useState(false);

  const [commentSearchTerm, setCommentSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [commentsPerPage, setCommentsPerPage] = useState(PAGINATION.DEFAULT_PER_PAGE);
  const listContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const [listScrollTop, setListScrollTop] = useState(0);
  const resetListScroll = useCallback(() => {
    setListScrollTop(0);
  }, []);

  useTheme();

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await ExtensionAPI.getSettings();
        if (settings?.language) {
          await i18n.changeLanguage(settings.language);
        }
        setExportPostContentInMarkdown(!!settings?.exportPostContentInMarkdown);
      } catch (error) {
        Logger.error('[History] Failed to load settings', { error });
      }
    };

    void loadSettings();
  }, []);

  const {
    fetchHistoryItemById,
    handleClearAll,
    handleDelete,
    handleSearch,
    handleSelectHistoryItem,
    history,
    historyPage,
    historyTotal,
    historyTotalPages,
    loading,
    searchQuery,
    selectedHistoryId,
    selectedItem,
    selectedItemLoading,
    setHistoryPage,
    setSearchQuery,
    setSelectedItem,
  } = useHistoryData({
    listContainerRef,
    onResetListScroll: resetListScroll,
    onSelectViewMode: setViewMode,
  });

  const {
    clearReanalyzeError,
    handleReanalyze,
    isReanalyzing,
    reanalyzeError,
    reanalyzeProgress,
    reanalyzeTaskId,
    reanalyzingHistoryId,
  } = useHistoryReanalyze({
    selectedItem,
    fetchHistoryItemById,
    setSelectedItem,
  });

  useEffect(() => {
    const updateViewportHeight = () => {
      setListViewportHeight(listContainerRef.current?.clientHeight || 0);
    };

    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    return () => window.removeEventListener('resize', updateViewportHeight);
  }, []);


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

  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());

  React.useEffect(() => {
    setCurrentPage(1);
    setExpandedReplies(new Set());
  }, [commentSearchTerm, selectedItem]);

  React.useEffect(() => {
    clearReanalyzeError();
  }, [clearReanalyzeError, selectedHistoryId]);

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

  const visibleListCount = Math.max(
    1,
    Math.ceil(listViewportHeight / HISTORY_LIST_ITEM_HEIGHT) + HISTORY_LIST_OVERSCAN * 2,
  );
  const listStartIndex = Math.max(
    0,
    Math.floor(listScrollTop / HISTORY_LIST_ITEM_HEIGHT) - HISTORY_LIST_OVERSCAN,
  );
  const listEndIndex = Math.min(history.length, listStartIndex + visibleListCount);
  const visibleHistoryEntries = history.slice(listStartIndex, listEndIndex);
  const listOffsetY = listStartIndex * HISTORY_LIST_ITEM_HEIGHT;
  const listTotalHeight = history.length * HISTORY_LIST_ITEM_HEIGHT;

  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <HistorySidebar
        history={history}
        historyPage={historyPage}
        historyTotal={historyTotal}
        historyTotalPages={historyTotalPages}
        loading={loading}
        searchQuery={searchQuery}
        selectedHistoryId={selectedHistoryId}
        listContainerRef={listContainerRef}
        historyListItemHeight={HISTORY_LIST_ITEM_HEIGHT}
        listTotalHeight={listTotalHeight}
        listOffsetY={listOffsetY}
        visibleHistoryEntries={visibleHistoryEntries}
        onSearchQueryChange={setSearchQuery}
        onSearch={handleSearch}
        onScroll={setListScrollTop}
        onSelectHistoryItem={(item) => {
          void handleSelectHistoryItem(item);
        }}
        onDeleteHistoryItem={(id) => {
          void handleDelete(id, confirm(t('history.deleteConfirm')));
        }}
        onClearAll={() => {
          void handleClearAll(confirm(t('history.clearAllConfirm')));
        }}
        onHistoryPageChange={setHistoryPage}
        formatDate={formatDate}
      />

      <div className="flex-1 flex flex-col">
        <HistoryDetailPanel
          selectedItem={selectedItem}
          selectedItemLoading={selectedItemLoading}
          viewMode={viewMode}
          exportPostContentInMarkdown={exportPostContentInMarkdown}
          commentSearchTerm={commentSearchTerm}
          sortBy={sortBy}
          commentsPerPage={commentsPerPage}
          currentPage={currentPage}
          totalComments={totalComments}
          totalPages={totalPages}
          paginatedComments={paginatedComments}
          isReanalyzing={isReanalyzing}
          reanalyzeError={reanalyzeError}
          reanalyzeProgress={reanalyzeProgress}
          reanalyzeTaskId={reanalyzeTaskId}
          reanalyzingHistoryId={reanalyzingHistoryId}
          onViewModeChange={setViewMode}
          onReanalyze={() => {
            void handleReanalyze();
          }}
          onCommentSearchTermChange={setCommentSearchTerm}
          onSortByChange={setSortBy}
          onCommentsPerPageChange={(value) => {
            setCommentsPerPage(value);
            setCurrentPage(1);
          }}
          onCurrentPageChange={setCurrentPage}
          renderCommentTree={renderCommentTree}
          formatDate={formatDate}
        />
      </div>
    </div>
  );
};

export default History;
