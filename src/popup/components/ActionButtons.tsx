import * as React from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { NOTIFICATION_KEYS, UI_LIMITS } from '@/config/constants';
import { formatTaskProgressMessage } from '@/utils/task-progress-display';
import { CommentsIcon, DownloadIcon, HistoryIcon, SparklesIcon, XIcon } from '@/components/Icons';
import { NavigationService } from '../utils/navigation';
import type { PageInfo, PageStatus } from '../hooks/usePageInfo';
import type { CurrentTask } from '../hooks/useTask';

interface ActionButtonsProps {
  pageInfo: PageInfo | null;
  pageStatus: PageStatus;
  currentTask: CurrentTask | null;
  onExtract: () => void;
  onGenerateConfig: () => void;
  onAnalyze: () => void;
  onCancel: (taskId: string) => void;
  onOpenHistory: () => void;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  pageInfo,
  pageStatus,
  currentTask,
  onExtract,
  onGenerateConfig,
  onAnalyze,
  onCancel,
  onOpenHistory,
}) => {
  const { t } = useTranslation();

  const { isConfigActive, isAnalyzeActive, isExtractionFlowActive } = useMemo(() => {
    const isTaskActive = (type: 'extract' | 'config' | 'analyze') =>
      currentTask?.type === type &&
      (currentTask?.status === 'running' || currentTask?.status === 'pending');
    const extractActive = isTaskActive('extract');
    const configActive = isTaskActive('config');
    const analyzeActive = isTaskActive('analyze');
    return {
      isConfigActive: configActive,
      isAnalyzeActive: analyzeActive,
      isExtractionFlowActive: extractActive || configActive,
    };
  }, [currentTask]);

  const { progressMessage, compactProgressMessage } = useMemo(() => {
    return {
      progressMessage: formatTaskProgressMessage({
        type: currentTask?.type,
        detailedProgress: currentTask?.detailedProgress,
        message: currentTask?.message,
        t,
      }),
      compactProgressMessage: formatTaskProgressMessage({
        type: currentTask?.type,
        detailedProgress: currentTask?.detailedProgress,
        message: currentTask?.message,
        compact: true,
        t,
      }),
    };
  }, [currentTask, t]);

  const activeProgress = currentTask
    ? Math.min(
        UI_LIMITS.PROGRESS_MAX_PERCENT,
        Math.max(UI_LIMITS.PROGRESS_MIN_PERCENT, currentTask.progress),
      )
    : UI_LIMITS.PROGRESS_MIN_PERCENT;

  let analysisError: string | undefined;
  if (currentTask?.type === 'analyze') {
    if (currentTask.status === 'failed') {
      analysisError = t(NOTIFICATION_KEYS.ANALYSIS_FAILED, {
        error: currentTask.message || t('errors.unknownError'),
      });
    } else if (currentTask.status === 'unavailable') {
      analysisError = currentTask.message;
    }
  }

  const renderProgressBar = () => (
    <span
      role="progressbar"
      aria-label={t('popup.taskProgress')}
      aria-valuemin={UI_LIMITS.PROGRESS_MIN_PERCENT}
      aria-valuemax={UI_LIMITS.PROGRESS_MAX_PERCENT}
      aria-valuenow={Math.round(activeProgress)}
      className="absolute bottom-0 left-0 h-1 transition-all duration-300"
      style={{
        width: `${activeProgress}%`,
        backgroundColor: 'var(--accent-primary)',
      }}
    />
  );

  const handleExtractClick = () => {
    if (pageStatus.extracted && pageStatus.historyId) {
      NavigationService.openHistoryPage(pageStatus.historyId, 'comments');
    } else if (!pageStatus.hasConfig) {
      onGenerateConfig();
    } else {
      onExtract();
    }
  };

  const handleAnalyzeClick = () => {
    if (pageStatus.analyzed && pageStatus.historyId) {
      NavigationService.openHistoryPage(pageStatus.historyId, 'analysis');
    } else {
      onAnalyze();
    }
  };

  return (
    <div className="p-4 space-y-2.5">
      {/* Extract Comments button */}
      {pageInfo && (
        <div className="flex gap-2">
          <button
            onClick={handleExtractClick}
            disabled={isExtractionFlowActive}
            aria-disabled={isExtractionFlowActive}
            title={isExtractionFlowActive ? t('popup.disabledTaskInProgress') : undefined}
            className={`relative overflow-hidden flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              isExtractionFlowActive
                ? 'cursor-not-allowed'
                : pageStatus.extracted
                  ? 'theme-button-secondary'
                  : 'theme-button-primary'
            }`}
            style={
              isExtractionFlowActive
                ? {
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-secondary)',
                  }
                : undefined
            }
          >
            {isExtractionFlowActive ? (
              <>
                {renderProgressBar()}
                <span className="relative z-10 flex items-center justify-center gap-2 min-w-0">
                  <span
                    className="animate-spin rounded-full h-4 w-4 border-2 border-t-transparent"
                    style={{
                      borderColor: 'var(--accent-primary)',
                      borderTopColor: 'transparent',
                    }}
                  />
                  <span className="truncate max-w-[190px]" title={progressMessage}>
                    {isConfigActive ? t('popup.generatingConfig') : compactProgressMessage}
                  </span>
                </span>
              </>
            ) : pageStatus.extracted ? (
              <>
                <CommentsIcon size={16} />
                {t('popup.viewComments')}
              </>
            ) : !pageStatus.hasConfig ? (
              <>
                <SparklesIcon size={16} />
                {t('popup.generateConfig', 'Generate Config')}
              </>
            ) : (
              <>
                <DownloadIcon size={16} />
                {t('popup.extractComments')}
              </>
            )}
          </button>
          {isExtractionFlowActive && currentTask && (
            <button
              onClick={() => onCancel(currentTask.id)}
              className="theme-button-danger px-3 py-2.5 flex items-center justify-center"
              aria-label={t('task.cancel')}
              title={t('task.cancel')}
            >
              <XIcon size={16} />
            </button>
          )}
        </div>
      )}

      {/* Analyze Comments button */}
      <div className="flex gap-2">
        <button
          onClick={handleAnalyzeClick}
          disabled={!pageStatus.extracted || isAnalyzeActive}
          aria-disabled={!pageStatus.extracted || isAnalyzeActive}
          title={
            !pageStatus.extracted
              ? t('popup.disabledNotExtracted')
              : isAnalyzeActive
                ? t('popup.disabledTaskInProgress')
                : undefined
          }
          className={`relative overflow-hidden flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
            !pageStatus.extracted
              ? 'cursor-not-allowed opacity-60'
              : isAnalyzeActive
                ? 'cursor-not-allowed'
                : 'theme-button-accent'
          }`}
          style={
            !pageStatus.extracted
              ? {
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-primary)',
                }
              : isAnalyzeActive
                ? {
                    backgroundColor: 'var(--bg-card)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-secondary)',
                  }
                : undefined
          }
        >
          {isAnalyzeActive ? (
            <>
              {renderProgressBar()}
              <span className="relative z-10 flex items-center justify-center gap-2 min-w-0">
                <span
                  className="animate-spin rounded-full h-4 w-4 border-2 border-t-transparent"
                  style={{
                    borderColor: 'var(--accent-primary)',
                    borderTopColor: 'transparent',
                  }}
                />
                <span className="truncate max-w-[190px]" title={progressMessage}>
                  {compactProgressMessage}
                </span>
              </span>
            </>
          ) : pageStatus.analyzed ? (
            <>
              <SparklesIcon size={16} />
              {t('popup.viewAnalysis')}
            </>
          ) : (
            <>
              <SparklesIcon size={16} />
              {t('popup.analyzeComments')}
            </>
          )}
        </button>
        {isAnalyzeActive && currentTask && (
          <button
            onClick={() => onCancel(currentTask.id)}
            className="theme-button-danger px-3 py-2.5 flex items-center justify-center"
            aria-label={t('task.cancel')}
            title={t('task.cancel')}
          >
            <XIcon size={16} />
          </button>
        )}
      </div>

      {analysisError && (
        <div
          role="alert"
          className="break-words rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{
            backgroundColor: 'var(--accent-danger-soft)',
            border: '1px solid rgba(220, 38, 38, 0.28)',
            color: 'var(--accent-danger)',
          }}
        >
          {analysisError}
        </div>
      )}

      {/* View History button */}
      <button
        onClick={onOpenHistory}
        className="w-full py-2.5 px-4 text-sm theme-button-secondary flex items-center justify-center gap-2"
      >
        <HistoryIcon size={16} />
        {t('popup.viewHistory')}
      </button>
    </div>
  );
};
