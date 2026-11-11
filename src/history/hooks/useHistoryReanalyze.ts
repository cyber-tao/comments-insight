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

interface HistoryTaskError {
  historyId: string;
  message: string;
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
  const [reanalyzeError, setReanalyzeError] = useState<HistoryTaskError | null>(null);
  const [generateDynamicError, setGenerateDynamicError] = useState<HistoryTaskError | null>(null);
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

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      clearPollTimeout();
    };
  }, [clearPollTimeout]);

  const monitorReanalyzeTask = useCallback(
    (taskId: string, historyId: string, kind: 'analysis' | 'dynamic') => {
      clearPollTimeout();

      const setTaskError = kind === 'dynamic' ? setGenerateDynamicError : setReanalyzeError;
      const failureKey =
        kind === 'dynamic' ? 'history.generateDynamicFailed' : 'history.reanalyzeFailed';
      let consecutiveErrors = 0;
      const pollTaskStatus = async () => {
        if (isUnmountedRef.current) {
          return;
        }

        try {
          const task = await ExtensionAPI.getTaskStatus(taskId);
          if (isUnmountedRef.current) {
            return;
          }
          if (!task) {
            throw new Error(t('history.reanalyzeTaskMissing'));
          }

          if (task.status === 'running' || task.status === 'pending') {
            consecutiveErrors = 0;
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

          setTaskError({ historyId, message: task.error || t(failureKey) });
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
            setTaskError({
              historyId,
              message: error instanceof Error ? error.message : t(failureKey),
            });
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

    setReanalyzeError(null);
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
      monitorReanalyzeTask(response.taskId, selectedItem.id, 'analysis');
    } catch (error) {
      Logger.error('[History] Failed to start reanalyze', { error });
      setReanalyzeError({
        historyId: selectedItem.id,
        message: error instanceof Error ? error.message : t('history.reanalyzeFailed'),
      });
      resetReanalyzeState();
    }
  }, [isReanalyzing, monitorReanalyzeTask, resetReanalyzeState, selectedItem, t]);

  const [isGeneratingDynamic, setIsGeneratingDynamic] = useState(false);

  const handleGenerateDynamicReport = useCallback(async () => {
    if (!selectedItem || isGeneratingDynamic || isReanalyzing) {
      return;
    }

    setGenerateDynamicError(null);
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
        monitorReanalyzeTask(response.taskId, selectedItem.id, 'dynamic');
      } else {
        setGenerateDynamicError({
          historyId: selectedItem.id,
          message: response.error || t('history.generateDynamicFailed'),
        });
      }
    } catch (error) {
      Logger.error('[History] Failed to generate dynamic report', { error });
      setGenerateDynamicError({
        historyId: selectedItem.id,
        message: error instanceof Error ? error.message : t('history.generateDynamicFailed'),
      });
    } finally {
      if (!isUnmountedRef.current) {
        setIsGeneratingDynamic(false);
      }
    }
  }, [isGeneratingDynamic, isReanalyzing, monitorReanalyzeTask, selectedItem, t]);

  return {
    handleReanalyze,
    isReanalyzing,
    reanalyzeError:
      reanalyzeError && reanalyzeError.historyId === selectedItem?.id ? reanalyzeError.message : '',
    reanalyzeDetailedProgress,
    reanalyzeMessage,
    reanalyzeProgress,
    reanalyzeTaskId,
    reanalyzingHistoryId,
    isGeneratingDynamic,
    generateDynamicError:
      generateDynamicError && generateDynamicError.historyId === selectedItem?.id
        ? generateDynamicError.message
        : '',
    handleGenerateDynamicReport,
  };
}
