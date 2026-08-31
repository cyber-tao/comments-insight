import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RETRY, TIMING } from '@/config/constants';
import { type HistoryItem, type TaskProgress } from '@/types';
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
  const [reanalyzeDetailedProgress, setReanalyzeDetailedProgress] = useState<TaskProgress | null>(
    null,
  );
  const [reanalyzeMessage, setReanalyzeMessage] = useState<string | null>(null);
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
    setReanalyzeDetailedProgress(null);
    setReanalyzeMessage(null);
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

      let consecutiveErrors = 0;
      const pollTaskStatus = async () => {
        if (isUnmountedRef.current) {
          return;
        }

        try {
          const task = await ExtensionAPI.getTaskStatus(taskId);
          consecutiveErrors = 0;
          if (!task) {
            throw new Error(t('history.reanalyzeTaskMissing'));
          }

          if (task.status === 'running' || task.status === 'pending') {
            setReanalyzeProgress(typeof task.progress === 'number' ? task.progress : 0);
            setReanalyzeDetailedProgress(task.detailedProgress ?? null);
            setReanalyzeMessage(task.message || task.error || null);
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

          setReanalyzeError(task.error || t('history.reanalyzeFailed'));
          resetReanalyzeState();
          clearPollTimeout();
        } catch (error) {
          Logger.error('[History] Failed to monitor reanalyze task', { taskId, error });
          consecutiveErrors += 1;
          if (consecutiveErrors < RETRY.MAX_ATTEMPTS && !isUnmountedRef.current) {
            pollTimeoutRef.current = setTimeout(
              () => void pollTaskStatus(),
              TIMING.POLL_TASK_RUNNING_MS * consecutiveErrors,
            );
            return;
          }
          if (!isUnmountedRef.current) {
            setReanalyzeError(
              error instanceof Error ? error.message : t('history.reanalyzeFailed'),
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
    setReanalyzeDetailedProgress(null);
    setReanalyzeMessage(null);
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
        throw new Error(t('history.reanalyzeStartFailed'));
      }

      setReanalyzeTaskId(response.taskId);
      monitorReanalyzeTask(response.taskId, selectedItem.id);
    } catch (error) {
      Logger.error('[History] Failed to start reanalyze', { error });
      setReanalyzeError(error instanceof Error ? error.message : t('history.reanalyzeFailed'));
      resetReanalyzeState();
    }
  }, [isReanalyzing, monitorReanalyzeTask, resetReanalyzeState, selectedItem, t]);

  const [isGeneratingDynamic, setIsGeneratingDynamic] = useState(false);
  const [generateDynamicError, setGenerateDynamicError] = useState('');

  const handleGenerateDynamicReport = useCallback(async () => {
    if (!selectedItem || isGeneratingDynamic || isReanalyzing) {
      return;
    }

    setGenerateDynamicError('');
    setIsGeneratingDynamic(true);

    try {
      const response = await ExtensionAPI.generateDynamicReport(selectedItem.id);
      if (response.success && response.taskId) {
        setIsReanalyzing(true);
        setReanalyzeProgress(0);
        setReanalyzeDetailedProgress(null);
        setReanalyzeMessage(null);
        setReanalyzingHistoryId(selectedItem.id);
        setReanalyzeTaskId(response.taskId);
        monitorReanalyzeTask(response.taskId, selectedItem.id);
      } else {
        setGenerateDynamicError(response.error || t('history.generateDynamicFailed'));
      }
    } catch (error) {
      Logger.error('[History] Failed to generate dynamic report', { error });
      setGenerateDynamicError(
        error instanceof Error ? error.message : t('history.generateDynamicFailed'),
      );
    } finally {
      if (!isUnmountedRef.current) {
        setIsGeneratingDynamic(false);
      }
    }
  }, [isGeneratingDynamic, isReanalyzing, monitorReanalyzeTask, selectedItem, t]);

  return {
    clearReanalyzeError,
    handleReanalyze,
    isReanalyzing,
    reanalyzeError,
    reanalyzeDetailedProgress,
    reanalyzeMessage,
    reanalyzeProgress,
    reanalyzeTaskId,
    reanalyzingHistoryId,
    isGeneratingDynamic,
    generateDynamicError,
    handleGenerateDynamicReport,
  };
}
