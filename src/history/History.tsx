import * as React from 'react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PAGINATION } from '@/config/constants';
import { Comment } from '../types';
import { changeLanguage } from '../utils/i18n';
import { useTheme } from '@/hooks/useTheme';
import { Logger } from '@/utils/logger';
import { ExtensionAPI } from '@/utils/extension-api';
import { formatCommentTimestamp } from '@/utils/date-formatter';
import { HistorySidebar } from './components/HistorySidebar';
import { HistoryDetailPanel } from './components/HistoryDetailPanel';
import { useHistoryData } from './hooks/useHistoryData';
import { useHistoryReanalyze } from './hooks/useHistoryReanalyze';
import { useConfirm } from '@/hooks/useConfirm';

const History: React.FC = () => {
  const { t } = useTranslation();
  const { confirm, ConfirmHost } = useConfirm();
  const [viewMode, setViewMode] = useState<'comments' | 'analysis'>('analysis');
  const [sortBy, setSortBy] = useState<'time' | 'likes' | 'replies'>('likes');
  const [exportPostContentInMarkdown, setExportPostContentInMarkdown] = useState(false);

  const [commentSearchTerm, setCommentSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [commentsPerPage, setCommentsPerPage] = useState(PAGINATION.DEFAULT_PER_PAGE);
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const resetListScroll = useCallback(() => {}, []);

  useTheme();

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await ExtensionAPI.getSettings();
        if (settings?.language) {
          await changeLanguage(settings.language);
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
    selectedItemError,
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
    reanalyzeDetailedProgress,
    reanalyzeMessage,
    reanalyzeProgress,
    reanalyzeTaskId,
    reanalyzingHistoryId,
  } = useHistoryReanalyze({
    selectedItem,
    fetchHistoryItemById,
    setSelectedItem,
  });

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
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

  const processedComments = React.useMemo(() => {
    const filtered = filterComments(selectedItem?.comments || [], commentSearchTerm);
    return sortComments(filtered);
  }, [selectedItem, commentSearchTerm, sortComments, filterComments]);

  const paginatedComments = React.useMemo(() => {
    const startIndex = (currentPage - 1) * commentsPerPage;
    const endIndex = startIndex + commentsPerPage;
    return processedComments.slice(startIndex, endIndex);
  }, [processedComments, currentPage, commentsPerPage]);

  const totalComments = processedComments.length;
  const totalPages = Math.ceil(totalComments / commentsPerPage);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [commentSearchTerm, selectedItem]);

  React.useEffect(() => {
    clearReanalyzeError();
  }, [clearReanalyzeError, selectedHistoryId]);

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
        onSearchQueryChange={setSearchQuery}
        onSearch={handleSearch}
        onSelectHistoryItem={(item) => {
          void handleSelectHistoryItem(item);
        }}
        onDeleteHistoryItem={(id) => {
          void (async () => {
            const ok = await confirm({
              message: t('history.deleteConfirm'),
              destructive: true,
            });
            await handleDelete(id, ok);
          })();
        }}
        onClearAll={() => {
          void (async () => {
            const ok = await confirm({
              message: t('history.clearAllConfirm'),
              destructive: true,
            });
            await handleClearAll(ok);
          })();
        }}
        onHistoryPageChange={setHistoryPage}
        formatDate={formatDate}
      />

      <div className="flex-1 flex flex-col">
        <HistoryDetailPanel
          selectedItem={selectedItem}
          selectedItemError={selectedItemError}
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
          reanalyzeDetailedProgress={reanalyzeDetailedProgress}
          reanalyzeMessage={reanalyzeMessage}
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
          formatDate={formatDate}
        />
      </div>
      <ConfirmHost />
    </div>
  );
};

export default History;
