import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TIMING } from '@/config/constants';
import { HistoryItem } from '@/types';
import { ExtensionAPI } from '@/utils/extension-api';
import { Logger } from '@/utils/logger';

interface UseHistoryReanalyzeOptions {
  selectedItem: HistoryItem | null;
  fetchHistoryItemById: (id: string, options?: { force?: boolean }) => Promise<HistoryItem | null>;
  setSelectedItem: React.Dispatch<React.SetStateAction<HistoryItem | null>>;
}

export function useHistoryReanalyze({
  selectedItem,
  fetchHistoryItemById,
  setSelectedItem,
}: UseHistoryReanalyzeOptions) {
  const { t } = useTranslation();
  const [reanalyzeTaskId, setReanalyzeTaskId] = useState<string | null>(null);
  const [reanalyzingHistoryId, setReanalyzingHistoryId] = useState<string | null>(null);
  const [reanalyzeProgress, setReanalyzeProgress] = useState<number | null>(null);
  const [reanalyzeError, setReanalyzeError] = useState('');
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef(false);

  const clearPollTimeout = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const resetReanalyzeState = useCallback(() => {
    setIsReanalyzing(false);
    setReanalyzeTaskId(null);
    setReanalyzingHistoryId(null);
    setReanalyzeProgress(null);
  }, []);

  const clearReanalyzeError = useCallback(() => {
    setReanalyzeError('');
  }, []);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      clearPollTimeout();
    };
  }, [clearPollTimeout]);

  const monitorReanalyzeTask = useCallback(
    (taskId: string, historyId: string) => {
      clearPollTimeout();

      const pollTaskStatus = async () => {
        if (isUnmountedRef.current) {
          return;
        }

        try {
          const task = await ExtensionAPI.getTaskStatus(taskId);
          if (!task) {
            throw new Error(t('history.reanalyzeTaskMissing', '分析任务不存在或已结束'));
          }

          if (task.status === 'running' || task.status === 'pending') {
            setReanalyzeProgress(typeof task.progress === 'number' ? task.progress : 0);
            pollTimeoutRef.current = setTimeout(() => {
              void pollTaskStatus();
            }, TIMING.POLL_TASK_RUNNING_MS);
            return;
          }

          if (task.status === 'completed') {
            const refreshed = await fetchHistoryItemById(historyId, { force: true });
            if (!isUnmountedRef.current) {
              setSelectedItem((current) => (current?.id === historyId ? refreshed : current));
            }

            resetReanalyzeState();
            clearPollTimeout();
            return;
          }

          setReanalyzeError(task.error || t('history.reanalyzeFailed', '重新分析失败'));
          resetReanalyzeState();
          clearPollTimeout();
        } catch (error) {
          Logger.error('[History] Failed to monitor reanalyze task', { taskId, error });
          if (!isUnmountedRef.current) {
            setReanalyzeError(
              error instanceof Error ? error.message : t('history.reanalyzeFailed', '重新分析失败'),
            );
            resetReanalyzeState();
          }
          clearPollTimeout();
        }
      };

      void pollTaskStatus();
    },
    [clearPollTimeout, fetchHistoryItemById, resetReanalyzeState, setSelectedItem, t],
  );

  const handleReanalyze = useCallback(async () => {
    if (!selectedItem || isReanalyzing) {
      return;
    }

    setReanalyzeError('');
    setIsReanalyzing(true);
    setReanalyzeProgress(0);
    setReanalyzingHistoryId(selectedItem.id);

    try {
      const response = await ExtensionAPI.startAnalysis({
        comments: selectedItem.comments,
        historyId: selectedItem.id,
        metadata: {
          platform: selectedItem.platform,
          url: selectedItem.url,
          title: selectedItem.title,
          videoTime: selectedItem.videoTime,
          postContent: selectedItem.postContent,
        },
      });

      if (!response?.taskId) {
        throw new Error(t('history.reanalyzeStartFailed', '启动重新分析失败'));
      }

      setReanalyzeTaskId(response.taskId);
      monitorReanalyzeTask(response.taskId, selectedItem.id);
    } catch (error) {
      Logger.error('[History] Failed to start reanalyze', { error });
      setReanalyzeError(
        error instanceof Error ? error.message : t('history.reanalyzeFailed', '重新分析失败'),
      );
      resetReanalyzeState();
    }
  }, [isReanalyzing, monitorReanalyzeTask, resetReanalyzeState, selectedItem, t]);

  return {
    clearReanalyzeError,
    handleReanalyze,
    isReanalyzing,
    reanalyzeError,
    reanalyzeProgress,
    reanalyzeTaskId,
    reanalyzingHistoryId,
  };
}
