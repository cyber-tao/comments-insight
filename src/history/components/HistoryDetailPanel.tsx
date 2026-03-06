import * as React from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PAGINATION } from '@/config/constants';
import { type HistoryItem, type Comment } from '@/types';
import { exportAnalysisAsMarkdown, exportCommentsAsCSV } from '@/utils/export';

interface HistoryDetailPanelProps {
  selectedItem: HistoryItem | null;
  selectedItemLoading: boolean;
  viewMode: 'analysis' | 'comments';
  exportPostContentInMarkdown: boolean;
  commentSearchTerm: string;
  sortBy: 'time' | 'likes' | 'replies';
  commentsPerPage: number;
  currentPage: number;
  totalComments: number;
  totalPages: number;
  paginatedComments: Comment[];
  isReanalyzing: boolean;
  reanalyzeError: string | null;
  reanalyzeProgress: number | null;
  reanalyzeTaskId: string | null;
  reanalyzingHistoryId: string | null;
  onViewModeChange: (mode: 'analysis' | 'comments') => void;
  onReanalyze: () => void;
  onCommentSearchTermChange: (value: string) => void;
  onSortByChange: (value: 'time' | 'likes' | 'replies') => void;
  onCommentsPerPageChange: (value: number) => void;
  onCurrentPageChange: (updater: (current: number) => number) => void;
  renderCommentTree: (comments: Comment[], depth?: number) => React.ReactNode;
  formatDate: (timestamp: number) => string;
}

export const HistoryDetailPanel: React.FC<HistoryDetailPanelProps> = ({
  selectedItem,
  selectedItemLoading,
  viewMode,
  exportPostContentInMarkdown,
  commentSearchTerm,
  sortBy,
  commentsPerPage,
  currentPage,
  totalComments,
  totalPages,
  paginatedComments,
  isReanalyzing,
  reanalyzeError,
  reanalyzeProgress,
  reanalyzeTaskId,
  reanalyzingHistoryId,
  onViewModeChange,
  onReanalyze,
  onCommentSearchTermChange,
  onSortByChange,
  onCommentsPerPageChange,
  onCurrentPageChange,
  renderCommentTree,
  formatDate,
}) => {
  const { t } = useTranslation();

  if (!selectedItem) {
    if (selectedItemLoading) {
      return (
        <div
          className="flex-1 flex items-center justify-center"
          style={{ color: 'var(--text-muted)' }}
        >
          <div className="text-center">
            <p className="text-4xl mb-4">⏳</p>
            <p className="text-lg">{t('common.loading')}</p>
          </div>
        </div>
      );
    }

    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ color: 'var(--text-muted)' }}
      >
        <div className="text-center">
          <p className="text-6xl mb-4">📜</p>
          <p className="text-lg">{t('history.selectItem')}</p>
        </div>
      </div>
    );
  }

  return (
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
          <span>💬 {t('history.commentsWithCount', { count: selectedItem.commentsCount })}</span>
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
            onClick={() => onViewModeChange('analysis')}
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
            onClick={() => onViewModeChange('comments')}
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
              <div className="flex items-center gap-2">
                <button
                  onClick={onReanalyze}
                  disabled={isReanalyzing}
                  className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 transition-all shadow-md disabled:opacity-70 disabled:cursor-not-allowed"
                  style={{ backgroundColor: 'var(--accent-secondary)' }}
                  title={
                    reanalyzeTaskId
                      ? `${t('history.reanalyzing', '重新分析中')} #${reanalyzeTaskId}`
                      : t('history.reanalyzeTooltip', '重新发起分析并覆盖当前结果')
                  }
                >
                  <span>{isReanalyzing ? '⏳' : '🔄'}</span>
                  <span>
                    {isReanalyzing
                      ? `${t('history.reanalyzing', '重新分析中')} ${
                          reanalyzeProgress !== null ? `${Math.round(reanalyzeProgress)}%` : ''
                        }`
                      : t('history.reanalyze', '重新分析')}
                  </span>
                </button>
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
            </div>
            {reanalyzeError &&
              (!reanalyzingHistoryId || reanalyzingHistoryId === selectedItem.id) && (
                <div
                  className="mb-4 p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: 'var(--accent-danger)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                  }}
                >
                  {reanalyzeError}
                </div>
              )}

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
                    onChange={(e) => onCommentSearchTermChange(e.target.value)}
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
                    onChange={(e) => onSortByChange(e.target.value as 'time' | 'likes' | 'replies')}
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
                    onChange={(e) => onCommentsPerPageChange(Number(e.target.value))}
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
                    onClick={() => onCurrentPageChange((page) => Math.max(1, page - 1))}
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
                    onClick={() => onCurrentPageChange((page) => Math.min(totalPages, page + 1))}
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
                <p>{commentSearchTerm ? t('history.noCommentsFound') : t('history.noComments')}</p>
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
                    onClick={() => onCurrentPageChange((page) => Math.max(1, page - 1))}
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
                    onClick={() => onCurrentPageChange((page) => Math.min(totalPages, page + 1))}
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
  );
};