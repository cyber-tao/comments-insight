import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrentTask } from '../hooks/useTask';

interface TaskProgressProps {
  task: CurrentTask;
}

export const TaskProgress: React.FC<TaskProgressProps> = ({ task }) => {
  const { t } = useTranslation();

  const getStageLabel = (stage: string): string => {
    const stageKeys: Record<string, string> = {
      initializing: 'popup.progressInitializing',
      detecting: 'popup.progressDetecting',
      analyzing: 'popup.progressAnalyzing',
      extracting: 'popup.progressExtracting',
      scrolling: 'popup.progressScrolling',
      expanding: 'popup.progressExpanding',
      validating: 'popup.progressValidating',
      complete: 'popup.progressComplete',
    };
    const key = stageKeys[stage] || 'popup.extracting';
    return t(key);
  };

  const getProgressMessage = () => {
    // Use detailed progress if available
    if (task.detailedProgress) {
      const { stage, current, total, stageMessage } = task.detailedProgress;
      const stageLabel = getStageLabel(stage);

      if (stageMessage) {
        return `${stageLabel}: ${stageMessage}`;
      }

      if (total > 0 && current >= 0) {
        return `${stageLabel} (${current}/${total})`;
      }

      return stageLabel;
    }

    // Fallback to legacy message parsing
    const msg = task.message || '';
    const parts = msg.split(':');
    if (parts.length >= 3) {
      const [stage, count, max] = parts;
      const stageLabel = getStageLabel(stage);
      const countNum = parseInt(count, 10);
      return countNum >= 0 ? `${stageLabel} ${count}/${max}` : stageLabel;
    }
    return task.type === 'extract' ? t('popup.extracting') : t('popup.analyzing');
  };

  const getStatusColor = () => {
    switch (task.status) {
      case 'running':
        return 'bg-blue-500';
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const formatTimeRemaining = (seconds: number): string => {
    if (seconds < 0) return '';
    if (seconds < 60) return t('popup.timeRemainingSeconds', { seconds });
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return t('popup.timeRemainingMinutes', { minutes });
    }
    return t('popup.timeRemainingMinutesSeconds', { minutes, seconds: remainingSeconds });
  };

  if (task.status !== 'running' && task.status !== 'pending') {
    return null;
  }

  const estimatedTime = task.detailedProgress?.estimatedTimeRemaining ?? -1;

  return (
    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
        <span className="text-sm font-medium text-blue-700">
          {task.type === 'extract' ? t('popup.extracting') : t('popup.analyzing')}
        </span>
      </div>
      <div className="text-xs text-blue-600 mb-2">{getProgressMessage()}</div>
      {estimatedTime > 0 && (
        <div className="text-xs text-blue-500 mb-2">
          {t('popup.estimatedTime')}: {formatTimeRemaining(estimatedTime)}
        </div>
      )}
      <div className="w-full bg-blue-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${getStatusColor()}`}
          style={{ width: `${Math.max(task.progress, 5)}%` }}
        ></div>
      </div>
    </div>
  );
};
