import * as React from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PAGINATION, UI_LIMITS } from '@/config/constants';
import { type HistoryItem, type Comment, type TaskProgress } from '@/types';
import {
  exportAnalysisAsMarkdown,
  exportAnalysisAsHTML,
  exportCommentsAsCSV,
} from '@/utils/export';
import { formatTaskProgressMessage } from '@/utils/task-progress-display';
import { CommentTree } from './CommentTree';
import { DynamicReportViewer } from './DynamicReportViewer';

interface HistoryDetailPanelProps {
  selectedItem: HistoryItem | null;
  selectedItemError: string | null;
  selectedItemLoading: boolean;
  viewMode: 'analysis' | 'dynamic' | 'comments';
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
  reanalyzeDetailedProgress?: TaskProgress | null;
  reanalyzeMessage?: string | null;
  reanalyzeProgress: number | null;
  reanalyzeTaskId: string | null;
  reanalyzingHistoryId: string | null;
  isGeneratingDynamic?: boolean;
  generateDynamicError?: string | null;
  onViewModeChange: (mode: 'analysis' | 'dynamic' | 'comments') => void;
  onReanalyze: () => void;
  onGenerateDynamicReport?: () => void;
  onCommentSearchTermChange: (value: string) => void;
  onSortByChange: (value: 'time' | 'likes' | 'replies') => void;
  onCommentsPerPageChange: (value: number) => void;
  onCurrentPageChange: (updater: (current: number) => number) => void;
  formatDate: (timestamp: number) => string;
}

