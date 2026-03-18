import * as React from 'react';
import { useTranslation } from 'react-i18next';
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

  const getProgressMessage = () => {
    if (currentTask?.detailedProgress) {
      const { stage, current, total, stageMessage } = currentTask.detailedProgress;
      const stageKey = `popup.progress${stage.charAt(0).toUpperCase() + stage.slice(1)}`;
      const stageText = t(stageKey, stageMessage || stage);
      return current >= 0 && total > 0 ? `${stageText} ${current}/${total}` : stageText;
    }

    const msg = currentTask?.message || '';
    const parts = msg.split(':');
    if (parts.length >= 3) {
      const [stage, count, max] = parts;
      const stageKey = `popup.progress${stage.charAt(0).toUpperCase() + stage.slice(1)}`;
      const stageText = t(stageKey);
      const countNum = parseInt(count, 10);
      return countNum >= 0 ? `${stageText} ${count}/${max}` : stageText;
    }
    return currentTask?.type === 'config' ? t('popup.generatingConfig') : t('popup.extracting');
  };

  const isTaskActive = (type: CurrentTask['type']) =>
    currentTask?.type === type &&
    (currentTask?.status === 'running' || currentTask?.status === 'pending');
  const isExtractActive = isTaskActive('extract');
  const isConfigActive = isTaskActive('config');
  const isAnalyzeActive = isTaskActive('analyze');
  const isExtractionFlowActive = isExtractActive || isConfigActive;

  return (
    <div className="p-4 space-y-3">
      {/* Extract Comments button */}
      {pageInfo && (
        <div className="flex gap-2">
          <button
            onClick={handleExtractClick}
            disabled={isExtractionFlowActive}
            className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 ${
              isExtractionFlowActive
                ? 'cursor-not-allowed opacity-70'
                : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700'
            }`}
            style={
              isExtractionFlowActive
                ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }
                : {}
            }
          >
            {isExtractionFlowActive ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                <span className="truncate max-w-[180px]">
                  {isConfigActive ? t('popup.generatingConfig') : getProgressMessage()}
                </span>
              </>
            ) : pageStatus.extracted ? (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                  />
                </svg>
                {t('popup.viewComments')}
              </>
            ) : !pageStatus.hasConfig ? (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                  />
                </svg>
                {t('popup.generateConfig', 'Generate Config')}
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                  />
                </svg>
                {t('popup.extractComments')}
              </>
            )}
          </button>
          {isExtractionFlowActive && currentTask && (
            <button
              onClick={() => onCancel(currentTask.id)}
              className="px-3 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors shadow-md flex items-center justify-center"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Analyze Comments button */}
      <div className="flex gap-2">
        <button
          onClick={handleAnalyzeClick}
          disabled={!pageStatus.extracted || isAnalyzeActive}
          className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 ${
            !pageStatus.extracted || isAnalyzeActive
              ? 'cursor-not-allowed opacity-70'
              : 'bg-gradient-to-r from-purple-500 to-purple-600 text-white hover:from-purple-600 hover:to-purple-700'
          }`}
          style={
            !pageStatus.extracted || isAnalyzeActive
              ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }
              : {}
          }
        >
          {isAnalyzeActive ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
              {t('popup.analyzing')}
            </>
          ) : pageStatus.analyzed ? (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              {t('popup.viewAnalysis')}
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              {t('popup.analyzeComments')}
            </>
          )}
        </button>
        {isAnalyzeActive && currentTask && (
          <button
            onClick={() => onCancel(currentTask.id)}
            className="px-3 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors shadow-md flex items-center justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* View History button */}
      <button
        onClick={onOpenHistory}
        className="w-full py-3 px-4 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg font-medium hover:from-green-600 hover:to-green-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        {t('popup.viewHistory')}
      </button>
    </div>
  );
};
