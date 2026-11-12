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
import {
  AlertTriangleIcon,
  CommentsIcon,
  DownloadIcon,
  GlobeIcon,
  InteractiveIcon,
  RefreshIcon,
  ReportIcon,
  SearchIcon,
  SparklesIcon,
} from '@/components/Icons';
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
          <div className="flex flex-col items-center gap-3 text-center">
            <div
              className="h-7 w-7 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }}
            />
            <p className="text-base font-medium">{t('common.loading')}</p>
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
            <div
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
              style={{
                backgroundColor: 'var(--accent-danger-soft)',
                color: 'var(--accent-danger)',
              }}
            >
              <AlertTriangleIcon size={24} />
            </div>
            <p className="text-base font-semibold mb-2" style={{ color: 'var(--accent-danger)' }}>
              {selectedItemError}
            </p>
            <p className="text-sm">{t('history.selectItem')}</p>
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
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-primary)',
              color: 'var(--text-tertiary)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <ReportIcon size={26} />
          </div>
          <p className="text-base font-medium" style={{ color: 'var(--text-secondary)' }}>
            {t('history.selectItem')}
          </p>
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
    ? t('history.reanalyzeTooltip')
    : t('history.startAnalysisTooltip');
  const activeReanalyzeTitle = reanalyzeTaskId
    ? `${reanalyzeProgressMessage} #${reanalyzeTaskId}`
    : reanalyzeProgressMessage;
  const dynamicErrorAlert = generateDynamicError ? (
    <div
      role="alert"
      className="mb-4 p-3 rounded-lg text-sm"
      style={{
        backgroundColor: 'var(--accent-danger-soft)',
        color: 'var(--accent-danger)',
        border: '1px solid rgba(220, 38, 38, 0.25)',
      }}
    >
      {generateDynamicError}
    </div>
  ) : null;

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
              className="theme-button-secondary px-3 py-1.5 text-sm flex items-center gap-1.5"
              title={t('history.backToHistory')}
            >
              <span>←</span>
              <span>{t('history.backToHistory')}</span>
            </button>
            <span
              className="font-semibold text-base truncate max-w-xl font-serif-editorial"
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
                className="theme-button-secondary px-3.5 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                title={t('history.regenerateDynamicTooltip')}
              >
                <RefreshIcon
                  size={15}
                  className={isGeneratingDynamic || isReanalyzing ? 'animate-spin' : ''}
                />
                <span>
                  {isGeneratingDynamic || isReanalyzing
                    ? t('history.generatingDynamicReport')
                    : t('history.regenerateDynamicReport')}
                </span>
              </button>
            )}
            <button
              onClick={() => exportAnalysisAsHTML(selectedItem)}
              className="theme-button-primary px-3.5 py-1.5 text-sm flex items-center gap-1.5"
              title={t('history.exportHtmlTooltip')}
            >
              <DownloadIcon size={15} />
              <span>{t('history.exportHtml')}</span>
            </button>
          </div>
        </div>

        {dynamicErrorAlert}

        <div className="flex-1 w-full h-full overflow-hidden">
          <DynamicReportViewer
            title={selectedItem.title}
            html={selectedItem.analysis?.dynamicHtml || ''}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="px-6 py-5"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-primary)',
        }}
      >
        <div className="mb-2.5">
          <a
            href={selectedItem.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xl font-bold font-serif-editorial leading-snug theme-link hover:underline"
          >
            {selectedItem.title}
          </a>
        </div>
        <div
          className="flex flex-wrap items-center gap-3 text-xs tabular-nums"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono-code font-medium"
            style={{
              backgroundColor: 'var(--accent-primary-soft)',
              color: 'var(--accent-primary)',
            }}
          >
            <GlobeIcon size={12} />
            {selectedItem.platform}
          </span>
          <span
            className="inline-flex items-center gap-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {formatDate(selectedItem.extractedAt)}
          </span>
          <span
            className="inline-flex items-center gap-1 font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            <CommentsIcon size={13} />
            {t('history.commentsWithCount', { count: selectedItem.commentsCount })}
          </span>
        </div>
        {selectedItem.postContent && (
          <details className="mt-3.5 text-sm group">
            <summary
              className="cursor-pointer font-medium inline-flex items-center gap-1.5 select-none"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ReportIcon size={14} />
              <span>{t('history.postContent')}</span>
            </summary>
            <div
              className="mt-2 p-3.5 rounded-lg whitespace-pre-wrap text-xs leading-relaxed"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-primary)',
              }}
            >
              {selectedItem.postContent}
            </div>
          </details>
        )}
      </div>

      <div
        className="px-6 py-2.5"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderBottom: '1px solid var(--border-primary)',
        }}
      >
        <div
          className="inline-flex p-1 rounded-lg gap-1"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <button
            onClick={() => onViewModeChange('analysis')}
            className="px-4 py-1.5 rounded-md font-medium text-xs transition-all inline-flex items-center gap-1.5"
            style={{
              backgroundColor: viewMode === 'analysis' ? 'var(--bg-card)' : 'transparent',
              color: viewMode === 'analysis' ? 'var(--accent-primary)' : 'var(--text-tertiary)',
              boxShadow: viewMode === 'analysis' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <ReportIcon size={14} />
            <span>{t('history.analysis')}</span>
          </button>
          <button
            onClick={() => onViewModeChange('dynamic')}
            className="px-4 py-1.5 rounded-md font-medium text-xs transition-all inline-flex items-center gap-1.5"
            style={{
              backgroundColor: viewMode === 'dynamic' ? 'var(--bg-card)' : 'transparent',
              color: viewMode === 'dynamic' ? 'var(--accent-primary)' : 'var(--text-tertiary)',
              boxShadow: viewMode === 'dynamic' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <InteractiveIcon size={14} />
            <span>{t('history.dynamicReport')}</span>
          </button>
          <button
            onClick={() => onViewModeChange('comments')}
            className="px-4 py-1.5 rounded-md font-medium text-xs transition-all inline-flex items-center gap-1.5"
            style={{
              backgroundColor: viewMode === 'comments' ? 'var(--bg-card)' : 'transparent',
              color: viewMode === 'comments' ? 'var(--accent-primary)' : 'var(--text-tertiary)',
              boxShadow: viewMode === 'comments' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <CommentsIcon size={14} />
            <span>{t('history.comments')}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {viewMode === 'analysis' ? (
          <div className="animate-fade-in max-w-4xl mx-auto">
            <div className="mb-5 flex justify-between items-center gap-3 flex-wrap">
              <h3
                className="text-lg font-bold font-serif-editorial"
                style={{ color: 'var(--text-primary)' }}
              >
                {t('history.analysis')}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={onReanalyze}
                  disabled={isReanalyzing}
                  className="relative overflow-hidden theme-button-secondary px-3.5 py-2 text-xs flex items-center justify-center gap-1.5 disabled:opacity-70 disabled:cursor-not-allowed max-w-[18rem]"
                  title={isReanalyzing ? activeReanalyzeTitle : idleReanalyzeTitle}
                >
                  {isReanalyzing && (
                    <span
                      role="progressbar"
                      aria-label={t('popup.taskProgress')}
                      aria-valuemin={UI_LIMITS.PROGRESS_MIN_PERCENT}
                      aria-valuemax={UI_LIMITS.PROGRESS_MAX_PERCENT}
                      aria-valuenow={Math.round(activeReanalyzeProgress)}
                      className="absolute inset-x-0 bottom-0 h-1 bg-black/10"
                    >
                      <span
                        className="block h-full transition-all duration-300"
                        style={{
                          width: `${activeReanalyzeProgress}%`,
                          backgroundColor: 'var(--accent-primary)',
                        }}
                      />
                    </span>
                  )}
                  <span className="relative z-10 flex min-w-0 items-center gap-1.5">
                    {isReanalyzing ? (
                      <RefreshIcon size={14} className="animate-spin" />
                    ) : hasAnalysis ? (
                      <RefreshIcon size={14} />
                    ) : (
                      <SparklesIcon size={14} />
                    )}
                    <span className="min-w-0 truncate">
                      {isReanalyzing
                        ? compactReanalyzeProgressMessage
                        : hasAnalysis
                          ? t('history.reanalyze')
                          : t('history.startAnalysis')}
                    </span>
                  </span>
                </button>
                {hasAnalysis && (
                  <button
                    onClick={() =>
                      exportAnalysisAsMarkdown(selectedItem, exportPostContentInMarkdown)
                    }
                    className="theme-button-primary px-3.5 py-2 text-xs flex items-center gap-1.5"
                    title={t('history.exportMarkdownTooltip')}
                  >
                    <DownloadIcon size={14} />
                    <span>{t('history.exportMarkdown')}</span>
                  </button>
                )}
              </div>
            </div>
            {reanalyzeError &&
              (!reanalyzingHistoryId || reanalyzingHistoryId === selectedItem.id) && (
                <div
                  role="alert"
                  className="mb-4 p-3 rounded-lg text-sm"
                  style={{
                    backgroundColor: 'var(--accent-danger-soft)',
                    color: 'var(--accent-danger)',
                    border: '1px solid rgba(220, 38, 38, 0.25)',
                  }}
                >
                  {reanalyzeError}
                </div>
              )}

            <div
              className="theme-card p-6 md:p-8"
              style={{
                backgroundColor: 'var(--bg-card)',
              }}
            >
              {hasAnalysis ? (
                <div
                  className="prose prose-sm md:prose-base dark:prose-invert max-w-none"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{ img: ({ alt }) => (alt ? <span>{alt}</span> : null) }}
                  >
                    {selectedItem.analysis?.markdown ?? ''}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                  <div
                    className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    <SearchIcon size={20} />
                  </div>
                  <p className="text-sm">{t('history.noAnalysis')}</p>
                </div>
              )}
            </div>
          </div>
        ) : viewMode === 'dynamic' ? (
          <div className="animate-fade-in flex flex-col h-full">
            <div className="mb-4 flex justify-between items-center flex-wrap gap-2">
              <h3
                className="text-lg font-bold font-serif-editorial"
                style={{ color: 'var(--text-primary)' }}
              >
                {t('history.dynamicReport')}
              </h3>
              <div className="flex items-center gap-2">
                {hasAnalysis && (
                  <button
                    onClick={onGenerateDynamicReport}
                    disabled={isGeneratingDynamic || isReanalyzing}
                    className="theme-button-secondary px-3.5 py-2 text-xs flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                    title={
                      hasDynamicHtml
                        ? t('history.regenerateDynamicTooltip')
                        : t('history.generateDynamicTooltip')
                    }
                  >
                    {isGeneratingDynamic ? (
                      <RefreshIcon size={14} className="animate-spin" />
                    ) : hasDynamicHtml ? (
                      <RefreshIcon size={14} />
                    ) : (
                      <SparklesIcon size={14} />
                    )}
                    <span>
                      {isGeneratingDynamic
                        ? t('history.generatingDynamicReport')
                        : hasDynamicHtml
                          ? t('history.regenerateDynamicReport')
                          : t('history.generateDynamicReport')}
                    </span>
                  </button>
                )}
                {hasDynamicHtml && (
                  <>
                    <button
                      onClick={handleOpenInNewTab}
                      className="theme-button-secondary px-3.5 py-2 text-xs flex items-center gap-1.5"
                      title={t('history.openInNewTabTooltip')}
                    >
                      <InteractiveIcon size={14} />
                      <span>{t('history.openInNewTab')}</span>
                    </button>
                    <button
                      onClick={() => exportAnalysisAsHTML(selectedItem)}
                      className="theme-button-primary px-3.5 py-2 text-xs flex items-center gap-1.5"
                      title={t('history.exportHtmlTooltip')}
                    >
                      <DownloadIcon size={14} />
                      <span>{t('history.exportHtml')}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {dynamicErrorAlert}

            {hasDynamicHtml ? (
              <div
                className="flex-1 w-full rounded-xl overflow-hidden shadow-md border"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-card)',
                  minHeight: '600px',
                }}
              >
                <DynamicReportViewer
                  title={selectedItem.title}
                  html={selectedItem.analysis?.dynamicHtml || ''}
                  style={{ minHeight: '600px' }}
                />
              </div>
            ) : hasAnalysis ? (
              <div
                className="theme-card p-12 text-center"
                style={{ backgroundColor: 'var(--bg-card)' }}
              >
                <div
                  className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: 'var(--accent-primary-soft)',
                    color: 'var(--accent-primary)',
                  }}
                >
                  <SparklesIcon size={22} />
                </div>
                <h4 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                  {t('history.noDynamicReportYet')}
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
                  className="theme-button-primary px-5 py-2.5 text-sm inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isGeneratingDynamic ? (
                    <RefreshIcon size={16} className="animate-spin" />
                  ) : (
                    <SparklesIcon size={16} />
                  )}
                  <span>
                    {isGeneratingDynamic
                      ? t('history.generatingDynamicReport')
                      : t('history.generateDynamicReport')}
                  </span>
                </button>
              </div>
            ) : (
              <div
                className="theme-card p-12 text-center"
                style={{ backgroundColor: 'var(--bg-card)' }}
              >
                <div
                  className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  <SearchIcon size={20} />
                </div>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('history.noAnalysis')}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="animate-fade-in max-w-4xl mx-auto">
            <div className="mb-5 flex justify-between items-center">
              <h3
                className="text-lg font-bold font-serif-editorial tabular-nums"
                style={{ color: 'var(--text-primary)' }}
              >
                {t('history.allComments')} ({selectedItem.comments.length})
              </h3>
              <button
                onClick={() => exportCommentsAsCSV(selectedItem.comments, selectedItem.title)}
                className="theme-button-primary px-3.5 py-2 text-xs flex items-center gap-1.5"
                title={t('history.exportCsvTooltip')}
              >
                <DownloadIcon size={14} />
                <span>{t('history.exportCsv')}</span>
              </button>
            </div>

            <div
              className="mb-5 p-4 rounded-xl"
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-primary)',
              }}
            >
              <div className="flex gap-4 items-center flex-wrap">
                <div className="flex-1 min-w-64">
                  <input
                    type="text"
                    value={commentSearchTerm}
                    onChange={(e) => onCommentSearchTermChange(e.target.value)}
                    placeholder={t('history.searchComments')}
                    className="w-full text-sm theme-input"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    {t('history.sortBy')}:
                  </label>
                  <select
                    value={sortBy}
                    onChange={(e) => onSortByChange(e.target.value as 'time' | 'likes' | 'replies')}
                    className="theme-input text-xs py-1.5"
                  >
                    <option value="time">{t('history.sortByTime')}</option>
                    <option value="likes">{t('history.sortByLikes')}</option>
                    <option value="replies">{t('history.sortByReplies')}</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    {t('history.commentsPerPage')}:
                  </label>
                  <select
                    value={commentsPerPage}
                    onChange={(e) => onCommentsPerPageChange(Number(e.target.value))}
                    className="theme-input text-xs py-1.5 tabular-nums"
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
                <div className="mt-3 text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {t('history.searchResults', {
                    count: totalComments,
                    total: selectedItem.comments.length,
                  })}
                </div>
              )}
            </div>

            {totalPages > 1 && (
              <div
                className="mb-5 flex justify-between items-center p-3.5 rounded-xl"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                <div className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
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
                    className="theme-button-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    ← {t('common.previous')}
                  </button>
                  <span
                    className="px-3 py-1 text-xs font-mono-code font-semibold tabular-nums"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => onCurrentPageChange((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                    className="theme-button-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {t('common.next')} →
                  </button>
                </div>
              </div>
            )}

            {totalComments === 0 ? (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                <div
                  className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: 'var(--bg-tertiary)',
                    color: 'var(--text-tertiary)',
                  }}
                >
                  <SearchIcon size={20} />
                </div>
                <p className="text-sm">
                  {commentSearchTerm ? t('history.noCommentsFound') : t('history.noComments')}
                </p>
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
                  className="flex gap-2 items-center p-2.5 rounded-xl"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-primary)',
                  }}
                >
                  <button
                    onClick={() => onCurrentPageChange((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                    className="theme-button-secondary px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    ← {t('common.previous')}
                  </button>
                  <span
                    className="px-3 py-1 text-xs font-mono-code font-semibold tabular-nums"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => onCurrentPageChange((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                    className="theme-button-secondary px-3 py-1.5 text-xs disabled:opacity-50"
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