export const HistoryDetailPanel: React.FC<HistoryDetailPanelProps> = ({
  selectedItem,
  selectedItemError,
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
  reanalyzeDetailedProgress = null,
  reanalyzeMessage = null,
  reanalyzeProgress,
  reanalyzeTaskId,
  reanalyzingHistoryId,
  isGeneratingDynamic = false,
  generateDynamicError = null,
  onViewModeChange,
  onReanalyze,
  onGenerateDynamicReport,
  onCommentSearchTermChange,
  onSortByChange,
  onCommentsPerPageChange,
  onCurrentPageChange,
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

    if (selectedItemError) {
      return (
        <div
          className="flex-1 flex items-center justify-center"
          style={{ color: 'var(--text-muted)' }}
        >
          <div className="text-center max-w-md px-6">
            <p className="text-4xl mb-4">⚠️</p>
            <p className="text-lg mb-2" style={{ color: 'var(--accent-danger)' }}>
              {selectedItemError}
            </p>
            <p>{t('history.selectItem')}</p>
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

  const activeReanalyzeProgress = Math.min(
    Math.max(reanalyzeProgress ?? UI_LIMITS.PROGRESS_MIN_PERCENT, UI_LIMITS.PROGRESS_MIN_PERCENT),
    UI_LIMITS.PROGRESS_MAX_PERCENT,
  );
  const hasAnalysis = Boolean(selectedItem.analysis?.markdown?.trim());
  const hasDynamicHtml = Boolean(selectedItem.analysis?.dynamicHtml?.trim());

  const isFullscreen =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('fullscreen') === 'true';

  const handleOpenInNewTab = () => {
    if (!selectedItem?.id) return;
    const url = chrome.runtime.getURL(
      `src/history/index.html?id=${selectedItem.id}&tab=dynamic&fullscreen=true`,
    );
    window.open(url, '_blank');
  };

  const handleExitFullscreen = () => {
    if (!selectedItem?.id) return;
    window.location.href = chrome.runtime.getURL(
      `src/history/index.html?id=${selectedItem.id}&tab=dynamic`,
    );
  };

  const reanalyzeProgressMessage = formatTaskProgressMessage({
    type: 'analyze',
    detailedProgress: reanalyzeDetailedProgress,
    message: reanalyzeMessage,
    t,
  });
  const compactReanalyzeProgressMessage = formatTaskProgressMessage({
    type: 'analyze',
    detailedProgress: reanalyzeDetailedProgress,
    message: reanalyzeMessage,
    compact: true,
    t,
  });
  const idleReanalyzeTitle = hasAnalysis
    ? t('history.reanalyzeTooltip', '重新发起分析并覆盖当前结果')
    : t('history.startAnalysisTooltip', '立即开始对评论数据进行AI分析');
  const activeReanalyzeTitle = reanalyzeTaskId
    ? `${reanalyzeProgressMessage} #${reanalyzeTaskId}`
    : reanalyzeProgressMessage;

  if (isFullscreen && viewMode === 'dynamic' && hasDynamicHtml) {
    return (
      <div
        className="flex flex-col h-screen w-screen overflow-hidden"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        <div
          className="p-3 px-6 flex items-center justify-between border-b shadow-sm z-10 flex-shrink-0"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-primary)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={handleExitFullscreen}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border flex items-center gap-1.5 transition-all hover:scale-105"
              style={{
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
                backgroundColor: 'var(--bg-tertiary)',
              }}
              title={t('history.backToHistory', '返回历史列表')}
            >
              <span>←</span>
              <span>{t('history.backToHistory', '返回历史列表')}</span>
            </button>
            <span
              className="font-semibold text-base truncate max-w-xl"
              style={{ color: 'var(--text-primary)' }}
            >
              {selectedItem.title}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {hasAnalysis && (
              <button
                onClick={onGenerateDynamicReport}
                disabled={isGeneratingDynamic || isReanalyzing}
                className="px-3.5 py-1.5 rounded-lg text-white text-sm font-medium flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--accent-secondary)' }}
                title={t('history.regenerateDynamicTooltip', '重新调用AI生成动态网页')}
              >
                <span>{isGeneratingDynamic || isReanalyzing ? '⏳' : '🔄'}</span>
                <span>
                  {isGeneratingDynamic || isReanalyzing
                    ? t('history.generatingDynamicReport', '正在生成动态网页...')
                    : t('history.regenerateDynamicReport', '重新生成网页')}
                </span>
              </button>
            )}
            <button
              onClick={() => exportAnalysisAsHTML(selectedItem)}
              className="px-3.5 py-1.5 rounded-lg text-white text-sm font-medium flex items-center gap-1.5 transition-all hover:scale-105 shadow-sm"
              style={{ background: 'var(--gradient-primary)' }}
              title={t('history.exportHtmlTooltip', '导出独立 HTML 网页文件')}
            >
              <span>💾</span>
              <span>{t('history.exportHtml', '导出 HTML')}</span>
            </button>
          </div>
        </div>

        <div className="flex-1 w-full h-full overflow-hidden">
          <DynamicReportViewer
            title={selectedItem.title || 'Dynamic Analysis Report'}
            html={selectedItem.analysis?.dynamicHtml || ''}
          />
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
            onClick={() => onViewModeChange('dynamic')}
            className={`px-5 py-3 font-medium text-sm transition-all border-b-2 ${
              viewMode === 'dynamic' ? 'border-blue-500 text-blue-500' : 'border-transparent'
            }`}
            style={{
              color: viewMode === 'dynamic' ? undefined : 'var(--text-tertiary)',
            }}
          >
            🌐 {t('history.dynamicReport', '动态看板')}
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
                  className="relative overflow-hidden px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-70 disabled:cursor-not-allowed max-w-[18rem]"
                  style={{ backgroundColor: 'var(--accent-secondary)' }}
                  title={isReanalyzing ? activeReanalyzeTitle : idleReanalyzeTitle}
                >
                  {isReanalyzing && (
                    <span
                      role="progressbar"
                      aria-label={t('popup.taskProgress')}
                      aria-valuemin={UI_LIMITS.PROGRESS_MIN_PERCENT}
                      aria-valuemax={UI_LIMITS.PROGRESS_MAX_PERCENT}
                      aria-valuenow={Math.round(activeReanalyzeProgress)}
                      className="absolute inset-x-0 bottom-0 h-1 bg-white/20"
                    >
                      <span
                        className="block h-full bg-white/70 transition-all duration-300"
                        style={{ width: `${activeReanalyzeProgress}%` }}
                      />
                    </span>
                  )}
                  <span className="relative z-10 flex min-w-0 items-center gap-2">
                    <span>{isReanalyzing ? '⏳' : hasAnalysis ? '🔄' : '✨'}</span>
                    <span className="min-w-0 truncate">
                      {isReanalyzing
                        ? compactReanalyzeProgressMessage
                        : hasAnalysis
                          ? t('history.reanalyze', '重新分析')
                          : t('history.startAnalysis', '开始分析')}
                    </span>
                  </span>
                </button>
                {hasAnalysis && (
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
              {hasAnalysis ? (
                <div
                  className="prose prose-sm md:prose-base dark:prose-invert max-w-none"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedItem.analysis?.markdown ?? ''}
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
        ) : viewMode === 'dynamic' ? (
          <div className="animate-fade-in flex flex-col h-full">
            <div className="mb-4 flex justify-between items-center flex-wrap gap-2">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {t('history.dynamicReport', '动态看板')}
              </h3>
              <div className="flex items-center gap-2">
                {hasAnalysis && (
                  <button
                    onClick={onGenerateDynamicReport}
                    disabled={isGeneratingDynamic || isReanalyzing}
                    className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 transition-all shadow-md disabled:opacity-70 disabled:cursor-not-allowed"
                    style={{ backgroundColor: 'var(--accent-secondary)' }}
                    title={
                      hasDynamicHtml
                        ? t('history.regenerateDynamicTooltip', '重新调用AI生成动态网页')
                        : t('history.generateDynamicTooltip', '调用AI生成动态网页')
                    }
                  >
                    <span>{isGeneratingDynamic ? '⏳' : hasDynamicHtml ? '🔄' : '✨'}</span>
                    <span>
                      {isGeneratingDynamic
                        ? t('history.generatingDynamicReport', '正在生成动态网页...')
                        : hasDynamicHtml
                          ? t('history.regenerateDynamicReport', '重新生成网页')
                          : t('history.generateDynamicReport', '生成动态网页')}
                    </span>
                  </button>
                )}
                {hasDynamicHtml && (
                  <>
                    <button
                      onClick={handleOpenInNewTab}
                      className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 transition-all hover:scale-105 shadow-md"
                      style={{ backgroundColor: '#3b82f6' }}
                      title={t('history.openInNewTabTooltip', '在新标签页全屏查看')}
                    >
                      <span>🖥️</span>
                      <span>{t('history.openInNewTab', '新标签页打开')}</span>
                    </button>
                    <button
                      onClick={() => exportAnalysisAsHTML(selectedItem)}
                      className="px-4 py-2 rounded-lg text-white text-sm font-medium flex items-center gap-2 transition-all hover:scale-105 shadow-md"
                      style={{ background: 'var(--gradient-primary)' }}
                      title={t('history.exportHtmlTooltip', '导出独立 HTML 网页文件')}
                    >
                      <span>💾</span>
                      <span>{t('history.exportHtml', '导出 HTML')}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {generateDynamicError && (
              <div
                className="mb-4 p-3 rounded-lg text-sm"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: 'var(--accent-danger)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                }}
              >
                {generateDynamicError}
              </div>
            )}

            {hasDynamicHtml ? (
              <div
                className="flex-1 w-full rounded-xl overflow-hidden shadow-lg border"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-card)',
                  minHeight: '600px',
                }}
              >
                <DynamicReportViewer
                  title={selectedItem.title || 'Dynamic Analysis Report'}
                  html={selectedItem.analysis?.dynamicHtml || ''}
                  style={{ minHeight: '600px' }}
                />
              </div>
            ) : hasAnalysis ? (
              <div
                className="theme-card p-12 text-center"
                style={{ backgroundColor: 'var(--bg-card)' }}
              >
                <p className="text-5xl mb-4">✨</p>
                <h4 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                  {t('history.noDynamicReportYet', '暂无动态可视化网页')}
                </h4>
                <p className="text-sm max-w-md mx-auto mb-6" style={{ color: 'var(--text-muted)' }}>
                  {t(
                    'history.generateDynamicReportDesc',
                    '当前已包含分析报告。点击下方按钮，AI 将根据分析报告为您生成图形化、动态交互式、响应式展现的单页看板。',
                  )}
                </p>
                <button
                  onClick={onGenerateDynamicReport}
                  disabled={isGeneratingDynamic || isReanalyzing}
                  className="px-6 py-3 rounded-xl text-white font-medium inline-flex items-center gap-2 transition-all hover:scale-105 shadow-lg disabled:opacity-70 disabled:cursor-not-allowed"
                  style={{ background: 'var(--gradient-primary)' }}
                >
                  <span>{isGeneratingDynamic ? '⏳' : '✨'}</span>
                  <span>
                    {isGeneratingDynamic
                      ? t('history.generatingDynamicReport', '正在生成动态网页...')
                      : t('history.generateDynamicReport', '生成动态分析网页')}
                  </span>
                </button>
              </div>
            ) : (
              <div
                className="theme-card p-12 text-center"
                style={{ backgroundColor: 'var(--bg-card)' }}
              >
                <p className="text-5xl mb-3">🔍</p>
                <p style={{ color: 'var(--text-muted)' }}>{t('history.noAnalysis')}</p>
              </div>
            )}
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
              <CommentTree
                key={`${selectedItem.id}-${commentSearchTerm}-${currentPage}`}
                comments={paginatedComments}
              />
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
