import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrentTask } from '../hooks/useTask';
import { TIMING, UI_LIMITS } from '@/config/constants';

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
      const { stage, current, total, stageMessage, stageMessageKey, stageMessageParams } =
        task.detailedProgress;
      const stageLabel = getStageLabel(stage);

      if (stageMessageKey) {
        return `${stageLabel}: ${t(stageMessageKey, stageMessageParams)}`;
      }

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
    if (task.type === 'extract') {
      return t('popup.extracting');
    }
    if (task.type === 'analyze') {
      return t('popup.analyzing');
    }
    return t('popup.generatingConfig');
  };

  const getStatusColor = () => {
    switch (task.status) {
      case 'running':
        return 'var(--accent-primary)';
      case 'completed':
        return 'var(--accent-success)';
      case 'failed':
        return 'var(--accent-danger)';
      default:
        return 'var(--text-muted)';
    }
  };

  const formatTimeRemaining = (seconds: number): string => {
    if (seconds < 0) return '';
    if (seconds < TIMING.SECONDS_PER_MINUTE) return t('popup.timeRemainingSeconds', { seconds });
    const minutes = Math.floor(seconds / TIMING.SECONDS_PER_MINUTE);
    const remainingSeconds = seconds % TIMING.SECONDS_PER_MINUTE;
    if (remainingSeconds === 0) {
      return t('popup.timeRemainingMinutes', { minutes });
    }
    return t('popup.timeRemainingMinutesSeconds', { minutes, seconds: remainingSeconds });
  };

  if (task.status !== 'running' && task.status !== 'pending') {
    return null;
  }

  const estimatedTime = task.detailedProgress?.estimatedTimeRemaining ?? -1;
  const taskLabel =
    task.type === 'extract'
      ? t('popup.extracting')
      : task.type === 'analyze'
        ? t('popup.analyzing')
        : t('popup.generatingConfig');

  return (
    <div
      className="p-3.5 rounded-xl"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-primary)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="animate-spin rounded-full h-4 w-4 border-2 border-t-transparent"
          style={{
            borderColor: 'var(--accent-primary)',
            borderTopColor: 'transparent',
          }}
        />
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {taskLabel}
        </span>
      </div>
      <div className="text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {getProgressMessage()}
      </div>
      {estimatedTime > 0 && (
        <div className="text-xs mb-2 tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
          {t('popup.estimatedTime')}: {formatTimeRemaining(estimatedTime)}
        </div>
      )}
      <div
        className="w-full rounded-full h-1.5 overflow-hidden"
        style={{ backgroundColor: 'var(--bg-tertiary)' }}
      >
        <div
          className="h-1.5 rounded-full transition-all duration-300"
          style={{
            width: `${Math.max(task.progress, UI_LIMITS.MIN_PROGRESS_WIDTH_PERCENT)}%`,
            backgroundColor: getStatusColor(),
          }}
        />
      </div>
    </div>
  );
};
