import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MESSAGES, TIMING, TEXT } from '@/config/constants';
import { Task, TaskProgress } from '@/types';
import { Logger } from '@/utils/logger';
import { useToast } from '@/hooks/useToast';

export interface CurrentTask {
  id: string;
  type: 'extract' | 'analyze';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message?: string;
  detailedProgress?: TaskProgress;
}

interface UseTaskOptions {
  onTaskComplete?: (task: CurrentTask) => void;
  onStatusRefresh?: () => Promise<void>;
}

export function useTask(options: UseTaskOptions = {}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [currentTask, setCurrentTask] = useState<CurrentTask | null>(null);
  const monitorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef(false);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      if (monitorTimeoutRef.current) {
        clearTimeout(monitorTimeoutRef.current);
        monitorTimeoutRef.current = null;
      }
    };
  }, []);

  const monitorTask = useCallback(
    async (taskId: string) => {
      const checkStatus = async () => {
        if (isUnmountedRef.current) return;

        try {
          const response = await chrome.runtime.sendMessage({
            type: MESSAGES.GET_TASK_STATUS,
            payload: { taskId },
          });

          if (isUnmountedRef.current) return;

          if (response?.task) {
            const task = response.task;
            const updatedTask: CurrentTask = {
              id: task.id,
              type: task.type,
              status: task.status,
              progress: task.progress,
              message: task.message || task.error,
              detailedProgress: task.detailedProgress,
            };
            setCurrentTask(updatedTask);

            if (task.status === 'running' || task.status === 'pending') {
              monitorTimeoutRef.current = setTimeout(checkStatus, TIMING.POLL_TASK_RUNNING_MS);
            } else if (task.status === 'completed') {
              await options.onStatusRefresh?.();
              options.onTaskComplete?.(updatedTask);
              toast.success(
                task.type === 'extract'
                  ? t('popup.extractionCompleted')
                  : t('popup.analysisCompleted'),
              );
              monitorTimeoutRef.current = setTimeout(() => {
                if (!isUnmountedRef.current) {
                  setCurrentTask(null);
                }
              }, TIMING.CLEAR_TASK_DELAY_MS);
            } else if (task.status === 'failed') {
              const isCancelled = task.error === 'Task cancelled by user';
              if (isCancelled) {
                toast.info(t('task.cancel'));
              } else {
                toast.error(
                  task.error ? `${t('popup.taskFailed')}: ${task.error}` : t('popup.taskFailed'),
                );
              }
              monitorTimeoutRef.current = setTimeout(() => {
                if (!isUnmountedRef.current) {
                  setCurrentTask(null);
                }
              }, TIMING.CLEAR_TASK_FAILED_MS);
            }
          }
        } catch (error) {
          Logger.error('[useTask] Failed to check task status', { error });
        }
      };

      checkStatus();
    },
    [t, toast, options],
  );

  const loadCurrentTask = useCallback(
    async (tabUrl: string) => {
      try {
        const response = await chrome.runtime.sendMessage({ type: MESSAGES.GET_TASK_STATUS });

        if (response?.tasks) {
          const currentUrlTask = response.tasks.find(
            (task: Task) =>
              task.url === tabUrl && (task.status === 'running' || task.status === 'pending'),
          );

          if (currentUrlTask) {
            Logger.debug('[useTask] Found current task', { task: currentUrlTask });
            setCurrentTask({
              id: currentUrlTask.id,
              type: currentUrlTask.type,
              status: currentUrlTask.status,
              progress: currentUrlTask.progress,
              message: currentUrlTask.message || currentUrlTask.error,
              detailedProgress: currentUrlTask.detailedProgress,
            });

            if (currentUrlTask.status === 'running' || currentUrlTask.status === 'pending') {
              monitorTask(currentUrlTask.id);
            }
          }
        }
      } catch (error) {
        Logger.error('[useTask] Failed to load current task', { error });
      }
    },
    [monitorTask],
  );

  const ensureContentScript = async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) {
      throw new Error('No active tab');
    }

    const resp = await chrome.runtime.sendMessage({
      type: MESSAGES.ENSURE_CONTENT_SCRIPT,
      payload: { tabId },
    });

    if (!resp?.success) {
      throw new Error(TEXT.CONTENT_SCRIPT_INJECT_FAILED);
    }
  };

  const startExtraction = async (url: string): Promise<string | null> => {
    if (currentTask && currentTask.status === 'running') {
      toast.warning(t('popup.taskAlreadyRunning'));
      return null;
    }

    try {
      await ensureContentScript();
    } catch (_error) {
      toast.error(TEXT.CONTENT_SCRIPT_INJECT_FAILED);
      return null;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.START_EXTRACTION,
        payload: { url },
      });

      if (response?.taskId) {
        setCurrentTask({
          id: response.taskId,
          type: 'extract',
          status: 'running',
          progress: 0,
        });
        toast.info(t('popup.extractionStarted'));
        monitorTask(response.taskId);
        return response.taskId;
      }
      return null;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error);
      Logger.error('[useTask] Failed to start extraction', { error: message });
      setCurrentTask(null);
      toast.error(t('popup.extractionFailed'));
      return null;
    }
  };

  const startAnalysis = async (
    historyId: string,
    comments: unknown[],
    metadata: { url?: string; platform?: string; title?: string },
  ): Promise<string | null> => {
    if (currentTask && currentTask.status === 'running') {
      toast.warning(t('popup.taskAlreadyRunning'));
      return null;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.START_ANALYSIS,
        payload: {
          comments,
          historyId,
          metadata,
        },
      });

      if (response?.taskId) {
        setCurrentTask({
          id: response.taskId,
          type: 'analyze',
          status: 'running',
          progress: 0,
        });
        toast.info(t('popup.analysisStarted'));
        monitorTask(response.taskId);
        return response.taskId;
      }
      return null;
    } catch (error) {
      Logger.error('[useTask] Failed to start analysis', { error });
      setCurrentTask(null);
      toast.error(t('popup.analysisFailed'));
      return null;
    }
  };

  const cancelTask = async (taskId: string) => {
    try {
      await chrome.runtime.sendMessage({
        type: MESSAGES.CANCEL_TASK,
        payload: { taskId },
      });
    } catch (error) {
      Logger.error('[useTask] Failed to cancel task', { error });
    }
  };

  return {
    currentTask,
    loadCurrentTask,
    startExtraction,
    startAnalysis,
    cancelTask,
    ToastContainer: toast.ToastContainer,
  };
}
